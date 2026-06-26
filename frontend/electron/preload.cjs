const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('gexlabDesktop', {
  platform: process.platform,
});
