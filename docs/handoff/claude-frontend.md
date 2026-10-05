# 給 Claude：前端實作說明

你負責這個專案的**前端**（`packages/web`）。後端由另一個 session「項目後端修正」負責，它正在原本的資料夾（`C:\Users\User\Desktop\3D通用地圖編輯器`）的 `backend` 分支上修第二輪問題。請不要修改後端的程式碼。

你在獨立的 worktree 工作：`C:\Users\User\Desktop\mapedit-frontend`，分支 `frontend`（從 `backend` 分支開出來）。不要在原本的資料夾工作，也不要在那裡切換分支。

**請從 W0 一路做到 W6，中間不要停下來等人確認。** 全部做完後推上 GitHub、開 PR，再通知「遊戲地圖編輯器網頁軟體」這個 session 做檢查。

## 0. 開工前先讀

1. [docs/design.md](../design.md)：整體設計，特別是第 10 節「人的介面」和第 12 節「技術架構」。
2. [docs/protocol.md](../protocol.md)：前後端之間的約定。前端照這份實作，型別在 `packages/protocol`。
3. [CONTEXT.md](../../CONTEXT.md)：用語表。程式裡的命名用這裡的英文詞，不要另外發明同義詞。
4. [docs/adr/0003-agent-first-simple-ui.md](../adr/0003-agent-first-simple-ui.md)：人的操作要像玩 Minecraft 一樣簡單。
5. [docs/handoff/backend-status.md](backend-status.md) 的「需要前端配合」段落。

## 1. 你負責的範圍

| 位置 | 內容 |
|---|---|
| `packages/web` | 瀏覽器介面和 `/render` 截圖頁面 |
| repo 根目錄 | 只改讓 web 加入建置、lint 和測試所需的最少設定 |
| `docs/handoff/frontend-status.md` | 進度回報（由你維護） |
| `docs/protocol.md` | 只能新增、而且要先改文件再改型別；改完通知後端 session |

## 2. 工作方式

- 照順序一路做完，中間不要停下來等人確認。每個階段結束時：測試通過、commit（例如 `feat(web): W1 ...`）、更新 `frontend-status.md`，然後直接做下一個。
- 設計文件沒寫清楚的地方，照設計原則選最合理的做法，記在 `frontend-status.md` 的「自行決定的事」，然後繼續。
- 需要後端配合的事，用 SendMessage 告訴「項目後端修正」，同時記在 `frontend-status.md` 的「需要後端配合」，然後繼續做其他部分，不要等。
- 後端的修正 commit 在 `backend` 分支上（同一個 repo，所以你這邊看得到）。F19（mock 的標記高度）、F21（ref 錯誤時不斷線）、F23（違規 params 的定義）落地後，用 `git merge backend` 合進來。
- 只有人能處理的事，跳過那一項，記在「需要人處理」，繼續做其他部分。
- `frontend-status.md` 隨時保持最新，它也是你的進度紀錄；對話被壓縮後先讀它再接著做。

## 3. 里程碑

### W0：骨架

- `packages/web`：Vite、TypeScript strict、three.js。介面不需要大型框架，相依套件越少越好，授權要和 MIT 相容。
- 接進 workspace：根目錄的 `pnpm build` 會一起建出 `packages/web/dist`；lint 和測試也涵蓋 web。
- Vite 開發伺服器把 `/api`、`/assets`、`/ws` 轉給後端（預設 `http://127.0.0.1:4790`）。注意：後端會檢查 `Host` 和 `Origin`，所以代理要改寫 `Host`（`changeOrigin`），WebSocket 也要把 `Origin` 改成 `http://127.0.0.1:4790`，不然會被拒絕。
- **驗收**：連上 `mapedit dev --mock`，畫面顯示專案名稱和連線狀態。

### W1：畫出場景

- WebSocket 客戶端：`hello` → `welcome` → `openMap` → `scene`、`history`；斷線自動重連。
- 畫出快照的每一種資料：地形切塊、模組（同類型用 `InstancedMesh`）、地基延伸、點標記和方形標記、太陽光。
- 地圖切換（`ProjectInfo.maps`）、載入中的狀態。
- 新快照進來時只重新載入有變的部分；glb 依網址快取（網址不會變內容）。
- **驗收**：mock 的每一種資料都畫得出來；1000 × 1000 公尺的真實地圖（最多 1,024 個地形切塊、數千個模組）可以順暢操作。

### W2：俯瞰操作

- 鏡頭：右鍵拖曳旋轉、中鍵拖曳或 WASD／方向鍵平移、滾輪往游標方向縮放、F 對焦到選取的東西，不能飛出地圖太遠。
- 滑過時顯示提示（結構名稱、模組類型、標記類型）。
- 點選：第一次點選整個結構；再點一次同一個結構裡的模組，就只選那個模組（為了刪除單一模組）；也能點選標記；Esc 取消選取。
- **驗收**：上面每一種操作都有測試或實際操作紀錄。

### W3：編輯

