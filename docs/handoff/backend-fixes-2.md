# 給 Codex：PR #1 第二輪修正清單

Claude 檢查了第一輪修正（F1–F16）。大部分都確實修好了，上次的重現腳本也全部通過。下面是這一輪新發現的問題，編號接著上一輪，從 F17 開始。

請在同一個 `backend` 分支上修，修完推上去更新 PR。

## 工作方式

- 照編號順序一路修完，中間不要停下來等人確認，做法和 [codex-backend.md](codex-backend.md) 第 9 節相同。
- 每一項都要有測試。修 bug 的項目，先寫出能重現問題的測試，再修到通過。
- 每修完一項就 commit，commit 訊息標上編號，例如 `fix(F17): ...`。
- 前端已經開始由 Claude 開發，會依照 [protocol.md](../protocol.md) 和 mock 來做。動到 protocol.md 時，先改文件再改型別，只能新增，不能讓舊程式壞掉。
- 全部修完之後：確認所有測試在這台 Windows 電腦上通過、推上 GitHub、PR 的 CI 綠燈，並在 `backend-status.md` 新增「第二輪修正」段落，逐項寫出怎麼修、測試在哪裡。

## 一、必修：會讓真的 Agent 用不了

### F17. MCP 工具的參數格式不能在最外層用 `anyOf`

