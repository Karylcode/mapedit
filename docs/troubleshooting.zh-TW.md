[English](troubleshooting.md) | **繁體中文** · [文件索引](README.zh-TW.md)

# 疑難排解

## 啟動和更新

- **`.bat` 檔顯示 `Node.js was not found`**：到 https://nodejs.org 安裝 Node.js 22.13 以上，再執行一次。
  Node.js 版本太舊時，啟動檔也會停下來，顯示「需要 22.13 以上」。
- **啟動檔在 `pnpm install` 失敗，說找不到 `corepack`**：啟動檔透過 Corepack 執行 pnpm，而 Node.js 25 以後
  不再內附 Corepack。執行 `npm install -g corepack`，或改用 Node.js 22 或 24。
- **啟動檔說建置完成，但找不到 `packages/web/dist`**：目前這個版本沒有瀏覽器編輯器。用 `更新.bat` 更新。
- **拖進去的資料夾「不是地圖專案資料夾」**：只有含 `project.yaml` 的資料夾（或裡面的檔案）可以拖到
  `啟動地圖編輯器.bat` 上。
- **瀏覽器打開的不是你要的專案**：4790 連接埠已經有人在用，啟動檔只是打開了原本就在執行的編輯器。
  先關掉另一個編輯器視窗，再重新執行。
- **`更新.bat` 顯示「找不到 Git」**：到 https://git-scm.com/download/win 安裝 Git。
- **`更新.bat` 列出這台電腦上改過的檔案後停下來**：它不會蓋掉你改過的 Git 管理檔案。如果不需要這些修改，
  先還原（例如 `git restore <檔案>`）再更新。
- **`更新.bat` 說本機分支有 GitHub 上沒有的 commit**：它只做快轉。先決定要保留哪一邊（例如用 `git log`、
  `git rebase`），再更新。
- **`更新.bat` 連不上 GitHub**：確認網路連線，或稍後再試。

## 編輯器

- **網頁顯示 `Mapedit backend is running. Build packages/web to use the editor.`**：執行 `pnpm build`。
- **4790 連接埠出現 `listen EADDRINUSE`**：有其他程式或另一個編輯器佔用這個連接埠。關掉它，或用
  `mapedit dev --port <port>` 啟動。HTTP 的 MCP 設定指向 4790，這時 Agent 要改用 stdio 設定
  （見 [Agent 工作流程](agent-workflow.zh-TW.md#連線方式)）。
- **`Host or Origin is not allowed.`**：伺服器只回應 `http://127.0.0.1:<port>` 和 `http://localhost:<port>`。
  其他主機名稱（例如電腦的網路位址）以及來自其他網站的請求都會被拒絕。
- **放下時被拒絕，東西彈回原位**：放在那裡會造成違規。拖曳時，游標旁的提示會寫出第一個違規；換個位置放。
- **模組或已經接上的結構拖不動**：只有整個結構和標記可以移動，請拖它的根結構。單一模組仍然可以刪除。
- **什麼修改都不接受**：專案裡有檔案讀不了。先修好左邊列出的檔案錯誤。
- **`還沒連上編輯器伺服器，這次的修改沒有送出`**：伺服器停了或正在重新啟動。重新執行 `mapedit dev`，網頁會自動重新連線。

## Agent 與 MCP

- **Agent 改到別的專案**：HTTP 的 MCP 操作的是編輯器目前開著的專案。切換「專案」選單，或改用 stdio 設定。
- **Agent 看不到 Mapedit 的工具**：用 HTTP 設定時，編輯器必須開著。啟動編輯器，或改用 `.mcp.stdio.json`／
  `.codex/config.stdio.toml`，它們需要時會自己啟動伺服器。
- **搬資料夾後 stdio 不能用**：stdio 設定裡寫的是 Node.js 和 CLI 的絕對路徑。更新這些路徑，或在新資料夾執行
  `init` 再複製路徑過來。
- **`Results changed since the first page.`**：Agent 翻頁時，專案檔案有變動。不帶 `cursor` 重新執行工具。
- **`This continuation cursor is unavailable or expired.`**：分頁結果只保留五分鐘。重做會修改東西的工具前，
  先看目前的狀態。
- **`model.ts` 的檔案錯誤**：模型執行失敗、超過時限，或超出宣告的尺寸。用 `build_module` 看診斷結果；
  限制見英文的[建模 API 與隔離執行](model-api.md)。

## 截圖

| 訊息開頭                                                 | 處理方式                                         |
| -------------------------------------------------------- | ------------------------------------------------ |
| `No supported system browser was found`                  | 安裝 Edge 或 Chrome。                            |
| `The editor web build is missing; run pnpm build.`       | 執行 `pnpm build` 後再試一次。                   |
| `The headless browser did not start within 50 seconds`   | 再試一次；瀏覽器會在背景繼續啟動。               |
| `The render page did not become ready within 50 seconds` | 確認編輯器網頁在你的瀏覽器裡能正常打開，再試一次。 |
| `The render page did not finish within 50 seconds`       | 減少 `views` 或縮小 `tileSize`。                 |
| `Render page error:`                                     | 頁面回報了問題，例如沒有 WebGL 或找不到地圖。    |

## 檢查和匯出

- **`check` 以代碼 1 結束**：有地圖有違規或檔案錯誤。照清單修好再檢查。`canFloat` 只是提示，不影響結束代碼。
- **`Export refused for maps: …`**：列出的地圖有違規或檔案錯誤，什麼都沒有寫出。先執行 `check` 修好。
- **`export requires --out <directory>.`**／**`--map requires a map ID.`**：補上缺少的值。
- **`Init refused to overwrite existing file: …`**：`init` 不會覆寫檔案。請用空的或新的資料夾。
- **`dev --projects <資料夾>` 出現 `… has no projects.`**：用 `mapedit init <資料夾>/my-maps` 建立一個。
- **地形的檔案錯誤**：`terrain/height.png` 和 `terrain/surface.png` 要兩張都有、而且大小和地圖一樣，或兩張都沒有
  （平坦草地）。請用 `terrain` 工具改地形，不要手動改。

## Unity

- **標記沒有換成 prefab**：沒有對應到它類型的設定。這是故意的：標記和它的資料會留給遊戲程式使用。
  在 Marker Mapping 裡新增一筆。
- **有好幾個對應檔**：到 **Project Settings → UnityGLTF → Mapedit game metadata** 選一個。
- **`scripts/test-unity.ps1` 顯示 `Unity 6 is not installed at …`**：加上 `-UnityPath <Unity.exe 的路徑>`。
- **`Unity timed out` 或 `Verification produced no result`**：看訊息裡寫的日誌檔，在 `.cache/unity/project` 裡。
