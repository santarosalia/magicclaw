# MagicClaw

도구를 쓰는 **개인 AI 에이전트 런타임**입니다.

OpenAI 호환 LLM에 LangGraph 기반 툴 루프를 연결하고, 파일·셸·MCP 도구, 장기 메모리, 스킬, 세션, Telegram을 하나의 로컬 스택으로 제공합니다. 데이터는 `~/.magicclaw`에 두고, 웹 UI 또는 CLI로 실행·설정합니다.

| | |
| --- | --- |
| 버전 | 0.1.0 |
| 라이선스 | MIT |
| 요구 사항 | Node.js 22+ |

---

## 주요 기능

### 에이전트 채팅

- Socket.IO 실시간 채팅 (웹) 및 Telegram 연동
- LangGraph 기반 LLM ↔ 도구 루프 (최대 iteration / recursion 제한)
- 도구 호출·결과·중간 응답·최종 응답 스트리밍
- 시스템 프롬프트 + 프로젝트 컨텍스트 파일 + 스킬 인덱스 + 사용자/메모리 블록 주입
- [컨텍스트 관리 정책](#컨텍스트-관리-정책): 메시지 수 압축, 토큰 예산, overflow shrink·재시도

### 내장 도구 (코어)

워크스페이스 루트(`MAGICCLAW_WORKSPACE` → `~/.magicclaw/workspace` → cwd) 기준으로 동작합니다.

| 도구 | 설명 |
| --- | --- |
| `terminal` | 셸 명령 실행 |
| `process` | 백그라운드 job 관리 |
| `read_file` / `write_file` / `patch` | 파일 읽기·쓰기·패치 |
| `search_files` | 파일 검색 |
| `todo` | 작업 목록 |
| memory 툴 | 내장 메모리 읽기/쓰기 |
| `session_search` | 과거 세션 검색 |
| `skill_manage` | 스킬 설치·편집·Hub 관리 |

활성화된 MCP 도구도 함께 바인딩됩니다. 이름 충돌 시 코어 도구가 우선합니다.

### LLM 설정

- OpenAI 호환 API (`baseURL` + `model` + `apiKey`)
- 다중 설정 등록, 기본 모델 지정
- Context window 자동 감지 / 수동 / 환경 변수 강제
- Ollama 등 로컬 엔드포인트 지원 (예: `http://localhost:11434/v1`)

### MCP (Model Context Protocol)

- **stdio** / **http** / **sse** 서버 등록
- 활성화·비활성화, 도구 목록 조회
- 에이전트 툴 루프에 자동 연결

### 메모리

**내장 메모리** (항상 사용 가능)

- `MEMORY.md` / `USER.md` (`memories/<userId>/`)
- 대화 팩트 자동 수집, 에이전트 memory 툴
- 문자 수·컨텍스트 메시지 수 한도 설정

**외부 provider — mem0**

- **Platform**: `MEM0_API_KEY`로 클라우드 연동
- **OSS**: 자체 LLM/임베더 + vector store (`memory` / `qdrant` / `pgvector`)

### 스킬 & Curator

- 디스크 스킬 + GitHub Hub 설치 (`owner/repo` 또는 `owner/repo/path`)
- 에이전트가 `skill_manage`로 생성·편집·설치·제거
- **Curator**: 에이전트 생성 스킬의 노후화(stale) → archive, pin/restore, 주기 리뷰

### 세션

- SQLite (`sessions.db`)에 세션·메시지 저장
- 채널별 구분 (`web` / `telegram` / `api`)
- FTS5 전문 검색 (미지원 Node 빌드는 LIKE 폴백)

### 메신저

- **Telegram** (grammy, long polling)
- DM 정책: `pairing` / `allowlist` / `open` / `disabled`
- 웹 채팅과 동일한 turn 파이프라인으로 응답

### 웹 UI

| 경로 | 기능 |
| --- | --- |
| `/` | 홈 — 주요 기능 진입 |
| `/chat` | 실시간 채팅, 세션 사이드바, 툴 트레일, Todo |
| `/llm` | LLM 설정 CRUD, 기본 모델, context window |
| `/mcp` | MCP 서버 등록·관리 |
| `/memory` | 내장 메모리·mem0 설정 |
| `/messenger` | Telegram 토큰·DM 정책 |
| `/skills` | Hub 설치, Curator 상태·실행·설정 |

---

## 구조

```
apps/
  api/        NestJS 백엔드 — 에이전트, REST, Socket.IO, Telegram   (:4000)
  web/        Next.js 프론트 — 채팅·설정 UI                          (:3000)
  electron/   Electron 데스크톱 셸 (선택)
scripts/
  bin/        magicclaw CLI
  release/    릴리스 번들 빌드
```

**모노레포**: pnpm workspace  
**인증**: 없음 (웹은 `localStorage` UUID 스코프, Telegram은 chatId 스코프)

### 데이터 디렉터리

`MAGICCLAW_HOME` (기본: Linux/macOS `~/.magicclaw`, Windows `%USERPROFILE%\.magicclaw`)

```
MAGICCLAW_HOME/
  .env                 # 환경 변수 (필수: OPENAI_API_KEY)
  config/              # llm, mcp, memory, messenger, curator JSON
  sessions.db          # 세션·메시지 (SQLite)
  memories/<user>/     # MEMORY.md, USER.md
  skills/              # 스킬 + Hub lock + Curator state
  workspace/           # 코어 툴 작업 루트
  run/                 # pid, logs (CLI)
  mem0-history.db      # mem0 OSS (사용 시)
```

---

## 컨텍스트 관리 정책

매 턴마다 대화 이력이 모델 context window를 넘지 않도록, **메시지 수 압축 → 토큰 예산 shrink → API 호출 시 재시도** 순으로 맞춥니다.

### 1. Context window 결정

우선순위 (앞이 이김):

1. 환경 변수 `AGENT_CONTEXT_WINDOW`
2. 활성 LLM 설정의 `contextWindow` (연결 시 API 조회 / 모델명 heuristic / 수동 / fallback)
3. 기본값 **65536** 토큰

소스 표시: `api` | `heuristic` | `manual` | `fallback` (웹 `/llm`에서 확인·갱신 가능)

### 2. 토큰 예산

메시지에 쓸 수 있는 예산:

```
messageBudget = contextWindow
  − systemOverhead(시스템·메모리·스킬 등)
  − max(툴 스키마 추정, AGENT_TOOL_SCHEMA_RESERVE)
  − AGENT_OUTPUT_RESERVE
  − AGENT_CONTEXT_SAFETY_MARGIN
  − BASE_SYSTEM_PROMPT_TOKEN_RESERVE(800)
```

최소 예산은 512 토큰입니다.

| 항목 | 기본값 | 환경 변수 |
| --- | --- | --- |
| Context window | 65536 (또는 LLM 설정) | `AGENT_CONTEXT_WINDOW` |
| 출력 예약 | 4096 | `AGENT_OUTPUT_RESERVE` |
| 툴 스키마 예약 | 8192 | `AGENT_TOOL_SCHEMA_RESERVE` |
| 안전 마진 | 2048 | `AGENT_CONTEXT_SAFETY_MARGIN` |

토큰 추정은 보수적 휴리스틱(`ceil(문자수/2 × 1.1)`)을 사용합니다.

### 3. 메시지 수 압축 (`maxContextMessages`)

`memory-config.json`의 `maxContextMessages` (기본 **40**)를 초과하면:

1. 압축 전 메모리 훅 실행 (`onPreCompress`)
2. 이력을 **head(초반) + middle(중간) + tail(최근)** 로 분할  
   - tail 길이 ≈ `max(4, floor(maxContextMessages / 2))`  
   - AI `tool_calls`와 대응 `ToolMessage`가 잘리지 않도록 쌍 단위로 경계 확장
3. middle을 LLM으로 요약 → `[Compressed context from earlier turns]` 메시지 삽입  
   - 활성 Todo가 있으면 요약 직후 재주입
4. 요약 실패·LLM 없음 → middle 버리고 head+tail만 유지
5. 이후 항상 토큰 예산 shrink 적용

메시지 수가 한도 이하여도 토큰 예산 shrink는 매 턴 적용됩니다.

### 4. 토큰 overflow shrink

예산 초과 시 순서:

1. **본문 Truncation** — Tool / AI / (마지막) Human 메시지 본문을 단계적으로 줄임 (`...[truncated for context limit]`)
2. **앞쪽 드롭** — 가장 오래된 메시지부터 제거 (tool call 쌍은 함께 제거)
3. 필요 시 truncation 한 번 더

항상 **tool call ↔ tool result 쌍 수리**: 고아 ToolMessage 제거, 누락된 tool result는 stub(`tool result unavailable`)으로 보강. Responses API raw `output` 메타는 제거해 재직렬화합니다.

### 5. API 호출 가드 (재시도)

LLM invoke 직전에도 예산을 맞추고, context length 에러가 나면 최대 **6회** 재시도합니다.

- 시도마다 예산을 `1 − attempt×0.12`로 축소
- 안전 마진을 시도마다 +1024 토큰 증가
- 그래도 실패하면 에러 전파

### 6. 컨텍스트에 실리는 고정 블록

| 블록 | 한도 / 비고 |
| --- | --- |
| 시스템 프롬프트 | 고정 예약 800 토큰 |
| `AGENTS.md` / `SOUL.md` / `CLAUDE.md` | 파일당 최대 32KB |
| `MEMORY.md` | 기본 2200자 (`memoryCharLimit`) |
| `USER.md` | 기본 1375자 (`userCharLimit`) |
| 스킬 인덱스 | 시스템 오버헤드에 포함 |
| Todo | 압축 후에도 재주입 |

메모리 문자 한도와 `maxContextMessages`는 `config/memory-config.json` 또는 웹 `/memory`에서 조정합니다.

### 7. 턴(iteration) 예산

컨텍스트와 별도로, 한 턴의 툴 루프 API 호출 수에도 상한이 있습니다.

| 항목 | 기본값 | 환경 변수 |
| --- | --- | --- |
| 최대 iteration | 90 (+ grace 1회) | `AGENT_MAX_ITERATIONS` |
| LangGraph recursion | 100 | `AGENT_RECURSION_LIMIT` |

소진 시 도구 없이 요약 답변을 한 번 시도합니다.

---

## 설치

### 요구 사항

- **Node.js 22+** (릴리스 번들은 Node를 포함하지 않음 — [nodejs.org](https://nodejs.org/)에서 설치)
- **Linux / macOS**: `curl`, `tar`, `bash`
- **Windows**: PowerShell 5.1+ (설치·CLI), Node.js 22+

지원 플랫폼 (GitHub Releases):

| 플랫폼 | 아티팩트 |
| --- | --- |
| Linux x64 | `magicclaw-{version}-linux-x64.tar.gz` |
| macOS (Apple Silicon) | `magicclaw-{version}-darwin-arm64.tar.gz` |
| Windows x64 | `magicclaw-{version}-windows-x64.tar.gz` |

---

### Linux / macOS

```bash
curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash
```

설치 스크립트가 플랫폼에 맞는 tarball을 받아 `~/.magicclaw/app`에 풀고, `~/.local/bin/magicclaw` 명령을 등록합니다.

**처음 실행:**

```bash
# 셸을 다시 열거나 PATH 적용
export PATH="$HOME/.local/bin:$PATH"

magicclaw setup    # ~/.magicclaw/.env 생성, OPENAI_API_KEY 입력
magicclaw start    # API :4000 + Web :3000
open http://localhost:3000   # macOS
# xdg-open http://localhost:3000   # Linux
```

**옵션:**

```bash
curl -fsSL .../install.sh | bash -s -- --version v0.1.0 --skip-setup
```

| 옵션 | 설명 |
| --- | --- |
| `--version TAG` | 특정 릴리스 태그 설치 (예: `v0.1.0`) |
| `--magicclaw-home DIR` | 데이터 디렉터리 (기본 `~/.magicclaw`) |
| `--skip-setup` | `.env` 초기화 단계 생략 |
| `--non-interactive` | 프롬프트 없이 진행 |

---

### Windows

**1. Node.js 22+ 설치**

```powershell
winget install OpenJS.NodeJS.LTS
```

**2. PowerShell에서 설치 (권장)**

```powershell
irm https://github.com/santarosalia/magicclaw/releases/latest/download/install.ps1 | iex
```

설치 스크립트가 `magicclaw-*-windows-x64.tar.gz`를 받아 `%USERPROFILE%\.magicclaw\app`에 풀고, `%USERPROFILE%\.local\bin\magicclaw.cmd`를 등록합니다.

**3. 실행**

```powershell
magicclaw setup   # 최초 1회 (.env 생성)
magicclaw start
Start-Process http://localhost:3000
```

**옵션 (스크립트 저장 후 실행):**

```powershell
irm ... -OutFile install.ps1
.\install.ps1 -Version v0.1.0 -SkipSetup
```

| 옵션 | 설명 |
| --- | --- |
| `-Version`, `-v TAG` | 특정 릴리스 태그 설치 |
| `-MagicClawHome DIR` | 데이터 디렉터리 |
| `-SkipSetup` | `.env` 초기화 단계 생략 |
| `-NonInteractive` | 프롬프트 없이 진행 |

파이프 설치 시 환경 변수: `MAGICCLAW_VERSION`, `MAGICCLAW_HOME`, `MAGICCLAW_SKIP_SETUP=1`, `MAGICCLAW_NON_INTERACTIVE=1`

> Windows CLI(`start`/`stop`/`status` 등)는 네이티브 PowerShell 런처(`magicclaw.ps1`)로 동작합니다. Git Bash는 필요하지 않습니다.

**Git Bash에서 설치 (대안):**

```bash
curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash
```

**수동 설치 (tarball 직접 풀기):**

1. [Releases](https://github.com/santarosalia/magicclaw/releases)에서 `magicclaw-*-windows-x64.tar.gz` 다운로드
2. `%USERPROFILE%\.magicclaw\app`에 압축 해제
3. `magicclaw setup && magicclaw start`

---

### magicclaw CLI

| 명령 | 설명 |
| --- | --- |
| `magicclaw start` | API + Web 서버 시작 |
| `magicclaw stop` | 서버 중지 |
| `magicclaw status` | 버전·프로세스 상태 |
| `magicclaw setup` | 데이터 홈 및 `.env` 초기화 |
| `magicclaw update` | 최신 릴리스로 업데이트 |
| `magicclaw logs [api\|web]` | 로그 tail |

환경 변수 `MAGICCLAW_HOME`으로 데이터 위치를 변경할 수 있습니다.

> 일부 Node 빌드는 SQLite FTS5를 포함하지 않습니다. 이 경우 세션 검색은 LIKE 폴백으로 동작하며 API는 정상 기동합니다.

### 업데이트

```bash
magicclaw update
# 또는 install.sh 재실행
curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash
```

---

## 설정

### 환경 변수 (`.env`)

`.env.example` 참고. API는 `OPENAI_API_KEY`가 필수입니다.

| 변수 | 설명 |
| --- | --- |
| `OPENAI_API_KEY` | 필수 — 채팅·mem0 OSS 기본 키 |
| `MEM0_API_KEY` | mem0 Platform |
| `MEM0_MODE` | `oss` \| `platform` |
| `PORT` | API 포트 (기본 4000) |
| `WEB_PORT` | Web 포트 (기본 3000) |
| `WEB_ORIGIN` | CORS origin (기본 `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | Web → API URL |
| `AGENT_CONTEXT_WINDOW` | 전역 컨텍스트 윈도우 강제 (토큰) |
| `AGENT_OUTPUT_RESERVE` | 출력 예약 토큰 (기본 4096) |
| `AGENT_TOOL_SCHEMA_RESERVE` | 툴 스키마 예약 토큰 (기본 8192) |
| `AGENT_CONTEXT_SAFETY_MARGIN` | 안전 마진 토큰 (기본 2048) |
| `AGENT_MAX_ITERATIONS` | 턴당 최대 API 호출 (기본 90) |
| `AGENT_RECURSION_LIMIT` | LangGraph recursion 한도 (기본 100) |
| `MAGICCLAW_HOME` | 데이터 홈 |
| `MAGICCLAW_WORKSPACE` | 코어 툴 워크스페이스 |
| `GITHUB_TOKEN` | 스킬 Hub private/rate limit (선택) |

### JSON 설정 (`MAGICCLAW_HOME/config/`)

| 파일 | 내용 |
| --- | --- |
| `llm-configs.json` | LLM 설정 목록 + 기본 ID |
| `mcp-servers.json` | MCP 서버 (stdio/http/sse) |
| `memory-config.json` | 내장 메모리 한도, `maxContextMessages`, mem0 |
| `messenger-config.json` | Telegram 토큰·DM 정책 |
| `curator-config.json` | Curator 주기·stale/archive 일수 |

### 프로젝트 컨텍스트 파일

워크스페이스 또는 홈에 두면 에이전트 컨텍스트에 주입됩니다 (파일당 최대 32KB).

- `AGENTS.md`
- `SOUL.md`
- `CLAUDE.md`

---

## 개발자 설치 (소스에서)

### 요구 사항

- Node.js 22+
- pnpm 10

```bash
pnpm install
```

```bash
pnpm dev          # api + web 동시 실행
pnpm dev:api      # http://localhost:4000
pnpm dev:web      # http://localhost:3000
```

Electron (선택):

```bash
pnpm dev:electron
pnpm build:electron
pnpm dist:electron
```

### 릴리스 번들 빌드 (로컬)

```bash
bash scripts/release/build-bundle.sh
# → dist/release/magicclaw-{version}-{os}-{arch}.tar.gz
```

GitHub에 `v*` 태그를 push하면 [`.github/workflows/release.yml`](.github/workflows/release.yml)이 OS별 tarball과 `install.sh`, `install.ps1`을 Releases에 업로드합니다.

---

## 도구 서버 예시 (MCP)

- [@modelcontextprotocol/server-everything](https://www.npmjs.com/package/@modelcontextprotocol/server-everything)
- [@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)

웹 UI `/mcp`에서 명령 `npx`, 인자 `-y @modelcontextprotocol/server-everything` 형태로 추가하면 됩니다.

---

## API 개요

| 경로 | 역할 |
| --- | --- |
| `GET /health` | 헬스체크 |
| `GET /agent/tools` | 코어 + MCP 도구 목록 |
| `/llm/*` | LLM 설정 CRUD |
| `/mcp/*` | MCP 서버 관리 |
| `/memory/*` | 메모리·mem0 설정 |
| `/messenger/*` | Telegram 설정 |
| `/skills/*` | 스킬 Hub·Curator |
| `/sessions/*` | 세션·메시지 |
| Socket.IO `/agent` | 실시간 채팅 (`chat` 이벤트) |

---

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Backend | NestJS 11, TypeScript, LangChain / LangGraph, Socket.IO, grammy, mem0ai |
| Frontend | Next.js 15, React 19, Tailwind 4, Zustand |
| Desktop | Electron 32 (선택) |
| 저장소 | SQLite (`node:sqlite`), JSON config, Markdown 메모리·스킬 |

---

## 라이선스

MIT