- 拖動結構或標記：顯示半透明預覽。拖動中每個畫面最多送一個 `previewEdit`；還沒收到回覆前只保留最新的一個。`ok` 為 false 時預覽變紅，並在游標旁顯示原因。
- 放下時送 `applyEdit`（帶拖動開始時的 `baseRevision`）。被拒絕就讓預覽消失、東西留在原位，並顯示原因。
- R 鍵：選取的結構或標記轉 15 度；拖動中按 R 轉的是預覽。
- Delete／Backspace 刪除；Ctrl+Z 復原、Ctrl+Y 或 Ctrl+Shift+Z 重做。
- 修改紀錄面板：列出每次修改是人還是 Agent 做的、時間，以及目前停在哪一步。
- 沒有數值面板，也沒有三軸箭頭（ADR 0003）。
- **驗收**：拖動成功、被拒絕、旋轉、刪除、復原、重做在 mock 和真的專案上都能用；真的專案拖動後 YAML 有更新、註解還在。

### W4：違規、提示、語言

- 場景裡有違規的東西用紅色標出；違規有 `location` 的地方加上標示。
- 違規清單：點一下就對焦到那個位置並標出相關物件。檔案錯誤（`fileErrors`）要顯示檔名和行號。
- `notice` 依 `code` 翻成介面語言的提示訊息。mock 可以用 `POST /api/mock/trigger`（body `{ "notice": "<code>" }`）觸發每一種。
- 介面語言：繁體中文和英文。預設跟瀏覽器語言，可以切換，記在 `localStorage`（讀寫都要包 try/catch）。
- 違規的翻譯：F23 會在 protocol.md 定義每一種違規的 params。定義出來之前，先顯示違規種類的翻譯名稱，加上英文的 `message` 和 `suggestion`。
- **驗收**：每一種違規和每一種 notice 都有畫面；切換語言後介面文字全部跟著換。

### W5：`/render` 截圖頁面

- 照 protocol.md 第 6 節實作 `window.mapeditRenderReady` 和 `window.mapeditRender(spec)`。
- 每個角度：`top` 從正上方往下看、北方朝上；`ne`、`nw`、`se`、`sw` 從那個方向的上空斜著看中心。拼成一張圖，每一格左上角標出角度名稱，`top` 那一格畫指北標示。
- 支援 `focus`、`highlight`、`showViolations`、`minRevision`。頁面上不要有任何介面元素。
- 後端用無頭的系統 Edge 打開這個頁面，而且會擋掉所有不是同一個來源的請求，所以不能載入任何外部資源。每次截圖都會開新頁面，30 秒內要把 `mapeditRenderReady` 設成 true。
- 無頭模式下 WebGL 不一定能用。如果建立不了，請後端 session 調整瀏覽器的啟動參數（例如 `--enable-unsafe-swiftshader`）。
- **驗收**：在真的伺服器上透過 MCP 的 `screenshot` 工具拿到正確的拼圖（可以參考後端測試用 MCP SDK 客戶端的寫法），並把截圖附在 `frontend-status.md`。

### W6：端到端驗收

- 用真的專案（`mapedit init` 的範例，加上 `pnpm e2e` 產生的村莊）走一遍：畫面正確；手動改 YAML（模擬 Agent），網頁即時更新；人拖動後檔案正確寫回。
- `pnpm build` 之後，`mapedit dev` 直接在 `http://127.0.0.1:4790` 提供編輯器。
- 更新 README 的執行說明。
- **驗收**：typecheck、lint、測試全部通過；推上 GitHub 後 CI 綠燈。

## 4. 已經知道的細節

- **pnpm**：版本是 11.19（見根目錄 `packageManager`）。Git Bash 的 PATH 上可能沒有 pnpm，可以改用 PowerShell 或 corepack。新的 worktree 要先 `pnpm install`、`pnpm build`，才能用 `node packages/cli/dist/index.js dev --mock` 啟動 mock。
- **座標**：模組的 glb 是模組自己的座標系；地形和地基延伸的 glb 是地圖座標。矩陣是 column-major，可以直接用 `Matrix4.fromArray()`。
- **預覽結果**：`previewResult.transform` 是對齊之後結構的轉換矩陣；標記則是它的位置加旋轉。
- **太陽方向**：protocol.md 沒有定義 `azimuth` 的方向。請自己定義（建議：從上往下看，從北方順時針量，0 度是北方 −Z、90 度是東方 +X），寫進 protocol.md 第 2 節，並通知後端 session，讓 `docs/map-format.md` 一致。
- **靜態檔**：後端提供 `packages/web/dist` 時，只認得 `.html`、`.js`、`.css`、`.png`、`.svg` 的 MIME 類型。字型請用系統字型；不要 import `@mapedit/core`（規則判斷都在後端，而且它需要 wasm）。如果真的需要其他檔案類型，請後端 session 加 MIME。
- **WebSocket**：後端依序處理訊息，`editResult` 會比新的 `scene`、`history` 先到。格式錯誤的訊息會讓連線以 1008 關閉；F21 修好前，失效的 ref 也會斷線，所以要能自動重連。
- **物件參照**：用 `@mapedit/protocol` 的 `parseObjectRef`、`structureRef` 等函式，不要自己拼字串。
- **驗證畫面**：用瀏覽器預覽工具，對 mock 和真的專案實際截圖確認。

## 5. 第一版不要做

- 第一人稱模式、用快捷欄放新模組、把模組拖到別的插槽
- 散佈區、外部素材、程式寫的貼圖、水位、會發光的模組（太陽以外的燈光）
- 任何數值面板或專業編輯器的功能
