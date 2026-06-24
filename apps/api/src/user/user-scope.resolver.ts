import { Injectable } from "@nestjs/common";
import { AgentChannel } from "../agent/agent.types.js";
import {
  buildUserScope,
  resolveTelegramUserId,
  resolveWebUserId,
  type UserScope,
} from "./user-scope.js";

@Injectable()
export class UserScopeResolver {
  resolve(
    channel: AgentChannel,
    options: {
      userId?: string;
      conversationId?: string;
      legacySessionId?: string;
    }
  ): UserScope {
    if (channel === AgentChannel.TELEGRAM && options.legacySessionId) {
      return buildUserScope(
        resolveTelegramUserId(options.legacySessionId),
        options.conversationId
      );
    }

    const rawUserId = options.userId?.trim();
    if (!rawUserId) {
      throw new Error("userId is required for web chat");
    }

    return buildUserScope(
      resolveWebUserId(rawUserId),
      options.conversationId
    );
  }
}
