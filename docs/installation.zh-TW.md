[English](installation.md) | **繁體中文** · [文件索引](README.zh-TW.md)

# 安裝

## 需求

- **Node.js 22.13 以上。** `package.json` 的 `engines.node` 是 `>=22.13`，Windows 啟動檔一開始就會檢查版本。
- **pnpm 11.19。** `package.json` 固定用 `pnpm@11.19.0`。Windows 啟動檔透過 Corepack 執行這個版本，
  Node.js 22 和 24 都內附 Corepack，所以 `PATH` 上不需要有 pnpm。手動安裝時 `PATH` 上要有 `pnpm`，
  因為 `pnpm build` 會再呼叫 `pnpm`（[pnpm 安裝說明](https://pnpm.io/installation)）。
- **Windows 或 Linux。** CI 在 `windows-latest` 和 `ubuntu-latest` 上，用 Node.js 22 和 24 執行型別檢查、
  lint 和測試。兩個 `.bat` 檔只能在 Windows 上用。
- **Edge 或 Chrome**，給 MCP 的 `screenshot` 工具和瀏覽器測試使用，都是無頭模式。Mapedit 會在常見的安裝
  位置找：Windows 和 macOS 上找 Edge 或 Chrome；Linux 上找 `/usr/bin` 裡的 `google-chrome`、`chromium`、
  `chromium-browser` 或 `microsoft-edge`。
- **Git**，給 `git clone` 和 `更新.bat` 使用。
- **網路連線**：第一次安裝相依套件（以及在 Unity 裡安裝 UnityGLTF）時需要。之後 Mapedit 不呼叫任何線上
  服務，材質圖片等素材都已經在 repo 裡。
- **選用：Unity 6** 加上 UnityGLTF 2.21.0，用來匯入地圖。見[匯出](exporting.zh-TW.md)。

這些套件還沒有發佈到 npm（每個 `package.json` 都保留 `"private": true`），CLI 要從這個 repo 執行。

## Windows：啟動檔

1. 取得 repo：`git clone https://github.com/Karylcode/mapedit.git`，或從 GitHub 下載 ZIP 再解壓縮。
2. 雙擊 `啟動地圖編輯器.bat`。

啟動檔（`scripts/launch-editor.mjs`）接著會：

- 確認 Node.js 是 22.13 以上；
- 只要目前的 commit 和上次建置時不同，就執行 `pnpm install --frozen-lockfile` 和 `pnpm build`。
  第一次大約需要幾分鐘；
- 建立 `projects/` 資料夾；如果 `projects/church` 不存在，就把 Grey Church 範例（`templates/church`）複製過去；
- 把舊版放在 repo 旁邊 `../mapedit-maps` 的地圖專案搬成 `projects/my-maps`；
- 用 `mapedit dev --open --projects projects` 啟動編輯器，並打開 `http://127.0.0.1:4790`。

關閉啟動檔的視窗，編輯器就會停止。如果 4790 連接埠已經有人在用，啟動檔會當成編輯器已經在執行，
只打開瀏覽器。

想打開某個專案，就把它的資料夾（或裡面任何一個檔案）拖到 `啟動地圖編輯器.bat` 上。`projects/` 裡的專案
打開後，「專案」選單裡也能切換到其他專案；放在別的地方的專案會單獨打開。

## 手動安裝（任何系統）

```sh
git clone https://github.com/Karylcode/mapedit.git
cd mapedit
pnpm install
pnpm build
```

`pnpm build` 會編譯 TypeScript 套件，並把瀏覽器編輯器建置到 `packages/web/dist`。之後 CLI 就是
`packages/cli/dist/index.js`：

- 在 repo 根目錄可以用 `pnpm mapedit <指令>`；
- 在其他地方用 `node <repo 路徑>/packages/cli/dist/index.js <指令>`。

文件裡寫 `mapedit <指令>` 時，指的就是上面任一種寫法。建立第一個專案並打開：

```sh
pnpm mapedit init projects/my-maps
pnpm mapedit dev --open --projects projects --project my-maps
```

地圖專案請放在 `projects/`。Git 會忽略這個資料夾，所以你的地圖不會變成 repo 的修改。
見[使用方式](usage.zh-TW.md)。

## 更新

**Windows：** 雙擊 `更新.bat`。它會執行 `scripts/update.mjs`：

- 把目前的版本快轉到 GitHub 上對應的分支（`main`），並列出新增的 commit；
- 如果資料夾是從 ZIP 解壓縮的，會先詢問（輸入 `Y`），再把它接上 `https://github.com/Karylcode/mapedit.git`，
  下載 `main`，蓋過程式檔案。你自己放進資料夾的其他檔案會留著；
- 如果這台電腦上改過 Git 管理的檔案，或本機分支有 GitHub 上沒有的 commit，就什麼都不改，並列出它找到的東西；
- 新版本要加入的檔案如果已經有同名的舊檔案，會先把舊的移到 `.cache/update-backup/<時間>/`；
- 不會動到 `projects/`。

下次執行 `啟動地圖編輯器.bat` 時，它會發現 commit 變了並重新建置。如果編輯器還開著，更新程式會提醒你
先關掉，因為它還在用舊版本。

**手動：**

```sh
git pull
pnpm install
pnpm build
```

然後重新啟動 `mapedit dev`。
