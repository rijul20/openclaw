/**
 * MCP tool definitions are now integrated directly into the orchestrator
 * via createSdkMcpServer() from the Claude Code SDK.
 *
 * See orchestrator.ts createMcpServer() for the tool implementations.
 *
 * This file is kept as a reference for the tool schema.
 */

export const TOOL_NAMES = [
  "send_message",
  "schedule_task",
  "list_tasks",
  "remove_task",
  "phone_control",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
