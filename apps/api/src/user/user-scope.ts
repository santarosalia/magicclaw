export interface UserScope {
  userId: string;
  conversationId: string;
}

export function resolveWebUserId(rawUserId: string): string {
  const trimmed = rawUserId.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("web:") ? trimmed : `web:${trimmed}`;
}

export function resolveTelegramUserId(chatId: string | number): string {
  return `telegram:${chatId}`;
}

export function buildUserScope(
  userId: string,
  conversationId?: string
): UserScope {
  return {
    userId,
    conversationId: conversationId?.trim() || "default",
  };
}
