// Double-click updater behind 更新.bat: fast-forwards this checkout to its GitHub branch.
// 啟動地圖編輯器.bat notices the new commit and rebuilds on its next start.
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

if (git(['--version']) === undefined)
  fail('找不到 Git。請先安裝 Git：https://git-scm.com/download/win');
if (git(['rev-parse', '--is-inside-work-tree']) !== 'true')
  fail(
    '這個資料夾不是用 git clone 下載的（可能是 ZIP），沒辦法自動更新。\n' +
      '請改用 git clone 下載一次，之後就能用 更新.bat。',
  );

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
if (git(['merge', '--ff-only', '--quiet', upstream], { show: true }) === undefined)
  fail('套用更新時出了問題。');

console.log('\n更新完成。這次新增的內容：\n');
git(['log', '--oneline', '--no-decorate', `${before}..${after}`], { show: true });

const running = await new Promise((resolve) => {
  const socket = net.connect(4790, '127.0.0.1');
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
});
console.log(
  running
    ? '\n編輯器現在還開著，用的是舊版本。請關掉編輯器視窗，再雙擊 啟動地圖編輯器.bat。'
    : '\n雙擊 啟動地圖編輯器.bat 就會用新版本，第一次啟動會自動重新建置，需要幾分鐘。',
);
