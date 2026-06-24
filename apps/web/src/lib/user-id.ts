const STORAGE_KEY = "magicclaw-user-id";

function createUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing?.trim()) return existing.trim();
  const next = createUuid();
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}
