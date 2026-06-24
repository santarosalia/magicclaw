import { create } from "zustand";
import type { ToolCall, ToolMessage } from "langchain";

interface ToolCallState {
  toolCalls: ToolCall[];
  toolMessages: ToolMessage[];
}

interface ToolCallStore extends ToolCallState {
  addToolCalls: (calls: ToolCall[]) => void;
  addToolMessage: (message: ToolMessage) => void;
  reset: () => void;
  restore: (calls: ToolCall[], messages: ToolMessage[]) => void;
}

export const useToolCallStore = create<ToolCallStore>((set) => ({
  toolCalls: [],
  toolMessages: [],
  addToolCalls: (calls: ToolCall[]) =>
    set((state: ToolCallState) => ({
      toolCalls: [...state.toolCalls, ...calls],
    })),
  addToolMessage: (message: ToolMessage) =>
    set((state: ToolCallState) => ({
      toolMessages: [...state.toolMessages, message],
    })),
  reset: () => set({ toolCalls: [], toolMessages: [] }),
  restore: (calls: ToolCall[], messages: ToolMessage[]) =>
    set({ toolCalls: calls, toolMessages: messages }),
}));
