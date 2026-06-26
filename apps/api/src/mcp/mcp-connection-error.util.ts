export function formatMcpConnectionError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const parts: string[] = [error.message];
  const cause = error.cause;
  if (cause instanceof Error) {
    const code = "code" in cause ? String(cause.code) : "";
    if (code) parts.push(`(${code})`);
    if (cause.message && cause.message !== error.message) {
      parts.push(cause.message);
    }
  }

  const text = parts.join(" ").trim();
  if (/fetch failed/i.test(text) && /ECONNREFUSED/i.test(text)) {
    return "MCP 서버에 연결할 수 없습니다 (Connection refused). 서버가 실행 중인지, URL·포트가 맞는지, 같은 네트워크에서 접근 가능한지 확인하세요.";
  }
  if (/fetch failed/i.test(text) && /ETIMEDOUT|ETIMEOUT/i.test(text)) {
    return "MCP 서버 연결 시간이 초과되었습니다. URL과 방화벽/네트워크 설정을 확인하세요.";
  }
  if (/fetch failed/i.test(text) && /ENOTFOUND/i.test(text)) {
    return "MCP 서버 호스트를 찾을 수 없습니다. URL의 호스트명을 확인하세요.";
  }
  if (/fetch failed/i.test(text) && /ENETUNREACH/i.test(text)) {
    return "MCP 서버 네트워크에 도달할 수 없습니다. VPN 또는 라우팅을 확인하세요.";
  }
  if (/fetch failed/i.test(text)) {
    return `MCP 서버 네트워크 연결 실패: ${text}. 서버 실행 여부와 URL을 확인하세요.`;
  }

  return text;
}
