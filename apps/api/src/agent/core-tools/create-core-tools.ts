import type { StructuredToolInterface } from "@langchain/core/tools";
import { createPatchTool } from "./patch.tool.js";
import { createProcessTool } from "./process.tool.js";
import { createReadFileTool } from "./read-file.tool.js";
import { createSearchFilesTool } from "./search-files.tool.js";
import { createTerminalTool } from "./terminal.tool.js";
import { createWriteFileTool } from "./write-file.tool.js";
import { getWorkspaceRoot } from "./workspace.js";

/** Hermes-style waist tools always available to MagicClaw agents. */
export const CORE_TOOL_NAMES = [
  "terminal",
  "process",
  "read_file",
  "write_file",
  "patch",
  "search_files",
] as const;

export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

export function listCoreToolDescriptors(): {
  name: string;
  description?: string;
}[] {
  return createCoreTools().map((tool) => ({
    name: tool.name,
    description:
      typeof tool.description === "string" ? tool.description : undefined,
  }));
}

export function createCoreTools(
  workspaceRoot: string = getWorkspaceRoot()
): StructuredToolInterface[] {
  return [
    createTerminalTool(workspaceRoot),
    createProcessTool(),
    createReadFileTool(workspaceRoot),
    createWriteFileTool(workspaceRoot),
    createPatchTool(workspaceRoot),
    createSearchFilesTool(workspaceRoot),
  ];
}
