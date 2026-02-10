const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = require('electron-is-dev');

let mainWindow;
let apiProcess = null;
let webProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : 'http://localhost:3000';

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startApiServer() {
  const rootDir = path.join(__dirname, '..', '..');
  const apiDir = path.join(rootDir, 'apps', 'api');

  if (isDev) {
    apiProcess = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', 'api', 'dev'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
  } else {
    apiProcess = spawn(process.execPath, [path.join(apiDir, 'dist', 'main.js')], {
      cwd: apiDir,
      stdio: 'inherit'
    });
  }
}

function startWebServer() {
  const rootDir = path.join(__dirname, '..', '..');
  const webDir = path.join(rootDir, 'apps', 'web');

  if (isDev) {
    webProcess = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', 'web', 'dev'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
  } else {
    const nextCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    webProcess = spawn(nextCmd, ['--filter', 'web', 'start', '--', '-p', '3000'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
  }
}

function stopChildProcesses() {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  if (webProcess) {
    webProcess.kill();
    webProcess = null;
  }
}

app.on('ready', () => {
  startApiServer();
  startWebServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopChildProcesses();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

