import { app, BrowserWindow } from "electron";
import http from "node:http";

const isDev = process.env.NODE_ENV !== "production";

let mainWindow: BrowserWindow | null = null;

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
    // dev 스크립트에서 Next / Nest 서버를 같이 띄우므로,
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

app.on("ready", () => {
  createWindow().catch((err) => {
    console.error("Failed to create window:", err);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    void createWindow();
  }
});

