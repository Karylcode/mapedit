# 給「項目後端修正」：PR #1 第三輪修正清單

「遊戲地圖編輯器網頁軟體」這個 session 檢查了第二輪修正（F17–F26、F23b），方式如下：

- 重跑上一輪的重現腳本。
- 透過 MCP 呼叫真的伺服器，並用 WebSocket 實際送出訊息。
- 從兩個方向檢查程式碼：是否符合修正清單、有沒有新的錯誤。

F17、F19、F21、F22、F23b、F24、F25、F26 都確實修好了；F18 和 F23 只修了一部分。F20 的方塊快速路徑沒有找到問題。另外，檢查前端（PR #2）時發現幾件需要後端配合的事，也一起列在這裡。編號接著上一輪，從 F27 開始。

## 工作方式

- 在同一個 `backend` 分支上修，修完推上去更新 PR #1。
- 照編號順序一路修完，中間不要停下來等人確認，做法和 [codex-backend.md](codex-backend.md) 第 9 節相同。
- 每一項都要有測試。修 bug 的項目，先寫出能重現問題的測試，再修到通過。
- 每修完一項就 commit，commit 訊息標上編號，例如 `fix(F27): ...`。這份清單跟第一個修正一起 commit。
- 動到 protocol.md 時，先改文件再改型別，只能新增，改完通知「編輯器前端」。前端正在 frontend 分支上修它自己的清單（`docs/handoff/frontend-fixes.md`），其中 FE17 要等這裡的 F28 和 F34。
- 全部修完之後：
  - 確認所有測試在這台 Windows 電腦上通過。
  - 推上 GitHub，確認 PR #1 的 CI 綠燈。
  - 在 `backend-status.md` 新增「第三輪修正」段落，逐項寫出怎麼修、測試在哪裡。
  - 通知「遊戲地圖編輯器網頁軟體」。

## 一、必修：行為錯誤

### F27. 同一個結構裡有相容的空插槽，還是會建議標成可以浮空（F18 的後續）

- **位置**：`packages/core/src/geometry-suggestions.ts:45`、`:200`、`:225`、`:310`。
- **原因**：上一輪的要求是「附近有相容的空插槽時，絕對不要建議標成可以浮空」。規格裡的屋頂情境已經修好，但還有兩種情況會走到 canFloat：
  - **(a) 會跳過本身沒有支撐的插槽**（`:200`）。例如整棟房子設了 `height: 2`，屋頂又浮在 `wall_n.top` 上方 1 公尺。牆收到的建議是「整棟往下移 2 公尺」，屋頂收到的卻是「標成可以浮空」。
  - **(b) 5 公尺的範圍限制在同一個結構裡也適用**（`:45`、`:225`）。實測：同一個結構裡，屋頂在相容的空插槽 `base.top` 上方 6 公尺，建議是 `No clear downward move … set canFloat: true`。
- **修法**：
  - 同一個結構裡只要有相容的空插槽，不管距離多遠、那個插槽本身有沒有支撐，都建議接上去。插槽沒有支撐時，再補一句要先處理它的支撐。
  - 這種情況下絕對不要建議 canFloat。
  - 不同結構之間的 5 公尺範圍可以保留。
- **驗收**：(a) 和 (b) 兩個情境都有測試，建議內容是接到正確的插槽。

### F28. 預覽失敗一律標成 `immovable_object`（F23 的後續）

- **位置**：`packages/server/src/disk-state.ts:277-278`、`:289-294`。
- **原因**：只要是已存在的物件預覽失敗，catch 就回 `missing_reference { reason: 'immovable_object' }`。
  - 實測：專案裡另一個檔案有 YAML 語法錯誤時，預覽移動一個正常的結構 `structure:a`，回傳的就是 `immovable_object`，訊息卻是那個 YAML 錯誤。
  - 有問題的 `module.yaml`、會出錯的 `model.ts`、另一張地圖的語法錯誤，都會造成一樣的結果。
  - 前端照 params 表翻譯，畫面會顯示「只能移動整個結構」，人完全看不出真正的原因。
  - 這個錯誤的標示是這一輪才出現的，之前 params 是 `{}`。
