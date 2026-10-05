// Double-click launcher behind 啟動地圖編輯器.bat: builds when the checkout changed,
// fills the projects folder on first use, then runs `mapedit dev --open --projects`.
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNPM = 'pnpm@11.19.0';
const PORT = 4790;
const URL = `http://127.0.0.1:${PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'packages', 'cli', 'dist', 'index.js');
/** Every map project lives in its own folder here; git and 更新.bat leave it alone. */
const projects = path.join(root, 'projects');
/** Example projects copied into the projects folder whenever they are missing there. */
const SAMPLES = ['church'];

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

const isProject = (folder) => existsSync(path.join(folder, 'project.yaml'));

/** A folder of the projects folder, or undefined for one elsewhere. */
function projectsChild(folder) {
  const relative = path.relative(projects, folder);
  return relative && !relative.includes(path.sep) && !relative.startsWith('..')
    ? relative
    : undefined;
}

/**
 * The projects folder: the example projects, the project the launcher used to keep
 * next to the checkout, and a note on what goes here.
 */
function prepareProjects() {
  mkdirSync(projects, { recursive: true });
  for (const sample of SAMPLES) {
    const target = path.join(projects, sample);
    if (!existsSync(target)) {
      cpSync(path.join(root, 'templates', sample), target, { recursive: true });
      console.log(`加入範例專案：${target}`);
    }
  }
  const old = path.resolve(root, '..', 'mapedit-maps');
  const moved = path.join(projects, 'my-maps');
  if (isProject(old) && !existsSync(moved)) {
    try {
      renameSync(old, moved);
      console.log(`已經把舊的地圖專案 ${old} 搬到 ${moved}。`);
    } catch (error) {
      console.log(`沒辦法搬移舊的地圖專案 ${old}：${error.message}`);
      console.log(`它還在原來的地方，可以自己把它搬進 ${projects}。`);
    }
  }
  if (!readdirSync(projects).some((name) => isProject(path.join(projects, name)))) {
    console.log(`建立新的地圖專案：${moved}\n`);
    run(process.execPath, [cli, 'init', moved]);
  }
  const readme = path.join(projects, 'README.md');
  if (!existsSync(readme))
    writeFileSync(
      readme,
      [
        '# 地圖專案',
        '',
        '這裡的每個資料夾是一個專案：裡面有 project.yaml、modules/（模組）和 maps/（地圖，一個專案可以有很多張）。',
        '專案之間的模組和地圖互不相通。在編輯器左上角的「專案」可以切換。',
        '',
        '新增專案：在 mapedit-main 資料夾執行 `node packages/cli/dist/index.js init projects/<名稱>`，',
        '或請 Agent 在這裡建立新的專案資料夾。',
        '',
        '這個資料夾不受 Git 管理，更新.bat 不會動到它。刪掉 church 後重新啟動，會拿到最新版的教堂範例。',
        '',
        'Each folder here is a map project (project.yaml, modules/, maps/). Create one with',
        '`node packages/cli/dist/index.js init projects/<name>` from the repository root.',
        '',
      ].join('\n'),
    );
}

if (await portInUse()) {
  console.log('編輯器已經在執行中，直接打開瀏覽器。');
  console.log('如果打開的不是你要的專案，請先關掉另一個編輯器視窗，再重新執行。');
  openBrowser();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  process.exit(0);
}

prepareProjects();

// A project folder dropped on the .bat opens that project: one in the projects folder
// with the others beside it, one elsewhere on its own.
const dropped = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const folder =
  dropped && existsSync(dropped) && statSync(dropped).isFile() ? path.dirname(dropped) : dropped;
if (folder && !isProject(folder)) fail(`${folder} 不是地圖專案資料夾（裡面沒有 project.yaml）。`);
const name = folder && projectsChild(folder);
const devArgs = ['dev', '--open'];
if (!folder || name) devArgs.push('--projects', projects, ...(name ? ['--project', name] : []));

console.log(`
  編輯器網址：${URL}
  ${folder && !name ? `地圖專案：${folder}` : `專案資料夾：${projects}\n  在編輯器左上角的「專案」可以切換專案。`}
  關閉這個視窗，編輯器就會停止。
`);
// Ctrl+C reaches the editor too; wait for it to shut down cleanly.
process.on('SIGINT', () => {});
const editor = spawn(process.execPath, [cli, ...devArgs], {
  cwd: folder && !name ? folder : projects,
  stdio: 'inherit',
});
editor.on('exit', (code) => process.exit(code ?? 0));
