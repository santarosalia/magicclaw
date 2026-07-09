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

## 설치

### 요구 사항

- **Node.js 22+** (릴리스 번들은 Node를 포함하지 않음 — [nodejs.org](https://nodejs.org/)에서 설치)
- **Linux / macOS**: `curl`, `tar`, `bash`
- **Windows**: PowerShell 5.1+ (설치·CLI), Node.js 22+

지원 플랫폼 (GitHub Releases):

| 플랫폼                | 아티팩트                                  |
| --------------------- | ----------------------------------------- |
| Linux x64             | `magicclaw-{version}-linux-x64.tar.gz`    |
| macOS (Apple Silicon) | `magicclaw-{version}-darwin-arm64.tar.gz` |
| Windows x64           | `magicclaw-{version}-windows-x64.tar.gz`  |

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

| 옵션                   | 설명                                  |
| ---------------------- | ------------------------------------- |
| `--version TAG`        | 특정 릴리스 태그 설치 (예: `v0.1.0`)  |
| `--magicclaw-home DIR` | 데이터 디렉터리 (기본 `~/.magicclaw`) |
| `--skip-setup`         | `.env` 초기화 단계 생략               |
| `--non-interactive`    | 프롬프트 없이 진행                    |

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

| 옵션                   | 설명                                           |
| ---------------------- | ---------------------------------------------- |
| `-Version`, `-v TAG`   | 특정 릴리스 태그 설치 (예: `v0.1.0`)           |
| `-MagicClawHome DIR`   | 데이터 디렉터리 (기본 `%USERPROFILE%\.magicclaw`) |
| `-SkipSetup`           | `.env` 초기화 단계 생략                        |
| `-NonInteractive`      | 프롬프트 없이 진행                             |

파이프 설치 시 환경 변수: `MAGICCLAW_VERSION`, `MAGICCLAW_HOME`, `MAGICCLAW_SKIP_SETUP=1`, `MAGICCLAW_NON_INTERACTIVE=1`

> Windows CLI(`start`/`stop`/`status` 등)는 네이티브 PowerShell 런처(`magicclaw.ps1`)로 동작합니다. Git Bash는 필요하지 않습니다.

**Git Bash에서 설치 (대안):**

```bash
curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash
```

**수동 설치 (tarball 직접 풀기):**

1. [Releases](https://github.com/santarosalia/magicclaw/releases)에서 `magicclaw-*-windows-x64.tar.gz` 다운로드
2. `%USERPROFILE%\.magicclaw\app` 에 압축 해제 (`tar -xzf ... -C ...`)
3. PowerShell에서 `magicclaw setup && magicclaw start` (또는 `%USERPROFILE%\.magicclaw\app\bin\magicclaw.cmd setup`)

---

### magicclaw CLI

| 명령                        | 설명                       |
| --------------------------- | -------------------------- |
| `magicclaw start`           | API + Web 서버 시작        |
| `magicclaw stop`            | 서버 중지                  |
| `magicclaw status`          | 버전·프로세스 상태         |
| `magicclaw setup`           | 데이터 홈 및 `.env` 초기화 |
| `magicclaw update`          | 최신 릴리스로 업데이트     |
| `magicclaw logs [api\|web]` | 로그 tail                  |

**데이터 위치**

| OS            | 기본 경로                   |
| ------------- | --------------------------- |
| Linux / macOS | `~/.magicclaw/`             |
| Windows       | `%USERPROFILE%\.magicclaw\` |

환경 변수 `MAGICCLAW_HOME`으로 변경할 수 있습니다. 설정 파일은 `MAGICCLAW_HOME/.env` (필수: `OPENAI_API_KEY`).

**참고:** 일부 Node 빌드는 SQLite FTS5를 포함하지 않습니다. 이 경우 세션 검색은 자동으로 LIKE 폴백으로 동작하며 API는 정상 기동합니다.

---

### 업데이트

```bash
magicclaw update
# 또는 install.sh 재실행
curl -fsSL https://github.com/santarosalia/magicclaw/releases/latest/download/install.sh | bash
```

---

## 개발자 설치 (소스에서)

### 요구 사항

- Node.js 22+
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

GitHub에 `v*` 태그를 push하면 [`.github/workflows/release.yml`](.github/workflows/release.yml)이 OS별 tarball과 `install.sh`, `install.ps1`을 Releases에 업로드합니다.

## MCP 서버 예시

- [@modelcontextprotocol/server-everything](https://www.npmjs.com/package/@modelcontextprotocol/server-everything)
- [@modelcontextprotocol/server-filesystem](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)

명령: `npx`, 인자: `-y @modelcontextprotocol/server-everything` 형태로 추가하면 됩니다.

## 기술 스택

- **Backend**: NestJS, TypeScript, LangChain/LangGraph, mem0ai
- **Frontend**: Next.js 15, React 19, Tailwind 4

## 라이선스

MIT