- **修法**：
  - `immovable_object` 只用在 `applySourceEdit` 丟出的那兩種「不能單獨移動」的錯誤：結構裡的模組，以及已經用插槽接上的結構。
  - 因為專案有檔案錯誤而不能預覽或套用時，要回一個不同、而且有寫進文件的原因，讓前端翻譯成「有檔案無法讀取，修好之前不能移動」。形式由你決定，例如在 params 表新增一個理由，或替 `previewResult` 加上欄位。
  - 先改 protocol.md 第 3、4 節，改完通知前端。
- **驗收**：另一個檔案有語法錯誤時，預覽和套用回的原因都是新定義的那一種，不是 `immovable_object`。

### F29. `constructor`、`__proto__` 這類名稱會被當成存在的物件

- **位置**：`packages/server/src/disk-state.ts:259`、`:292`；`packages/server/src/index.ts:50-62`。
- **原因**：`compilation.sourceRefs` 是一般的物件，直接用前端送來的字串查。F21 把 `validEdit` 裡的 `parseObjectRef` 檢查拿掉之後，`Object.prototype` 上的名稱也能查到東西。實測：
  - `previewEdit { kind: 'delete', ref: 'constructor' }` 回 `ok: true`，`__proto__` 也一樣。
  - `previewEdit { kind: 'move', ref: 'toString' }` 回 `immovable_object`，應該是 `unknown_object`。
  - 套用時會被擋下，檔案不會被改到，但這違反 protocol.md 第 4 節第 7 點。
- **修法**：改用 `Map` 或 `Object.hasOwn`。core 裡的插槽類型已經用 `Object.create(null)`，可以統一。順便檢查其他用前端或 Agent 送來的字串查物件的地方。
- **驗收**：`constructor`、`__proto__`、`toString`、`hasOwnProperty` 的預覽和套用，都回 `unknown_object`。

### F30. 每個請求都要有回覆

- **位置**：`packages/server/src/disk-state.ts:226-236`、`:255`、`:346`；`packages/server/src/index.ts:309-316`。
- **原因**：
  - 在 `preview` 的 try 區塊外面出錯時（例如 `getBuild`，或 Windows 上 Agent 正在寫檔時 `refresh()` 遇到 EBUSY），後端只送一個 `file_error` notice，那個 `requestId` 永遠收不到 `previewResult` 或 `editResult`。前端在收到回覆前只保留最新的一個預覽，所以拖動預覽會整個卡住。
  - `openMap` 帶不存在的地圖 id 時，會建出一張不存在的地圖並永遠留在 `builds` 裡，之後每次有變動都會重建。
- **修法**：
  - 帶 `requestId` 的訊息，不管發生什麼錯誤，都一定回 `previewResult { ok: false }` 或 `editResult { ok: false, reason }`。
  - 不存在的地圖 id 不要建置也不要快取，回清楚的錯誤。用什麼形式回覆，先寫進 protocol.md 第 4 節。
- **驗收**：模擬 `getBuild` 丟出錯誤，前端仍然收到對應 `requestId` 的回覆；`openMap` 不存在的 id 不會留下快取。

### F31. 截圖可能永遠卡住

- **位置**：`packages/server/src/screenshot.ts:101-105`。
- **原因**：
  - `page.evaluate` 沒有時間限制。如果截圖頁的 `mapeditRender` 一直沒有結束，Agent 的 MCP 呼叫會永遠等下去，頁面也不會關掉。
  - 截圖頁的錯誤訊息直接轉給 Agent，沒有長度上限。
- **修法**：
  - `page.evaluate` 加上時間限制（例如 60 秒），時間到就關掉頁面、回清楚的錯誤。
  - 錯誤訊息限制長度。
- **驗收**：用永遠不結束的假截圖頁測試，MCP 呼叫會在時間到時回錯誤，頁面有關掉。

