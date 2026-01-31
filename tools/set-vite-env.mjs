import { spawn } from 'node:child_process';
import { getBuildInfo } from './build-info.mjs';

const [, , modeArg, ...command] = process.argv;

if (!modeArg || command.length === 0) {
  console.error('Usage: node tools/set-vite-env.mjs <dev|build> <command> [args...]');
  process.exit(1);
}

const mode = modeArg === 'dev' ? 'dev' : 'prod';
const buildInfo = getBuildInfo({ mode });

const env = { ...process.env };

const setIfMissing = (key, value) => {
  if (!env[key]) {
    env[key] = value;
  }
};

const setAlways = (key, value) => {
  env[key] = value;
};

const setEnvValue = mode === 'dev' ? setIfMissing : setAlways;

setEnvValue('VITE_BUILD_LABEL', buildInfo.label);
setEnvValue('VITE_BUILD_VERSION', buildInfo.version ?? '');
setEnvValue('VITE_BUILD_COMMIT', buildInfo.commit ?? '');
setEnvValue('VITE_BUILD_TIME', buildInfo.buildTime);

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
