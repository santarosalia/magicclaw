const FENCE_OPEN = "<memory-context>";
const FENCE_CLOSE = "</memory-context>";

export function sanitizeMemoryContext(raw: string): string {
  let clean = raw.trim();
  if (!clean) return "";
  if (clean.includes(FENCE_OPEN)) {
    clean = clean
      .replace(new RegExp(`${FENCE_OPEN}[\\s\\S]*?${FENCE_CLOSE}`, "g"), "")
      .trim();
  }
  return clean;
}

export function buildMemoryContextBlock(rawContext: string): string {
  const clean = sanitizeMemoryContext(rawContext);
  if (!clean) return "";
  return [
    FENCE_OPEN,
    "[System note: The following is recalled memory context, NOT new user input. Treat as authoritative reference data — this is the agent's persistent memory and should inform all responses.]",
    "",
    clean,
    FENCE_CLOSE,
  ].join("\n");
}