### F32. 非方塊的模型大量重疊時，還是會超過 2 秒（F20 的後續）

- **原因**：F20 的效能測試只用方塊模型，方塊會走精確的方塊算術，完全不經過布林運算。換成非方塊的模型，2,000 個模組密集重疊時：

  | 模型 | 時間 |
  |---|---|
  | 方塊 | 0.25 秒 |
  | 有穿孔的方塊 | 1.9 秒 |
  | 圓柱 | 3.0 秒 |
  | 有門洞、轉 30 度的牆 | 4.3 秒 |

- **修法**：替每次檢查的精確布林運算設上限，例如前 N 對重疊做精確計算，之後的改用外框估算，並在訊息裡註明「修完前面的再重新檢查」。這樣不管模型是什麼形狀，2,000 個模組都能在 2 秒內完成。
- **驗收**：新增效能測試，用非方塊的模型（有門洞、轉 30 度的牆，以及圓柱）讓 2,000 個模組密集重疊，2 秒內完成。

## 二、必修：前端需要的後端修改

### F33. 打包後的 CLI 沒有前端

- **位置**：`packages/server/src/index.ts:130`；`scripts/test-packed-cli.mjs:25`；`packages/server/src/screenshot.ts:95-99`。
- **原因**：伺服器只會到自己旁邊的 `../../web/dist` 找前端，但打包時只包了 protocol、core、server、cli 四個套件。所以用 npm 安裝之後：
  - `mapedit dev` 只會顯示後端的狀態頁，沒有編輯器。
  - Agent 呼叫 MCP 的 `screenshot` 或 `build_module`，會等 30 秒拿不到 `mapeditRenderReady`，然後失敗。
- **修法**：
  - 讓打包後的 CLI 帶著前端的建置結果，例如 `prepare-cli` 把 `packages/web/dist` 複製進 CLI 套件，CLI 啟動伺服器時指定 `webRoot`。
  - 找不到前端時，`screenshot` 和 `build_module` 立刻回傳清楚的錯誤（例如 `The editor web build is missing; run pnpm build.`），不要等 30 秒。
  - 打包驗收（`test-packed-cli.mjs`）要確認 `/` 提供的是編輯器，而且 `screenshot` 拿得到 PNG。
- **注意**：`packages/web` 目前只在 frontend 分支（PR #2）上。可以先做「找不到就立刻回錯誤」和複製的機制，用假的 dist 測試；完整的打包驗收等 PR #2 合併進 backend 之後再補，並在 `backend-status.md` 註明。
- **驗收**：上面三點都有測試。

### F34. 讓前端不必解析英文：加上結構化的欄位

- **原因**：前端現在只能解析後端給人看的英文（前端清單的 FE17）：
  - `HistoryEntry.summary`，例如 `Move <ref>`。
  - `editResult.reason` 的 `Nothing to undo`。
  - 靠地圖 id 開頭的 `__module_` 判斷 `/render` 是不是模組預覽。

  後端只要改一下措辭，介面就會默默出錯。
- **修法**：在 protocol.md 新增欄位，只能新增，舊欄位保留：
  - `HistoryEntry`：修改的種類（例如移動、刪除、Agent 改檔）和相關的物件 ref。
  - `editResult`：失敗原因的代碼，例如沒有可以復原、沒有可以重做、被拒絕、物件不存在、有檔案錯誤（F28）。
  - `/render` 的模組預覽：明確的標示，例如 `MapInfo` 加上種類欄位。
- **驗收**：正式和 mock 都送出這些欄位，並有測試。改完通知前端。

### F35. 提示比新快照先送到，也沒有標明是哪張地圖

- **位置**：`packages/server/src/disk-state.ts:200`、`:209`。
- **原因**：
  - Agent 改檔時，`agent_changed` 比新的 `scene` 先送出。前端只能用舊快照找名稱，所以 Agent 新增的結構會被列成一串模組名稱，例如「wall_n、wall_s… 等 14 個」。
  - notice 沒有地圖 id。人看著地圖 A、Agent 改了地圖 B 時，前端可能把 A 上同 id 的物件框起來。
