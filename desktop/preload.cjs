const { contextBridge, ipcRenderer } = require('electron');

const apiBaseArg = process.argv.find((argument) => argument.startsWith('--gexlab-api-base='));
const apiBase = apiBaseArg ? apiBaseArg.replace('--gexlab-api-base=', '') : null;

contextBridge.exposeInMainWorld('gexlabDesktop', {
  apiBase,
  isDesktop: true,
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (listener) => {
      const wrappedListener = (_, maximized) => listener(maximized);
      ipcRenderer.on('window:maximized-changed', wrappedListener);

      return () => {
        ipcRenderer.removeListener('window:maximized-changed', wrappedListener);
      };
    },
  },
});
