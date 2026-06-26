const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = !app.isPackaged;
const FRONTEND_PORT = process.env.GEXLAB_FRONTEND_PORT || '3000';
const BACKEND_PORT = process.env.GEXLAB_BACKEND_PORT || '8000';
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

let mainWindow = null;
let frontendProcess = null;
let backendProcess = null;

function waitForUrl(url, timeoutMs = 60000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http
        .get(url, () => {
          req.destroy();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`Timed out waiting for ${url}`));
            return;
          }
          setTimeout(probe, 600);
        });
    };

    probe();
  });
}

function spawnProcess(command, args, cwd, extraEnv = {}) {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    shell: true,
    stdio: 'inherit',
  });
}

async function ensureServices() {
  const rootDir = path.resolve(__dirname, '..', '..');
  const frontendDir = path.resolve(__dirname, '..');
  const backendDir = path.resolve(rootDir, 'backend');

  if (isDev) {
    backendProcess = spawnProcess('cmd', ['/c', `venv\\Scripts\\python -m uvicorn main:app --reload --port ${BACKEND_PORT}`], backendDir);
    frontendProcess = spawnProcess('cmd', ['/c', `npm run dev -- --port ${FRONTEND_PORT}`], frontendDir, {
      BROWSER: 'none',
      NEXT_TELEMETRY_DISABLED: '1',
    });
  } else {
    backendProcess = spawnProcess('cmd', ['/c', `venv\\Scripts\\python -m uvicorn main:app --host 127.0.0.1 --port ${BACKEND_PORT}`], backendDir);
    frontendProcess = spawnProcess('cmd', ['/c', `npm run start -- --port ${FRONTEND_PORT}`], frontendDir, {
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    });
  }

  await Promise.all([waitForUrl(FRONTEND_URL), waitForUrl(`${BACKEND_URL}/api/health`)]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: 'GexLab v2',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(FRONTEND_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopServices() {
  for (const child of [frontendProcess, backendProcess]) {
    if (child && !child.killed) {
      child.kill();
    }
  }
}

app.whenReady().then(async () => {
  try {
    await ensureServices();
    createWindow();
  } catch (error) {
    console.error('Unable to start GexLab desktop shell:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServices();
});