- **修法**：
  - 先送新的 `scene`，再送 `agent_changed`、`overwritten_by_agent`。
  - notice 加上選填的 `mapId`。
  - 兩點都寫進 protocol.md 第 4 節。
- **驗收**：WebSocket 測試確認順序和 `mapId`。

## 三、建議一起修

### F36. 建議內容的品質

- **優先順序**（`geometry-suggestions.ts:232-252`、`:302-305`）：接到別的結構的插槽，可能排在「只把這個模組往下移」前面，但前者會移動並合併整個結構。例如檯燈浮在桌子上方 0.5 公尺，可能會被建議把整棟房子接到鄰居家。同一個結構裡的選項應該優先。另外，每個候選插槽都會做一次沒有快取的整個結構移動測試，F20 的效能測試沒有量到這部分。
- **同一個插槽建議給好幾筆違規**（`:197-202`、`:302-304`）：兩半屋頂浮在同一面牆上方，牆只有一個空的 `top`，兩筆違規都被建議接到 `wall_n.top`，照做之後第二個會變成 `incompatible_socket { reason: 'occupied' }`。至少在建議裡註明這個插槽也被建議給哪個物件。
- **容許誤差不一致**（`geometry-suggestions.ts:105-110` 用 1e-4，`compiler.ts` 用 1e-7）：建議的移動在建議裡算是安全的，實際檢查時卻仍然超出地圖。另外 `compiler.ts:678-681`、`:773-776` 重複了 `exceededMapEdges` 裡的比較。改成同一份判斷。

### F37. 程式寫法和小問題

- **F22 的小競態**：`packages/server/src/mcp.ts:203-204` 在工具執行完才讀 revision，不是在處理完檔案變動之後馬上讀。如果工具執行途中又處理了新的檔案變動（例如沒指定地圖的 `check` 第一次建置其他地圖時，Agent 同時改了檔案），舊的結果會被標上新的 revision，下一頁也不會失效。改成處理完檔案變動後立刻記下 revision。
- **F17 的錯誤訊息**：缺少必填參數時，回傳的是 zod 的原始 JSON（`"path":["z"] … expected number, received undefined`）。改成一句話，例如 `Missing required argument z (number).`。
- **列舉寫了兩次**：`packages/protocol/src/violation-params.ts:3-27` 和 `:99-159` 的每一個列舉都同時寫成型別和執行期的清單。新增一個值時型別會過，檢查卻會擋下。改成從 `as const` 陣列推導型別，就像這一輪的 `NOTICE_CODES`。
- **插槽位址自己拼字串**：`geometry-suggestions.ts:255-256` 自己拼 `structure/instance.socket`，但 F25 已經把這個格式集中到 `compiler.ts:249` 的 `socketAddresses`。改用同一份。
- **名稱**：`mcp.ts:204`、`:206` 的 `firstPage()` 對每個結果都會執行，包括續頁和錯誤，名稱容易誤解。
- **型別**：`packages/server/src/state.ts:28` 的 `StateStore.cursor` 型別還是可寫的，改成 `readonly`。
- **打包驗收用到舊的建置**：`scripts/test-packed-cli.mjs:12` 從 `packages/server/dist` 匯入，建置過期時不會有任何警告。

## 需要人處理

- **F17 用真的 Claude Code 驗證**：真的 Codex 驗證過了，但 Codex 本來就能接受舊的 `anyOf` 格式，所以只有 Claude Code 能證明修好了。這台的 `claude` 登入已過期，留給人做。

## 這次不用改

- **截圖用的 `--enable-unsafe-swiftshader`**：這個參數對不受信任的網頁有風險。但截圖頁只載入同一個來源的頁面和後端自己產生的 glb，而且沒有 GPU 的機器少了它就不能用 WebGL。保留，在 `backend-status.md` 記下理由即可。
