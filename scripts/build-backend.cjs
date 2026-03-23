const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const backendDir = path.join(rootDir, 'backend');
const candidates = [
  process.env.GEXLAB_PYTHON,
  path.join(backendDir, 'venv', 'Scripts', 'python.exe'),
  path.join(backendDir, 'venv', 'bin', 'python'),
  'python',
  'py',
].filter(Boolean);

function tryCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });

  if (!result.error && result.status === 0) {
    return true;
  }

  return false;
}

for (const candidate of candidates) {
  const exists = candidate === 'python' || candidate === 'py' || fs.existsSync(candidate);
  if (!exists) {
    continue;
  }

  const candidateArgs = candidate === 'py' ? ['-3'] : [];
  const args = [
    ...candidateArgs,
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--name',
    'gexlab-backend',
    '--distpath',
    'desktop-build/backend',
    '--workpath',
    'desktop-build/pyinstaller/build',
    '--specpath',
    'desktop-build/pyinstaller',
    'backend/desktop_runner.py',
  ];

  if (tryCommand(candidate, args)) {
    process.exit(0);
  }
}

console.error('Unable to find a usable Python interpreter for desktop backend packaging.');
process.exit(1);
