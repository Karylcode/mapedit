// Double-click updater behind 更新.bat: fast-forwards this checkout to its GitHub branch.
// A folder unpacked from a ZIP download is first connected to GitHub, after asking.
// 啟動地圖編輯器.bat notices the new commit and rebuilds on its next start.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where a ZIP download is connected to; tests point it at a local repository. */
const REPOSITORY =
  process.env.MAPEDIT_UPDATE_REPOSITORY ?? 'https://github.com/Karylcode/mapedit.git';
const BRANCH = 'main';

process.title = '更新地圖編輯器';

function fail(message) {
  console.error(`\n${message}\n更新失敗。請把上面的訊息複製給 Claude 看。`);
  process.exit(1);
}

/** Run git in the checkout; returns trimmed stdout, or undefined when git fails. */
function git(args, { show = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: show ? 'inherit' : 'pipe',
  });
  if (result.error || result.status !== 0) return undefined;
  return (result.stdout ?? '').trim();
}

function sameFolder(a, b) {
  try {
    const [x, y] = [a, b].map((p) => realpathSync(p));
    return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
  } catch {
    return false;
  }
}

async function editorRunning() {
  return new Promise((resolve) => {
    const socket = net.connect(4790, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function finish() {
  console.log(
    (await editorRunning())
      ? '\n編輯器現在還開著，用的是舊版本。請關掉編輯器視窗，再雙擊 啟動地圖編輯器.bat。'
      : '\n雙擊 啟動地圖編輯器.bat 就會用新版本，第一次啟動會自動重新建置，需要幾分鐘。',
  );
}

/** A folder from a ZIP download: connect it to GitHub so later updates work. */
async function connect() {
  if (existsSync(path.join(root, '.git')))
    fail('這個資料夾的 Git 紀錄（.git）好像壞掉了，沒辦法自動更新。');
  console.log('這個資料夾是用 ZIP 下載的，還沒有和 GitHub 連在一起，所以沒辦法自動更新。');
  console.log(`現在可以把它接上 GitHub：下載 ${BRANCH} 的最新版本，蓋過這個資料夾裡的程式檔案。`);
  console.log('你的地圖專案在另一個資料夾，不會受影響；你自己放進這個資料夾的其他檔案也會留著。\n');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('要接上 GitHub 嗎？輸入 Y 再按 Enter：');
  prompt.close();
  if (!/^y(es)?$/i.test(answer.trim()))
    fail(`沒有接上 GitHub，這次不更新。\n也可以自己用 git clone ${REPOSITORY} 重新下載。`);

  // Anything that goes wrong leaves the folder as it was: just the ZIP's files.
  const undo = (message) => {
    rmSync(path.join(root, '.git'), { recursive: true, force: true });
    fail(message);
  };
  if (git(['init', '--quiet']) === undefined) undo('沒辦法在這個資料夾建立 Git 紀錄。');
  if (git(['remote', 'add', 'origin', REPOSITORY]) === undefined)
    undo('沒辦法設定 GitHub 的網址。');
  console.log(`\n正在從 GitHub 下載 ${BRANCH} 的最新版本……\n`);
  if (git(['fetch', 'origin', BRANCH], { show: true }) === undefined)
    undo('連不上 GitHub。請確認網路連線，或稍後再試。');
  if (git(['checkout', '--force', '-B', BRANCH, '--track', `origin/${BRANCH}`]) === undefined)
    undo('套用 GitHub 上的版本時出了問題。');
  console.log('\n已經接上 GitHub，現在是最新版本。以後雙擊 更新.bat 就會自動更新。');
  await finish();
  process.exit(0);
}

if (git(['--version']) === undefined)
  fail('找不到 Git。請先安裝 Git：https://git-scm.com/download/win');
const top = git(['rev-parse', '--show-toplevel']);
if (!top || !sameFolder(top, root)) await connect();

const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
if (!branch) fail('目前不在任何分支上，沒辦法判斷要更新哪一個版本。');
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
if (!upstream) fail(`分支 ${branch} 沒有對應的 GitHub 分支，沒辦法更新。`);

const changed = git(['status', '--porcelain', '--untracked-files=no']);
if (changed)
  fail(
    `這些檔案在這台電腦上被修改過，為了不蓋掉你的修改，這次不更新：\n${changed}\n` +
      '如果不需要這些修改，可以請 Claude 幫你還原後再更新。',
  );

const before = git(['rev-parse', 'HEAD']);
console.log(`正在從 GitHub 下載 ${upstream} 的最新版本……\n`);
if (git(['fetch', '--prune'], { show: true }) === undefined)
  fail('連不上 GitHub。請確認網路連線，或稍後再試。');
const after = git(['rev-parse', upstream]);

if (before === after) {
  console.log('\n已經是最新版本，不需要更新。');
  process.exit(0);
}
if (git(['merge-base', '--is-ancestor', 'HEAD', upstream]) === undefined)
  fail(
    `這台電腦上的 ${branch} 有 GitHub 上沒有的提交，沒辦法直接更新。\n` +
      '請 Claude 幫你看要保留哪一邊。',
  );

// Git will not overwrite a file it does not track, such as one left over from a ZIP
// download, when the update adds a file of the same name: set those aside first.
const added = (
  git(['diff', '--name-only', '--no-renames', '--diff-filter=A', '-z', 'HEAD', upstream]) ?? ''
)
  .split('\0')
  .filter(Boolean);
const backup = path.join(
  root,
  '.cache',
  'update-backup',
  new Date().toISOString().replace(/\D/g, ''),
);
const moved = added.filter((file) => {
  const source = path.join(root, file);
  if (!existsSync(source)) return false;
  mkdirSync(path.dirname(path.join(backup, file)), { recursive: true });
  renameSync(source, path.join(backup, file));
  return true;
});
if (moved.length)
  console.log(
    `\n新版本加入的這些檔案，原本就有同名的舊檔案，舊的已經移到 ${path.relative(root, backup)}：\n  ` +
      moved.join('\n  '),
  );

if (git(['merge', '--ff-only', '--quiet', upstream], { show: true }) === undefined)
  fail('套用更新時出了問題。');

console.log('\n更新完成。這次新增的內容：\n');
git(['log', '--oneline', '--no-decorate', `${before}..${after}`], { show: true });
await finish();
