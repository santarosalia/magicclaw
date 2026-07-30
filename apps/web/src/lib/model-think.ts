/** Models (Qwen, DeepSeek, etc.) often emit reasoning inside these tags. */
const CLOSED_THINK_RE = /<(think|thinking)>([\s\S]*?)<\/\1>/gi;
const OPEN_THINK_RE = /<(think|thinking)>([\s\S]*)$/i;
/** Some providers strip the opening tag and only leave a closer. */
const ORPHAN_CLOSE_RE = /^([\s\S]*?)<\/(think|thinking)>\s*([\s\S]*)$/i;

export function splitModelThinkBlocks(content: string): {
  thinkingParts: string[];
  answer: string;
} {
  const thinkingParts: string[] = [];
  let remaining = content;

  remaining = remaining.replace(
    CLOSED_THINK_RE,
    (_full, _tag, inner: string) => {
      const trimmed = inner.trim();
      if (trimmed) thinkingParts.push(trimmed);
      return "";
    }
  );

  const orphan = remaining.match(ORPHAN_CLOSE_RE);
  if (orphan) {
    const before = orphan[1].trim();
    if (before) thinkingParts.push(before);
    remaining = orphan[3];
  }

  const openMatch = remaining.match(OPEN_THINK_RE);
  if (openMatch && openMatch.index !== undefined) {
    const before = remaining.slice(0, openMatch.index);
    const inner = openMatch[2].trim();
    if (inner) thinkingParts.push(inner);
    remaining = before;
  }

  remaining = remaining.replace(/<\/?(?:think|thinking)>/gi, "");

  return {
    thinkingParts,
    answer: remaining.trim(),
  };
}

/** Plain-text view for thought panels (no raw tags). */
export function toPlainThoughtText(content: string): string {
  const { thinkingParts, answer } = splitModelThinkBlocks(content);
  return [...thinkingParts, answer].filter(Boolean).join("\n\n");
}
