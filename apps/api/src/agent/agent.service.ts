import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { McpServerConfig } from '../mcp/dto/mcp-server.dto.js';
import { callMcpTool, listToolsFromMcpServer } from '../mcp/mcp-client.service.js';
import { McpStoreService } from '../mcp/mcp-store.service.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentChatOptions {
  messages: ChatMessage[];
  model?: string;
  maxToolRounds?: number;
}

export interface AgentChatResult {
  message: string;
  toolCallsUsed: number;
}

/** Map MCP tool to OpenAI tool definition format */
function mcpToolToOpenAI(t: { name: string; description?: string; inputSchema?: Record<string, unknown> }): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    },
  };
}

@Injectable()
export class AgentService {
  private openai: OpenAI | null = null;

  constructor(private readonly mcpStore: McpStoreService) {
    const key = process.env.OPENAI_API_KEY;
    if (key) this.openai = new OpenAI({ apiKey: key });
  }

  /** Collect all tools from registered MCP servers and return OpenAI-format tools. */
  async getMcpToolsAsOpenAI(): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
    const servers = this.mcpStore.findAll();
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
    for (const server of servers) {
      const result = await listToolsFromMcpServer(server);
      for (const t of result.tools) {
        tools.push(mcpToolToOpenAI(t));
      }
    }
    return tools;
  }

  /** Resolve which MCP server has this tool (by re-listing; can be optimized with cache). */
  private async findServerForTool(toolName: string): Promise<McpServerConfig | undefined> {
    const servers = this.mcpStore.findAll();
    for (const server of servers) {
      const result = await listToolsFromMcpServer(server);
      if (result.tools.some((t) => t.name === toolName)) return server;
    }
    return undefined;
  }

  /** Execute one tool call via MCP and return content for the assistant message. */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const server = await this.findServerForTool(toolName);
    if (!server) return `Error: No MCP server provides tool "${toolName}"`;
    const result = await callMcpTool(server, toolName, args);
    const texts = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text);
    return texts.join('\n');
  }

  async chat(options: AgentChatOptions): Promise<AgentChatResult> {
    const { messages, model = 'gpt-4o-mini', maxToolRounds = 5 } = options;
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const mcpTools = await this.getMcpToolsAsOpenAI();
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system',
      content:
        'You are a helpful assistant. When you need to perform actions (search, read files, etc.), use the provided tools. Reply in the same language as the user when appropriate.',
    };
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages.map((m) =>
        m.role === 'system'
          ? { role: 'system' as const, content: m.content }
          : m.role === 'user'
            ? { role: 'user' as const, content: m.content }
            : { role: 'assistant' as const, content: m.content },
      ),
    ];

    let toolCallsUsed = 0;
    let round = 0;

    while (round < maxToolRounds) {
      const completion = await this.openai.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: mcpTools.length > 0 ? mcpTools : undefined,
        tool_choice: mcpTools.length > 0 ? 'auto' : undefined,
      });

      const choice = completion.choices[0];
      if (!choice?.message) {
        return {
          message: 'No response from model.',
          toolCallsUsed,
        };
      }

      const msg = choice.message;
      openaiMessages.push(msg);

      const toolCalls = msg.tool_calls;
      if (!toolCalls?.length) {
        const raw = msg.content as string | Array<{ type?: string; text?: string }> | null | undefined;
        const content =
          typeof raw === 'string'
            ? raw
            : Array.isArray(raw)
              ? raw.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('')
              : '';
        return { message: content, toolCallsUsed };
      }

      for (const tc of toolCalls) {
        const name = tc.function?.name ?? '';
        let args: Record<string, unknown> = {};
        try {
          if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
        } catch {
          // ignore
        }
        const result = await this.executeToolCall(name, args);
        toolCallsUsed++;
        openaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }
      round++;
    }

    return {
      message: 'Max tool rounds reached; ending turn.',
      toolCallsUsed,
    };
  }
}
