/**
 * MCP 서버 카탈로그 (awesome-mcp-servers 기반)
 * https://github.com/punkpeye/awesome-mcp-servers
 */
export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  customArgs?: string[];
  env?: Record<string, string>;
  category?: string;
  source?: string;
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "server-everything",
    name: "server-everything",
    description:
      "MCP 프로토콜의 모든 기능을 테스트하는 공식 서버 (파일, fetch 등)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    category: "공식",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-filesystem",
    name: "server-filesystem",
    description: "로컬 파일 시스템 읽기/쓰기",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    category: "파일",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-fetch",
    name: "server-fetch",
    description: "웹 URL 페치 및 콘텐츠 처리",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    category: "검색",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-postgres",
    name: "server-postgres",
    description: "PostgreSQL 스키마 조회 및 쿼리",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    customArgs: ["postgresql://localhost/mydb"],
    category: "데이터베이스",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-sqlite",
    name: "server-sqlite",
    description: "SQLite DB 연동 및 분석",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    customArgs: ["--db-path", "./data.db"],
    category: "데이터베이스",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-git",
    name: "server-git",
    description: "Git 저장소 읽기/검색/분석",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    customArgs: ["--repository", "."],
    category: "버전관리",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-google-maps",
    name: "server-google-maps",
    description: "Google Maps 위치/경로/장소 정보 (API 키 필요)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    category: "위치",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-memory",
    name: "server-memory",
    description: "지식 그래프 기반 영구 메모리",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    category: "지식",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "server-puppeteer",
    name: "server-puppeteer",
    description: "브라우저 자동화 (스크래핑, 상호작용)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    category: "브라우저",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "playwright-mcp",
    name: "playwright-mcp",
    description: "Microsoft Playwright로 웹 페이지 상호작용",
    command: "npx",
    args: ["-y", "@playwright/mcp"],
    category: "브라우저",
    source: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "github-mcp-server",
    name: "github-mcp-server",
    description: "GitHub 저장소/PR/이슈 관리",
    command: "npx",
    args: ["-y", "@anthropic-ai/github-mcp-server"],
    category: "버전관리",
    source: "https://github.com/github/github-mcp-server",
  },
  {
    id: "brave-search",
    name: "brave-search",
    description: "Brave Search API 웹 검색",
    command: "npx",
    args: ["-y", "@anthropic-ai/brave-search-mcp-server"],
    category: "검색",
    source: "https://github.com/brave/brave-search-mcp-server",
  },
  {
    id: "puppeteer",
    name: "server-puppeteer (modelcontextprotocol)",
    description: "Puppeteer 브라우저 자동화",
    command: "npx",
    args: ["-y", "server-puppeteer"],
    category: "브라우저",
    source: "https://github.com/modelcontextprotocol/server-puppeteer",
  },
  {
    id: "sequential-thinking",
    name: "sequential-thinking",
    description: "순차적 사고 도구 (추론 강화)",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    category: "추론",
    source: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "sentry-mcp",
    name: "sentry-mcp",
    description: "Sentry 오류 추적 및 성능 모니터링",
    command: "npx",
    args: ["-y", "@anthropic-ai/sentry-mcp-server"],
    category: "모니터링",
    source: "https://github.com/getsentry/sentry-mcp",
  },
  {
    id: "mcp-server-time",
    name: "mcp-server-time",
    description: "시간 관련 정보 제공",
    command: "uvx",
    args: ["mcp-server-time"],
    customArgs: [],
    category: "시간",
    source:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
  },
  {
    id: "duckduckgo-search",
    name: "duckduckgo-search",
    description: "DuckDuckGo 검색",
    command: "uvx",
    args: ["duckduckgo-mcp-server"],
    category: "검색",
    source: "https://github.com/zhsama/duckduckgo-mcp-server",
  },
];

export function getMcpCatalogByCategory(): Map<string, McpCatalogEntry[]> {
  const map = new Map<string, McpCatalogEntry[]>();
  for (const entry of MCP_CATALOG) {
    const cat = entry.category ?? "기타";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(entry);
  }
  return map;
}
