import { app, BrowserWindow } from "electron";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const isDev = process.env.NODE_ENV !== "production";

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcess | null = null;
let webProcess: ChildProcess | null = null;

async function waitForUrl(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
        } else {
          setTimeout(attempt, 1000);
        }
      });
    };

    attempt();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const startUrl = "http://localhost:3000";

  if (isDev) {
    // 루트에서 dev 서버(api/web)를 이미 띄운 상태라고 가정.
    // 여기서는 3000 포트가 열릴 때까지 짧게 대기만 합니다.
    try {
      await waitForUrl(startUrl, 30000);
    } catch {
      // 포트 대기에 실패해도 일단 시도
    }
  }

  await mainWindow.loadURL(startUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startProdServers() {
  if (isDev) return;

  // ts-node가 아닌 빌드 산출물(api: dist/main.js, web: next start)을 사용해서 서버를 띄운다.
  // 경로 기준점: apps/electron/dist → repo 루트: ../../..
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  // Electron이 내장한 Node 런타임을 그대로 사용해서 서버들을 실행한다.
  const commonEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  };

  // Nest API (apps/api/dist/main.js)
  const apiMain = path.join(repoRoot, "apps", "api", "dist", "main.js");
  apiProcess = spawn(process.execPath, [apiMain], {
    cwd: path.dirname(apiMain),
    stdio: "inherit",
    env: commonEnv,
  });

  // Next Web (apps/web/.next → next start -p 3000)
  const webDir = path.join(repoRoot, "apps", "web");
  const nextBin = path.join(
    webDir,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  webProcess = spawn(process.execPath, [nextBin, "start", "-p", "3000"], {
    cwd: webDir,
    stdio: "inherit",
    env: { ...commonEnv, NODE_ENV: "production" },
  });
}

function stopProdServers() {
  for (const proc of [apiProcess, webProcess]) {
    if (proc && !proc.killed) {
      proc.kill();
    }
  }
  apiProcess = null;
  webProcess = null;
}

app.on("ready", () => {
  // 프로덕션 모드(예: pnpm start:electron)에서는 빌드 산출물 기반 서버(api/web)를 함께 구동.
  startProdServers();

  createWindow().catch((err) => {
    console.error("Failed to create window:", err);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // 앱이 완전히 종료될 때 prod 서버도 함께 종료
    stopProdServers();
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    void createWindow();
  }
});

