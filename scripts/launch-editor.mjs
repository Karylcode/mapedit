// Double-click launcher behind 啟動地圖編輯器.bat: builds when the checkout changed,
// creates a map project on first use, then runs `mapedit dev --open`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNPM = 'pnpm@11.19.0';
const PORT = 4790;
const URL = `http://127.0.0.1:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'packages', 'cli', 'dist', 'index.js');

process.title = '3D 地圖編輯器';

function fail(message) {
  console.error(`\n${message}\n啟動失敗。請把上面的訊息複製給 Claude 看。`);
  process.exit(1);
}

function run(command, args, options = {}) {
  // With a shell, Node wants one command string; these arguments are fixed, never user input.
  const result = options.shell
    ? spawnSync([command, ...args].join(' '), { stdio: 'inherit', ...options })
    : spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) fail(`無法執行 ${command}：${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 結束代碼 ${result.status}。`);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  fail(`Node.js 版本是 ${process.versions.node}，需要 22.13 以上：https://nodejs.org`);
}

// pnpm is not on this machine's PATH, and the root build script calls `pnpm` again,
// so a small shim lets every nested call go through corepack.
function pnpmEnvironment() {
  const bin = path.join(root, '.cache', 'launcher-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'pnpm.cmd'), `@corepack ${PNPM} %*\r\n`);
  writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\nexec corepack ${PNPM} "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = `${bin}${path.delimiter}${env[key] ?? ''}`;
  return env;
}

function currentCommit() {
  const result = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

const stamp = path.join(root, '.cache', 'launcher-build.txt');
const commit = currentCommit();
const built =
  existsSync(path.join(root, 'node_modules')) &&
  existsSync(cli) &&
  existsSync(path.join(root, 'packages', 'web', 'dist', 'index.html')) &&
  existsSync(stamp) &&
  readFileSync(stamp, 'utf8').trim() === commit;

if (!built) {
  console.log('正在安裝和建置編輯器，第一次大約需要幾分鐘……\n');
  const env = pnpmEnvironment();
  const shell = process.platform === 'win32';
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: root, env, shell });
  run('pnpm', ['build'], { cwd: root, env, shell });
  if (!existsSync(path.join(root, 'packages', 'web', 'dist', 'index.html'))) {
    fail('建置完成，但找不到編輯器的畫面（packages/web/dist）。這個版本可能還沒有前端。');
  }
  mkdirSync(path.dirname(stamp), { recursive: true });
  writeFileSync(stamp, `${commit}\n`);
}

let project = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(root, '..', 'mapedit-maps');
if (existsSync(project) && statSync(project).isFile()) project = path.dirname(project);
if (!existsSync(path.join(project, 'project.yaml'))) {
  console.log(`建立新的地圖專案：${project}\n`);
  run(process.execPath, [cli, 'init', project]);
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function openBrowser() {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', URL]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [URL]];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

if (await portInUse()) {
  console.log('編輯器已經在執行中，直接打開瀏覽器。');
  console.log('如果打開的不是你要的專案，請先關掉另一個編輯器視窗，再重新執行。');
  openBrowser();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  process.exit(0);
}

console.log(`
  編輯器網址：${URL}
  地圖專案：${project}
  要讓 Agent 連上，在這個專案資料夾開 Claude Code 或 Codex。
  關閉這個視窗，編輯器就會停止。
`);
// Ctrl+C reaches the editor too; wait for it to shut down cleanly.
process.on('SIGINT', () => {});
const editor = spawn(process.execPath, [cli, 'dev', '--open'], { cwd: project, stdio: 'inherit' });
editor.on('exit', (code) => process.exit(code ?? 0));
