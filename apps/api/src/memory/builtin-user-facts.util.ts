/** 사용자 발화에서 프로필·선호·교정 사실 추출 (memory tool 미호출 시 백업용). */
export function extractProfileFacts(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const facts: string[] = [];
  const patterns: RegExp[] = [
    /(?:내\s*이름은|제\s*이름은|이름은)\s*([^\s.,!?。\n]{1,40})/,
    /(?:my name is|call me|i am|i'm)\s+([A-Za-z][A-Za-z0-9\s'-]{0,40})/i,
    /(?:나는|저는)\s+([^\s.,!?。\n]{1,40})\s*(?:이야|입니다|예요|이에요)/,
    /(?:remember|기억해(?:\s*줘)?)[:\s]+(.+)/i,
    /(?:i prefer|i'd prefer|선호(?:해|하는|합니다)?)[:\s]*(.+)/i,
    /(?:(?:don't|do not|never|하지\s*마|쓰지\s*마|말\s*마)[:\s]+(.+))/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match?.[1]) continue;
    const fact = match[1].trim();
    if (fact.length < 2) continue;
    facts.push(normalizeFact(pattern, fact, trimmed));
  }

  return [...new Set(facts)];
}

export function extractMemoryTarget(text: string): "user" | "memory" {
  const trimmed = text.trim();
  if (
    /(?:don't|do not|never|하지\s*마|쓰지\s*마|말\s*마|correction|수정)/i.test(
      trimmed
    )
  ) {
    return "memory";
  }
  return "user";
}

function normalizeFact(pattern: RegExp, captured: string, full: string): string {
  if (pattern.source.includes("이름")) {
    return `User's name is ${captured}.`;
  }
  if (/my name is|call me|i am/i.test(pattern.source)) {
    return `User's name is ${captured}.`;
  }
  if (pattern.source.includes("remember|기억")) {
    return captured.endsWith(".") ? captured : `${captured}.`;
  }
  if (/prefer|선호/i.test(pattern.source)) {
    return `User prefers: ${captured.endsWith(".") ? captured : `${captured}.`}`;
  }
  if (/don't|do not|never|하지|쓰지|말\s*마/i.test(pattern.source)) {
    return `User correction: ${captured.endsWith(".") ? captured : `${captured}.`}`;
  }
  if (pattern.source.includes("나는|저는")) {
    return `User identifies as: ${captured}.`;
  }
  return full.endsWith(".") ? full : `${full}.`;
}
