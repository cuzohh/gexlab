const { contextBridge } = require('electron');

const apiBaseArg = process.argv.find((argument) => argument.startsWith('--gexlab-api-base='));
const apiBase = apiBaseArg ? apiBaseArg.replace('--gexlab-api-base=', '') : null;

contextBridge.exposeInMainWorld('gexlabDesktop', {
  apiBase,
  isDesktop: true,
});
