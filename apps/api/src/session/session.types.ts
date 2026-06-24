import { AgentChannel } from "../agent/agent.types.js";

export interface SessionRecord {
  id: string;
  userId: string;
  channel: AgentChannel;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionInput {
  userId: string;
  channel: AgentChannel;
  title?: string;
}
