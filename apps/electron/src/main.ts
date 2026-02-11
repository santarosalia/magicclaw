import { app, BrowserWindow } from "electron";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { bootstrap } from "api";

const isDev = !app.isPackaged;

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
  } else {
  }
  try {
    await waitForUrl(startUrl, 30000);
  } catch {
    // 포트 대기에 실패해도 일단 시도
  } finally {
    await mainWindow.loadURL(startUrl);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function startProdServers() {
  if (isDev) return;
  await bootstrap();
  // 패키징된 앱 기준으로, electron-builder가 extraResources로 복사한
  // 빌드 산출물(api-dist, web-next, node_modules)을 사용해서 서버를 띄운다.
  // const resourcesBase = process.resourcesPath;
  const resourcesBase = process.resourcesPath;

  const webNextDir = path.join(resourcesBase, "web-next", "apps", "web");
  webProcess = spawn(process.execPath, [path.join(webNextDir, "server.js")], {
    cwd: webNextDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "3000",
      ELECTRON_RUN_AS_NODE: "1",
    },
  });
  webProcess.on("close", () => {
    webProcess = null;
  });
  // // Electron이 내장한 Node 런타임을 그대로 사용해서 서버들을 실행한다.
  // const commonEnv = {
  //   ...process.env,
  //   ELECTRON_RUN_AS_NODE: "1",
  // };

  // // Nest API (api-dist/main.js)
  // const apiMain = path.join(resourcesBase, "api-dist", "main.js");
  // apiProcess = spawn(process.execPath, [apiMain], {
  //   cwd: path.dirname(apiMain),
  //   stdio: "inherit",
  //   env: commonEnv,
  // });

  // Next Web (web-next/.next, node_modules/next → next start -p 3000)
  // const nodeModulesDir = path.join(resourcesBase, "web-next", "node_modules");
  // const nextBin = path.join(nodeModulesDir, "next", "dist", "bin", "next");
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
