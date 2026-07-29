/** Parse SKILL.md YAML frontmatter for name/description (incl. multiline). */
export function parseSkillFrontmatter(raw: string): {
  name: string;
  description: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: "", description: "" };

  const fields = parseSimpleYamlMap(match[1]);
  return {
    name: (fields.name ?? "").trim(),
    description: (fields.description ?? "").trim(),
  };
}

function parseSimpleYamlMap(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    const rest = keyMatch[2];
    const blockMatch = rest.match(/^([|>])([+-]?)(\d*)$/);
    if (blockMatch) {
      const style = blockMatch[1] as "|" | ">";
      i++;
      const contentLines: string[] = [];
      while (i < lines.length) {
        const next = lines[i];
        if (next === "" || /^\s/.test(next)) {
          contentLines.push(next);
          i++;
          continue;
        }
        break;
      }
      result[key] = joinBlockScalar(contentLines, style);
      continue;
    }

    result[key] = unquoteYaml(rest.trim());
    i++;
  }

  return result;
}

function joinBlockScalar(lines: string[], style: "|" | ">"): string {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return "";

  const minIndent = Math.min(
    ...nonEmpty.map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0)
  );
  const stripped = lines.map((l) =>
    l.length >= minIndent ? l.slice(minIndent) : l.trimStart()
  );

  if (style === "|") {
    return stripped.join("\n").replace(/\n+$/, "");
  }

  return stripped
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

function unquoteYaml(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
