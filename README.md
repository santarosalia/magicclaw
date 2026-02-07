# MagicClaw

OpenClaw를 참고한 **AI 에이전트** 프로젝트입니다. **MCP(Model Context Protocol)** 서버를 등록·관리하고, 채팅 시 해당 도구를 사용할 수 있습니다.

## 구조

- **apps/api** – NestJS 백엔드
  - MCP 서버 CRUD, 도구 목록 조회
  - OpenAI 채팅 완성 + MCP 도구 호출 (도구 사용 가능 에이전트)
- **apps/web** – Next.js 프론트
  - MCP 서버 관리 화면
  - 채팅 화면 (에이전트와 대화, 도구 자동 사용)

## 요구 사항

- Node.js 22+
- pnpm

## 설치 및 실행

```bash
pnpm install
```

### 환경 변수

- **API** (`apps/api`): `OPENAI_API_KEY` (필수, 에이전트 채팅용)
- **Web**: `NEXT_PUBLIC_API_URL` (선택, 기본 `http://localhost:4000`)

```bash
# 루트에서 동시 실행
pnpm dev

# 또는 각각
pnpm dev:api   # http://localhost:4000
pnpm dev:web   # http://localhost:3000
```

1. 브라우저에서 http://localhost:3000 접속
2. **MCP 서버 관리**에서 stdio MCP 서버 추가 (예: `npx -y @modelcontextprotocol/server-everything`)
3. **채팅**에서 메시지 입력 시 등록된 MCP 도구가 사용됩니다.

## MCP 서버 예시

- [@modelcontextprotocol/server-everything](https://www.npmjs.com/package/@modelcontextprotocol/server-everything) – 파일시스템, fetch 등
- [@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) – 로컬 파일 읽기/쓰기

명령: `npx`, 인자: `-y @modelcontextprotocol/server-everything` 형태로 추가하면 됩니다.

## 기술 스택

- **Backend**: NestJS, TypeScript, OpenAI API, @modelcontextprotocol/sdk
- **Frontend**: Next.js 15, React 19, TypeScript

## 라이선스

MIT
