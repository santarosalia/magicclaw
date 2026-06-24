const apiOrigin = () =>
  (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000").replace(
    /\/$/,
    ""
  );

export interface SessionRecord {
  id: string;
  userId: string;
  channel: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function listSessions(userId: string): Promise<SessionRecord[]> {
  const res = await fetch(
    `${apiOrigin()}/sessions?userId=${encodeURIComponent(userId)}`
  );
  if (!res.ok) throw new Error("세션 목록을 불러오지 못했습니다.");
  return res.json();
}

export async function createSession(userId: string): Promise<SessionRecord> {
  const res = await fetch(`${apiOrigin()}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, channel: "web" }),
  });
  if (!res.ok) throw new Error("세션을 생성하지 못했습니다.");
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${apiOrigin()}/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("세션을 삭제하지 못했습니다.");
}

export async function loadSessionMessages(
  sessionId: string
): Promise<
  Array<{ role: string; content: string; data?: unknown }>
> {
  const res = await fetch(`${apiOrigin()}/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error("메시지를 불러오지 못했습니다.");
  const data = (await res.json()) as {
    messages: Array<{ role: string; content: string; data?: unknown }>;
  };
  return data.messages;
}
