# MagicClaw

**AI 에이전트** 프로젝트입니다. **MCP(Model Context Protocol)** 서버를 등록·관리하고, 채팅 시 해당 도구를 사용할 수 있습니다.

## 구조

- **apps/api** – NestJS 백엔드
  - MCP 서버 CRUD, 도구 목록 조회
  - OpenAI 채팅 완성 + MCP 도구 호출 (도구 사용 가능 에이전트)
  - 메모리, 스킬, 세션, 텔레그램 메신저
- **apps/web** – Next.js 프론트
  - MCP 서버 관리, 채팅, LLM/메모리/스킬/메신저 설정
- **apps/electron** – Electron 데스크톱 (선택)

## 빠른 설치 (curl)

릴리스가 GitHub에 게시된 후:

```bash
# 최신 릴리스에서 설치
curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash

# 또는 main 브랜치 install.sh (개발 중)
curl -fsSL https://raw.githubusercontent.com/santarosalia/magicclaw/main/scripts/install.sh | bash
```

설치 후:

```bash
magicclaw setup    # ~/.magicclaw/.env 생성, OPENAI_API_KEY 설정
magicclaw start    # API(:4000) + Web(:3000) 기동
open http://localhost:3000
```

### magicclaw CLI

| 명령 | 설명 |
|------|------|
| `magicclaw start` | API + Web 서버 시작 |
| `magicclaw stop` | 서버 중지 |
| `magicclaw status` | 버전·프로세스 상태 |
| `magicclaw setup` | 데이터 홈 및 `.env` 초기화 |
| `magicclaw update` | 최신 릴리스로 업데이트 |
| `magicclaw logs [api\|web]` | 로그 tail |

데이터는 `~/.magicclaw/`에 저장됩니다 (`MAGICCLAW_HOME`으로 변경 가능).

릴리스 번들은 **시스템 Node 22+**를 사용합니다. 일부 Node 빌드는 `node:sqlite` FTS5를 포함하지 않으며, 이 경우 세션 검색은 자동으로 LIKE 폴백으로 동작합니다.

### install.sh 옵션

```bash
curl -fsSL .../install.sh | bash -s -- --version v0.1.0 --skip-setup
```

- `--version TAG` — 특정 릴리스 태그 설치
- `--magicclaw-home DIR` — 데이터 디렉터리 (기본 `~/.magicclaw`)
- `--skip-setup` — setup 단계 생략
- `--non-interactive` — 프롬프트 없이 진행

### 호스팅 URL 단계

| 단계 | URL | 비고 |
|------|-----|------|
| 개발/MVP | `raw.githubusercontent.com/.../main/scripts/install.sh` | 브랜치 기준, 즉시 사용 |
| 권장 | `github.com/.../releases/latest/download/install.sh` | 릴리스와 동기화 |
| 커스텀 도메인 | `https://magicclaw.example/install.sh` | Vercel 등 정적 호스팅 (Hermes 패턴) |

커스텀 도메인은 Vercel 프로젝트에 `public/install.sh`를 두고 `vercel.json`으로 `/install.sh`를 서빙하면 됩니다.

## 개발자 설치

### 요구 사항

- Node.js 22+ (시스템에 설치 — 릴리스 번들은 Node를 포함하지 않음)
- pnpm 10

```bash
pnpm install
```

### 환경 변수

`.env.example` 참고. API는 `OPENAI_API_KEY`가 필수입니다.

```bash
pnpm dev          # api + web 동시 실행
pnpm dev:api      # http://localhost:4000
pnpm dev:web      # http://localhost:3000
```

### 릴리스 번들 빌드 (로컬)

```bash
bash scripts/release/build-bundle.sh
# → dist/release/magicclaw-{version}-{os}-{arch}.tar.gz
```

GitHub에 `v*` 태그를 push하면 [`.github/workflows/release.yml`](.github/workflows/release.yml)이 OS별 tarball과 `install.sh`를 Releases에 업로드합니다.

## MCP 서버 예시

- [@modelcontextprotocol/server-everything](https://www.npmjs.com/package/@modelcontextprotocol/server-everything)
- [@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)

명령: `npx`, 인자: `-y @modelcontextprotocol/server-everything` 형태로 추가하면 됩니다.

## 기술 스택

- **Backend**: NestJS, TypeScript, LangChain/LangGraph, mem0ai
- **Frontend**: Next.js 15, React 19, Tailwind 4

## 라이선스

MIT
