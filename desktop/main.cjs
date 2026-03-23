const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let backendProcess = null;
let backendPort = null;
let isQuitting = false;

function getIconPath() {
  return path.join(app.getAppPath(), 'desktop', 'assets', 'icon.png');
}

function getBackendDirectory() {
  return app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.join(app.getAppPath(), 'backend');
}

function getFrontendEntry() {
  return path.join(app.getAppPath(), 'frontend', 'dist', 'index.html');
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate a local port for the backend.'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function getBackendLaunchConfig(port) {
  if (app.isPackaged) {
    const backendExe = path.join(getBackendDirectory(), 'gexlab-backend', 'gexlab-backend.exe');
    return {
      command: backendExe,
      args: [String(port)],
      cwd: path.dirname(backendExe),
    };
  }

  const backendDir = getBackendDirectory();
  const localPython = path.join(backendDir, 'venv', 'Scripts', 'python.exe');
  const command = fs.existsSync(localPython) ? localPython : 'python';

  return {
    command,
    args: [path.join(backendDir, 'desktop_runner.py'), String(port)],
    cwd: backendDir,
  };
}

async function waitForBackend(port) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (backendProcess && backendProcess.exitCode !== null) {
      throw new Error('Backend exited before it became ready.');
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Timed out waiting for the backend to start.');
}

async function startBackend() {
  backendPort = await findFreePort();
  const launchConfig = getBackendLaunchConfig(backendPort);

  backendProcess = spawn(launchConfig.command, launchConfig.args, {
    cwd: launchConfig.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[backend] ${chunk}`);
  });

  backendProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[backend] ${chunk}`);
  });

  backendProcess.on('exit', (code) => {
    if (!isQuitting) {
      const message = code === 0
        ? 'The local GEXLAB backend stopped unexpectedly.'
        : `The local GEXLAB backend stopped with exit code ${code}.`;

      dialog.showErrorBox('Backend Stopped', message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    }
  });

  await waitForBackend(backendPort);
}

function createWindow() {
  const frontendEntry = getFrontendEntry();

  if (!fs.existsSync(frontendEntry)) {
    throw new Error('Missing frontend build. Run `npm run desktop:build:frontend` before starting the desktop app.');
  }

  mainWindow = new BrowserWindow({
    title: 'GEXLAB',
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0d1117',
    icon: getIconPath(),
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--gexlab-api-base=http://127.0.0.1:${backendPort}`],
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(frontendEntry);
}

function getWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle('window:minimize', (event) => {
  const targetWindow = getWindowFromEvent(event);
  targetWindow?.minimize();
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const targetWindow = getWindowFromEvent(event);

  if (!targetWindow) {
    return false;
  }

  if (targetWindow.isMaximized()) {
    targetWindow.unmaximize();
  } else {
    targetWindow.maximize();
  }

  return targetWindow.isMaximized();
});

ipcMain.handle('window:close', (event) => {
  const targetWindow = getWindowFromEvent(event);
  targetWindow?.close();
});

ipcMain.handle('window:is-maximized', (event) => {
  const targetWindow = getWindowFromEvent(event);
  return Boolean(targetWindow?.isMaximized());
});

async function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }

  const processToStop = backendProcess;
  backendProcess = null;

  try {
    processToStop.kill();
  } catch {
    // Ignore shutdown races.
  }
}

app.whenReady().then(async () => {
  try {
    app.setName('GEXLAB');
    app.on('browser-window-created', (_, targetWindow) => {
      const sendState = () => {
        targetWindow.webContents.send('window:maximized-changed', targetWindow.isMaximized());
      };

      targetWindow.on('maximize', sendState);
      targetWindow.on('unmaximize', sendState);
      targetWindow.on('enter-full-screen', sendState);
      targetWindow.on('leave-full-screen', sendState);
    });

    await startBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('GEXLAB Failed to Start', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  await stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendPort !== null) {
    createWindow();
  }
});