- **位置**：`packages/server/src/mcp.ts:153-156`；`packages/server/test/mcp-paging.test.ts:174` 還把這個格式鎖住了。
- **原因**：F11 把每個工具的 `inputSchema` 改成 `{ type: 'object', anyOf: [原本的參數, { cursor }] }`。Anthropic API 不接受最外層的 `anyOf`／`oneOf`／`allOf`，會回 400，而且 Claude Code 每次請求都會帶完整工具清單，所以整個 session 都會壞掉。OpenAI 也不接受最外層是 union。現有測試只用 MCP SDK 的客戶端，所以測不出來。
  - 參考：[anthropics/claude-code#84056](https://github.com/anthropics/claude-code/issues/84056)、[anthropics/claude-code#95504](https://github.com/anthropics/claude-code/issues/95504)、[imagekit-developer/imagekit-nodejs#150](https://github.com/imagekit-developer/imagekit-nodejs/issues/150)
- **修法**：每個工具的 `inputSchema` 都改回單一 object：`{ type: 'object', properties: { …原本的參數, cursor }, … }`，`cursor` 是可選欄位。「有 `cursor` 時不能再帶其他參數」改成執行時檢查，回傳清楚的錯誤訊息。
- **驗收**：
  - 新增測試：每個工具的 `inputSchema` 最外層都是 `type: 'object'`、有 `properties`，而且沒有 `anyOf`、`oneOf`、`allOf`、`not`、`if`、`then`、`else`。
  - 用真的 Codex 呼叫至少一個工具，結果記在 `backend-status.md`。真的 Claude Code 如果這台電腦沒辦法執行，就記在「需要人處理」，不要停下來等。

## 二、必修：行為錯誤

### F18. 「沒有支撐」的建議沒考慮同一個結構裡的插槽

- **位置**：`packages/core/src/geometry-suggestions.ts:169-186`、`:213`。
- **原因**：F5 只試「整個結構往下移」，而且排除同一個結構裡的插槽。最常見的情況是：同一個結構裡，屋頂浮在牆上方 1 公尺，兩者有相容的空插槽，距離 1 公尺。現在的建議卻是 `No clear downward move… set canFloat: true`，不但給錯，還會引導 Agent 濫用「可以浮空」。
- **修法**：
  - 先找能撐住這個模組的位置：只移動這個模組往下，或接到附近（包括同一個結構裡）相容的空插槽。
  - 找到就具體寫出來，例如 `Attach roof to wall_n.top (1 m below).`
  - 附近有相容的空插槽時，絕對不要建議標成可以浮空。
- **驗收**：上面那個屋頂的情境有測試，建議內容是接到正確的插槽。

### F19. mock 的標記拖動還是會埋進地面

- **位置**：`packages/server/src/state.ts:105`、`:176`。
- **原因**：F2 只修了正式的流程。mock 拖動標記時還是把高度設成 0，例如方形標記中心從 `[10,1,5]` 拖完變成 `[30,0,30]`。前端靠 mock 開發，所以 mock 的行為也要正確。
- **修法**：mock 和正式流程用同一個函式計算標記的新高度。
- **驗收**：透過 WebSocket 拖動 mock 的方形標記，底面和地面的距離不變。

### F20. 違規很多的時候會超過效能目標

- **原因**：F5 的建議搜尋只在有違規時才執行，但現有的效能測試全是零違規的情境，所以沒量到。2,000 個模組全部密集重疊時：關掉建議搜尋要 2.1 秒，開著要 8.0 秒，超過「2,000 個模組在 2 秒內」的目標。
- **修法**：限制昂貴的建議搜尋，例如一次檢查最多為前 50 筆違規算出完整的建議，其他用簡短的建議，並註明「修完前面的再重新檢查」。
- **驗收**：新增「2,000 個模組、大量違規」的效能測試，2 秒內完成。

### F21. WebSocket 收到格式錯誤的 ref 會直接斷線

- **位置**：`packages/server/src/index.ts:52`、`:254`。
- **原因**：protocol.md 沒有寫這件事。前端手上的 ref 可能因為 Agent 剛改了檔案而失效，這時候斷線，對人來說很突然。
- **修法**：
  - `previewEdit`、`applyEdit` 收到格式錯誤或不存在的 ref 時，不要斷線。分別回 `previewResult { ok: false }`（附一筆 `missing_reference` 違規）和 `editResult { ok: false, reason }`。
  - 只有訊息本身的結構不合法時才斷線（1008）。
  - 把這兩條規則寫進 protocol.md 第 4 節的流程。
- **驗收**：WebSocket 測試涵蓋格式錯誤的 ref 和不存在的 ref，連線都不會斷。

### F22. MCP 分頁的續頁可能拿到過時的結果

- **位置**：`packages/server/src/mcp.ts:158-161`。
- **原因**：帶 `cursor` 的續頁直接從快取拿，沒有先處理最新的檔案變動。Agent 改了檔案之後拿到的續頁，還是改之前的內容，違反 codex-backend.md 第 4 節「回答前必須先處理完最新的檔案變動」。
- **修法**：處理續頁前先處理檔案變動。如果專案在第一頁之後有變，就讓 cursor 失效，回傳清楚的錯誤：`Results changed since the first page. Run the tool again without cursor.`
- **驗收**：先拿第一頁、改檔案、再拿續頁，會得到上面的錯誤訊息。

## 三、必修：前後端約定缺漏

### F23. 定義每一種違規的 `params`

- **原因**：protocol.md 說「前端用 kind 加 params 翻成介面語言」，卻沒定義每一種 kind 有哪些 params。mock 的違規只帶 `file` 和 `line`（`packages/server/src/mock.ts:20-29`），正式的違規還有 `values`、`rotation`、`step`、`reference`、`socketA`、`socketB` 等。前端不管照文件還是照 mock，都做不出翻譯。
- **修法**：
  - 在 protocol.md 第 3 節新增一張表，列出每一種 kind 的 params：欄位名稱、型別、意思。照正式程式目前送出的內容整理，必要時調整成前端翻譯得出來的形狀（例如 `out_of_bounds` 要有方向和距離）。
  - `packages/protocol` 匯出每一種 kind 的 params 型別。
  - 正式和 mock 的違規都照這張表送。
- **驗收**：測試確認正式和 mock 產生的每一種違規，params 都符合文件。

### F23b. `.mapedit/` 要加進 .gitignore

- **原因**：`mapedit dev` 會在專案根目錄寫入 `.mapedit/server.json`（CLI 用來找正在執行的伺服器）。這是執行期的暫存資料，但 repo 和 `init` 產生的專案都沒有忽略它。使用者很可能不小心把它 commit 進去。
- **修法**：repo 的 `.gitignore` 加上 `.mapedit/`；`init` 產生的專案也附一個 `.gitignore`，至少忽略 `.mapedit/`。
- **驗收**：`init` 產生的專案裡有 `.gitignore`，而且包含 `.mapedit/`。

## 四、建議一起修：程式寫法

### F24. 用語

- `packages/core/src/geometry-suggestions.ts:43-48` 的 `groups` 裝的是每個結構的形狀，而「群組」是用語表裡結構的 _Avoid_。請改名，例如 `solidsByStructure`。
- `packages/server/src/mock.ts:107,114,135` 的訊息用 "block(s)" 指模組，請改成 module。
- `docs/map-format.md:161` 的 "world-space" 改成 "map-space"。
- 改名：`packages/core/src/compiler.ts:132` 的布林參數 `positive`；`packages/server/src/mcp-paging.ts:31` 的 `bound()`；`packages/core/src/geometry-suggestions.ts:26,80` 的 `Candidate`、`candidate()`；拿掉 `packages/core/src/geometry.ts:23` 的 `type SolidInstance = AdviceSolid` 別名。

### F25. 重複的程式碼

- 「這張地圖有沒有違規」的判斷，`packages/cli/src/index.ts:107-108`、`packages/server/src/export-project.ts:37`、`packages/server/src/mcp.ts:229` 改用 `packages/core/src/export.ts:56` 已經有的那一份。
- 列出全部地圖：`packages/server/src/services.ts:26-32` 和 `packages/server/src/build-project.ts:136-141` 合併。
- 路徑包含檢查：`packages/server/src/paths.ts:4-7`、`scripts/prepare-cli.mjs:10-11`、`scripts/test-packed-cli.mjs:25-28` 共用。
- `packages/core/src/compiler.ts:436-442`、`545-549`、`553-561` 三段一樣的插槽候選列舉，抽成一個函式。
- `packages/core/src/geometry.ts` 裡重複的 bucket 走訪（`259-268`、`360-369`）和重疊判斷（`283-284`、`376-377`）；支撐的廣度搜尋在 `geometry.ts:326-333` 和 `geometry-suggestions.ts:52-64` 各有一份。
- `packages/server/src/mock-services.ts:11-17` 又抄了一次 `NoticeCode`；`packages/server/src/mcp-inputs.ts:30,34` 的高度上下限和 `packages/core/src/terrain.ts:25` 重複。都改成引用同一份。

### F26. 結構整理

- `packages/core/src/geometry.ts:246,292,342` 設定的 `suggestion` 一定會被 `381-387` 蓋掉，刪掉沒用的那幾行。
- 違規的 `rule` 不要拿顯示用的 `label` 當識別（`packages/core/src/compiler.ts:145`），這和 `packages/core/src/violation.ts:11-12` 的說明矛盾。改成固定的規則 id。
- `packages/core/src/compiler.ts:221` 的 `` `module:${definition.id}:material` `` 長得像 ObjectRef，卻指向模組定義。換一個不會和 ObjectRef 混淆的格式。
- `triggerMockNotice` 從共用的 `StateStore` 拿掉，放進只有 mock 用的介面（`packages/server/src/state.ts:31`、`packages/server/src/index.ts:150`）。
- 復原和重做的流程（`packages/server/src/state.ts:193-198`、`packages/server/src/disk-state.ts:376-382`）收進 `ProjectHistory`，`cursor` 不要公開讓外面改。
- `packages/core/src/compiler.ts` 同時負責編譯、違規識別和建議文字。仿照幾何建議的做法，把文字建議抽成獨立的模組。

## 五、這次不用改

- F12 為了打包驗收另外產生 frozen lockfile、固定 pnpm store：比規格多，但不影響使用，保留。
- F11 的分頁結果快取：分頁本來就需要記住剩下的內容，保留。F17 修好之後，快取不受影響。
