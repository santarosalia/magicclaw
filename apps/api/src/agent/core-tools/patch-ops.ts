import { readFileSync, writeFileSync } from "node:fs";

export interface PatchReplaceResult {
  ok: boolean;
  content?: string;
  error?: string;
  replacements?: number;
}

export function applyReplacePatch(
  absolutePath: string,
  oldString: string,
  newString: string,
  replaceAll = false
): PatchReplaceResult {
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!oldString) {
    return { ok: false, error: "old_string must be non-empty" };
  }

  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    return { ok: false, error: "old_string not found in file" };
  }
  if (occurrences > 1 && !replaceAll) {
    return {
      ok: false,
      error: `old_string matched ${occurrences} times; set replace_all=true or include more context`,
    };
  }

  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  writeFileSync(absolutePath, next, "utf8");
  return {
    ok: true,
    content: next,
    replacements: replaceAll ? occurrences : 1,
  };
}
