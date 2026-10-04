# 給「編輯器前端」：PR #2 第一輪修正清單

「遊戲地圖編輯器網頁軟體」這個 session 檢查了 PR #2，方式如下：

- 在 mock 和真的專案上實際操作。
- 像 Agent 一樣透過 MCP 呼叫 `screenshot` 和 `build_module`。
- 從三個方向檢查程式碼：是否符合說明文件、有沒有錯誤、測試是否可靠。

大部分功能都正常：拖動、R、刪除、復原、重做、寫回 YAML 時保留註解、Agent 改檔後即時更新、五種提示、中英文切換和 `/render` 截圖都能用。CI 裡的瀏覽器測試也確實有執行，沒有被略過。下面是這一輪發現的問題。

## 工作方式

- 照編號順序一路修完，中間不要停下來等人確認，做法和 [claude-frontend.md](claude-frontend.md) 第 2 節相同。
- 每一項都要有測試。修 bug 的項目，先寫出能重現問題的測試，再修到通過。
- 每修完一項就 commit，commit 訊息標上編號，例如 `fix(FE1): ...`。這份清單跟第一個修正一起 commit。
- 動到 protocol.md 時，先改文件再改型別，只能新增，改完通知「項目後端修正」。
- FE17 要等後端完成 F28、F34、F35。這三項已經列在後端的清單裡（`docs/handoff/backend-fixes-3.md`，在 backend 分支上），後端改好會通知你；先做其他項目，不要等。其他需要後端配合的事，用 SendMessage 告訴「項目後端修正」。
- 全部修完之後：確認所有測試在這台 Windows 電腦上通過、推上 GitHub、PR #2 的 CI 綠燈，並在 `frontend-status.md` 新增「第一輪修正」段落，逐項寫出怎麼修、測試在哪裡。然後通知「遊戲地圖編輯器網頁軟體」。

## 一、必修：會卡死、耗盡記憶體或改錯東西

### FE1. 模組模型載入時，重畫次數呈指數成長

- **位置**：`packages/web/src/scene/map-view.ts:476`（`load()` 在 `:355-372`）。
- **原因**：`refresh()` 每次執行，都會替每個還在載入的模組類型再註冊一個 `() => this.refresh()`。結果每個類型載完時會觸發的 `refresh()` 次數一路加倍：最後載完的類型會觸發 2^(N−1) 次。
- **實測**：做了一個用到 18 種模組的專案，再模擬 Agent 一次改掉全部 18 個模型（例如換材質）。結果 `refresh()` 被呼叫了 **262,144 次**，正好是 2^18。光是打開這個專案，頁面就要約 9 秒才有反應；同樣的電腦打開村莊只要 2 秒。模組種類到 20 種以上，分頁會卡住好幾分鐘。
- **修法**：每個網址只註冊一次回呼；或改成「標記需要更新」，每個畫面最多執行一次 `refresh()`。
- **驗收**：測試用 20 種模組、glb 一個接一個載完，`refresh()` 的次數不超過模組種類數（或每個畫面最多一次）。

### FE2. 模型每換一次，實例緩衝區就加倍

- **位置**：`packages/web/src/scene/map-view.ts:538-540`。
- **原因**：`batchFor` 只要模型換了（`existing.asset !== asset`），就把 `capacity` 乘以 2，即使數量根本沒變。
- **情境**：Agent 反覆修改牆的模型 15 次，地圖上有 40 面牆。結果緩衝區會大到 130 萬個實例，每個 primitive 約 100 MB，而且每份快照都會整個重新上傳。Agent 反覆調整模型是很常見的工作方式。
- **修法**：換模型時沿用原本的容量；只有數量超過容量時才加倍。
- **驗收**：同一類型換模型 20 次、數量不變，容量不會變大。

### FE3. 換地圖時，舊地圖還能被點選和修改

- **位置**：`packages/web/src/editor/editor.ts:47-61`；`packages/web/src/editor/editing.ts:97`、`:177`、`:190`。
- **原因**：選了另一張地圖之後，新快照到達之前，舊地圖還留在畫面上，而且可以點選。修改的 `baseRevision` 也會用 `revision ?? 0`。修改訊息沒有帶地圖 id，所以後端會把它套用在新打開的地圖上。
- **情境**：從地圖 A 換到 B，在 B 的快照到達前點了 A 的 `marker:spawn`，按 Delete。後端刪掉的是 **B** 的 `marker:spawn`。
- **修法**：
  - 送出 `openMap` 時：取消拖動、清掉選取和滑過提示，並停用點選和修改，直到新地圖的第一份快照到達。
  - 沒有 revision 時不要送修改，不要用 0 代替。
- **驗收**：用有兩張地圖的真專案測試。換地圖後、新快照到達前，Delete、拖動、R 都不會送出任何修改。

### FE4. Vite 開發伺服器的代理把所有 Origin 都改成後端的

- **位置**：`packages/web/vite.config.ts:13-18`。
- **原因**：代理不管 `Origin` 是什麼，都改成後端的來源。所以任何網站都能透過 `ws://127.0.0.1:5173/ws` 連進來，送 `applyEdit` 刪東西，等於繞過後端的 Origin 檢查（protocol.md 第 1 節）。這個問題只發生在 `pnpm dev:web` 的時候。
- **修法**：只有 `Origin` 是開發伺服器自己（`http://127.0.0.1:5173`、`http://localhost:5173`）時才改寫；其他來源原樣轉送，讓後端拒絕。
- **驗收**：測試代理設定：外部的 Origin 不會被改寫，自己的 Origin 會。

## 二、必修：行為錯誤

### FE5. 連按 R 只轉一次；連按 Delete 會跳出錯誤

- **位置**：`packages/web/src/editor/editing.ts:159-195`。
- **原因**：沒有拖動時按 R，新角度是從上一份快照算的，沒考慮還在等回覆的修改。
  - 在新快照到達前連按三次 R，三個 `applyEdit` 一模一樣，結果只轉 15 度，修改紀錄還多了兩筆什麼都沒改的項目。大地圖上一份快照要好幾秒。
  - 連按兩次 Delete，第二次會跳出 `Unknown object` 的錯誤提示。
  - 等回覆期間在物件上拖曳，會變成平移鏡頭（`editing.ts:83`、`input.ts:161-166`），沒有任何提示。
- **修法**：
  - 同一個物件有修改還在等回覆時，R 從「最後送出的角度」繼續算。
  - 已經送出刪除的物件，不再重複送。
  - 等回覆期間的拖曳，至少要有提示，不要變成平移。
- **驗收**：快速按三次 R，最後轉了 45 度；快速按兩次 Delete，只刪一次、沒有錯誤提示。

### FE6. 按住 Ctrl+Z／Ctrl+Y 會一直重複

- **位置**：`packages/web/src/editor/editor.ts:140-148`。
- **原因**：R 和 Delete 有檢查 `event.repeat`，Ctrl+Z／Ctrl+Y 沒有。按住 Ctrl+Z 一秒，大約會送出 30 次復原，而且復原作用在整個專案上，包括 Agent 的修改。`frontend-status.md` 寫「按住鍵不放不會重複套用」，和實際不符。
- **修法**：忽略 `event.repeat`。
- **驗收**：送出重複的按鍵事件，只復原一次。

### FE7. Ctrl+Z／Ctrl+Y 認的是按鍵的位置，不是按鍵上的字

- **位置**：`packages/web/src/editor/editor.ts:140`、`:145`、`:151`。
- **原因**：用 `event.code` 判斷。德文鍵盤（QWERTZ）上，標著 Z 的鍵是 `KeyY`，所以 Ctrl+Z 會重做、Ctrl+Y 會復原；法文鍵盤（AZERTY）上，Ctrl+Z 永遠不會復原。
- **修法**：Z、Y、R 這種「字母指令」改用 `event.key`（不分大小寫）。WASD 是「方向」，保留 `event.code` 是對的。
- **驗收**：`key: 'z'`、`code: 'KeyY'` 的事件會復原。

### FE8. 拖動被瀏覽器中斷後，畫面卡在拖動狀態

- **位置**：`packages/web/src/editor/input.ts:75`、`:176-188`。
- **原因**：`pointercancel` 只清掉手勢，沒有通知 `EditController`；也沒有處理 `lostpointercapture`。拖動途中切換視窗、觸控板或觸控筆取消時，預覽會留在畫面上，之後的拖曳變成平移，Delete 和 Ctrl+Z 都沒反應，直到按 Esc。
- **修法**：`pointercancel`、`lostpointercapture`、視窗失去焦點時，還沒放下的拖動直接取消。
- **驗收**：拖動中送出 `pointercancel`，預覽消失，接著 Delete 正常。

### FE9. 放下後沒等到新快照，預覽永遠不會消失

- **位置**：`packages/web/src/editor/editing.ts:242`、`:269-272`、`:304-310`。
- **原因**：成功放下之後，預覽只會在下一份 `scene` 到達時消失，沒有任何時間限制。
  - 如果新快照沒有來（例如後端送完 `editResult` 之後出錯），預覽會永遠留著，也會擋住之後的拖動、Delete 和復原。
  - 正常情況下，放下後馬上按 Ctrl+Z 會被默默忽略。
  - 放下後斷線時，提示說修改沒有送出，但其實可能已經套用了。
- **修法**：
  - 收到 `editResult { ok: true }` 之後，最多再等一小段時間（例如 2 秒）就移除預覽。
  - 放下後按的 Ctrl+Z 要在回覆之後送出，不要丟掉。
  - 斷線的提示改成「連線中斷，不確定修改有沒有套用，重新連線後以畫面為準」。
- **驗收**：`editResult` 成功但沒有新快照時，預覽會在時間到之後消失；放下後立刻按 Ctrl+Z 會送出。

### FE10. 連線時送了兩次 `openMap`

- **位置**：`packages/web/src/net/connection.ts:169-170`，搭配 `packages/web/src/editor/editor.ts:219-224`。
- **原因**：`welcome` 的監聽器已經送了 `openMap`，接著 `receive()` 又送一次。所以每次開頁面和每次重連，後端都會送兩份完整的快照和修改紀錄。
- **修法**：只送一次。
- **驗收**：第一次連線和重連，都剛好只送一個 `openMap`。

### FE11. Agent 改了地圖大小，鏡頭範圍不會更新

- **位置**：`packages/web/src/editor/editor.ts:192-195`。
- **原因**：只有地圖 id 改變時才呼叫 `setMap`。Agent 把 `size` 從 100 改成 400 之後，鏡頭還是限制在原本的 −10 到 110 公尺，F 也框住舊的範圍。新增的區域要重新整理頁面才看得到。
- **修法**：地圖大小改變時也要更新。
- **驗收**：測試在快照裡改變 `map.size`，鏡頭範圍跟著更新。

### FE12. 接在別的結構上的結構，違規看不到

- **位置**：`packages/web/src/scene/snapshot-index.ts:57-61`、`:83-96`；`packages/web/src/scene/map-view.ts:266-305`。
- **原因**：快照只列出最上層的結構，接在別的結構上的結構不會單獨出現（`packages/core/src/compiler.ts:646-653`）。例如 `structure_attachment` 的 `bad_rotation`，`refs` 是 `[structure:B]`，而且沒有 `location`。結果：
  - 清單上有這筆違規，但地圖上沒有東西變紅，也沒有旗子，點了也沒反應。
  - Agent 修改時的藍框和 `/render` 的 `highlight` 也有同樣的問題。
- **修法**：`structure:B` 對應到 ref 是 `module:B/*` 的所有實例（用 `parseObjectRef`）。
- **驗收**：用接在別的結構上的結構造出違規，會被標紅，點清單會飛過去。

### FE13. 不認得的違規種類或提示代碼，會讓整個畫面停止更新

- **位置**：`packages/web/src/i18n/i18n.ts:52-55`；`packages/web/src/editor/violations.ts:43`；`packages/web/src/editor/notices.ts:16`；`packages/web/src/editor/store.ts:15`；`packages/web/src/net/connection.ts:118`。
- **原因**：
  - `translate` 遇到沒有的 key 會丟出錯誤。違規種類、提示代碼和修改紀錄的作者都來自伺服器資料。
  - `noticeToast` 遇到不認得的代碼會回傳 `undefined`。
  - `Store.set` 和 `Connection.emit` 都沒有隔離監聽器的錯誤。
  - 結果後端只要新增一種違規或提示，`showScene` 就會在中途停下來。
- **修法**：
  - 不認得的違規種類，顯示種類名稱加上後端的英文訊息。
  - 不認得的提示代碼，顯示後端的英文訊息。
  - 每個監聽器的錯誤各自處理，記到 console，不影響其他監聽器。
  - `VIOLATION_KINDS` 改用 `@mapedit/protocol` 匯出的清單；沒有的話，請後端匯出。
- **驗收**：快照裡有不認得的違規種類時，其他東西照常畫出來；不認得的提示代碼會顯示英文訊息。

### FE14. 選完地圖後，下拉選單還保有焦點

- **位置**：`packages/web/src/editor/hud/title-block.ts:28`，搭配 `packages/web/src/editor/input.ts:52`。
- **原因**：選完地圖後焦點留在 `<select>` 上。這時按方向鍵會直接換地圖；按 WASD 會跳到開頭是那個字母的地圖，地圖也不會平移。
- **修法**：選完之後讓下拉選單失去焦點，鍵盤回到地圖操作。
- **驗收**：選完地圖後按 W 或方向鍵，鏡頭會移動，地圖不會換。

### FE15. 版本不相容時會無限重連

- **位置**：`packages/web/src/net/connection.ts:148-153`。
- **原因**：版本不同的 `hello`，後端會以 1008 關閉連線（`packages/server/src/index.ts:69`）。前端不看關閉代碼，每 4 秒重連一次，畫面一直顯示「連線中」；程式裡的 `incompatible` 狀態永遠不會出現。
- **修法**：還沒收到 `welcome` 就被以 1008 關閉時，停止重連並顯示「版本不相容」。
- **驗收**：用一個收到 `hello` 就以 1008 關閉的假伺服器測試。

### FE16. 視窗窄的時候，面板互相重疊

- **實測**：
  - 視窗寬度小於約 770 像素時，左右兩欄（各 360 像素寬）會疊在一起，修改紀錄蓋住違規清單。
  - 寬度小於約 1,190 像素時，畫面上方的提示（440 像素寬、置中）會蓋住兩側的面板。
- **為什麼重要**：人很常把編輯器開在 Claude Code 的終端機旁邊。1920 像素寬的螢幕切一半是 960 像素；1366 像素的筆電切一半是 683 像素。
- **修法**：照窄視窗重新排版，例如較窄時修改紀錄預設收起、提示移到不會蓋住面板的位置。
- **驗收**：瀏覽器測試在 960 × 720 和 700 × 600 下，同時有違規清單、修改紀錄和提示時，介面元素彼此不重疊。

### FE17. 依賴後端訊息的英文文字（需要後端先加欄位）

- **位置**：
  - `packages/web/src/editor/history-text.ts:13` 解析 `HistoryEntry.summary`（例如 `Move <ref>`）。
  - `packages/web/src/editor/editing.ts:290` 比對 `Nothing to undo`。
  - `packages/web/src/render/render-page.ts:228` 靠地圖 id 的 `__module_` 開頭判斷是不是模組預覽。
- **原因**：protocol.md 說 `summary` 是給人看的英文。後端只要改一下措辭，介面就會默默顯示錯誤。
- **修法**：
  - 後端會在 protocol.md 新增結構化的欄位（後端清單 `docs/handoff/backend-fixes-3.md` 的 F34）。新增之後，前端改用這些欄位，不再解析英文。
  - 後端的 F28 會新增「因為有檔案錯誤而不能移動」的原因，前端要翻譯成「有檔案無法讀取，修好之前不能移動」。
  - 後端的 F35 會改成先送 `scene` 再送 `agent_changed`，並在 notice 加上 `mapId`。改好之後，確認 Agent 修改的提示用的是新名稱，而且不會框到別張地圖上同 id 的物件。
  - 這三件事等後端通知再做，先做其他項目。
- **驗收**：前端不再比對或解析後端的英文文字。

### FE18. protocol.md 對 `Edit.position` 的描述和實作不一致

- **位置**：protocol.md 第 4 節：「position 是滑鼠在地圖上指到的點（還沒對齊）」。
- **原因**：前端實際送的是物件原點想放的位置，後端的 `snapMove` 也是這樣解讀。兩邊一致，但文件寫的不一樣。
- **修法**：把 protocol.md 改成實際的意思：物件原點想放的位置（還沒對齊）。改完通知後端。

### FE19. 提示太多時，重要的警告可能被擠掉

- **位置**：`packages/web/src/editor/hud/toasts.ts:75-76`。
- **原因**：提示最多 4 則，超過時移掉最舊的，不管等級。在 mock 一次觸發五種提示時，「你的修改被 Agent 蓋掉了」這則警告就被擠掉了。這則訊息代表人的修改不見了，是最需要看到的。
- **修法**：先移掉一般資訊，警告和錯誤留著。
- **驗收**：先顯示一則警告，再來四則一般資訊，警告還在。

### FE20. 小問題

- `packages/web/src/scene/map-view.ts:473`：載入失敗的模組類型永遠不會重試（地形和地基延伸會重試）。後端在載入途中重新啟動，那些模組就一直是紅色方塊，直到重新整理頁面。
- `packages/web/src/editor/viewport.ts:35`：像素比例只在開頭設定一次。視窗移到不同縮放比例的螢幕，或瀏覽器縮放之後，畫面會變模糊。

## 三、必修：測試

### FE21. 驗收的缺口和不可靠的斷言

- **W3 驗收要求 mock 和真的專案都測**：`packages/web/test/real-edit-browser.test.ts` 沒有「放下被拒絕」和「重做」。
- **可能永遠通過的斷言**：
  - `edit-browser.test.ts:201-215`（Esc 取消拖動）沒確認預覽真的出現過。
  - `render-browser.test.ts:123-124` 對 `showViolations` 和 `highlight` 只檢查「和沒開時不一樣」。
  - `render-browser.test.ts:25-30` 擋掉外部請求，卻沒檢查有沒有嘗試發出。
  - `render-browser.test.ts:185-209` 對 MCP 截圖只檢查 PNG 開頭和大小，全空白的圖也會通過。
  - 頁面錯誤只在 `editor-browser.test.ts:158` 檢查，而且沒收集 `console.error`（three.js 的 shader 錯誤會出現在那裡）。
  - `notices.test.ts:72-78` 走訪的是程式自己寫死的 `VIOLATION_KINDS`。
  - `issues-browser.test.ts:75` 讀了 `focused` 卻沒檢查。
  - `issues-browser.test.ts:119` 用五個詞的黑名單確認已切成英文，可以改成檢查 `.hud` 裡完全沒有中文字。
- **沒有測試的項目**：換地圖、`baseRevision` 取自拖動開始時、方向鍵、Backspace、Shift+R。
- **修法**：補上上面的測試；斷言要能在功能壞掉時失敗。
- **文件**：`frontend-status.md` 說有 6 個瀏覽器測試檔，實際是 5 個。

### FE22. 瀏覽器測試的基礎設施

- 找不到瀏覽器時測試會默默略過。在 CI（`CI` 環境變數）找不到瀏覽器時，要讓測試失敗。
- `test/browser/harness.ts` 的找瀏覽器和啟動參數是從 `packages/server/src/screenshot.ts` 抄來的，而且已經不一致（少了使用者自己安裝的 Chrome、macOS 的 Edge、`--disable-dev-shm-usage`）。改成共用同一份。
- 固定等待時間後只讀一次結果，容易不穩定，改成輪詢到條件成立（有時間上限）：
  - `edit-browser.test.ts:84`：拖動後 200 ms 預覽就必須是 `ok`。
  - `editor-browser.test.ts:150-154`：WASD 按住 250 ms 後只讀一次。
- `connection.test.ts:196` 重用剛關掉的連接埠，可能和其他 worker 衝突。
- 每次測試都完整建置 Vite 六次，可以改成在 `globalSetup` 建置一次。
- 沒有自動測試的部分：`pnpm build` 之後 `mapedit dev` 在 `/` 提供編輯器、`/render` 能用；以及 W0 的 Vite 代理（FE4 一起補）。

## 四、建議一起修：程式寫法

### FE23. 重複、命名和結構

- **重複的程式碼**：
  - `issues-panel.ts:10-25` 和 `history-panel.ts:10-25` 的 `remembered`／`remember` 一模一樣。
  - 每個介面檔各自宣告自己的 `t`。
  - `map-view.ts:256` 重寫了 `@mapedit/protocol` 已經有的 `markerPosition()`。
- **魔術字串**：提示的 key `` `edit:${ref}` `` 同時寫在 `notices.ts:43` 和 `editing.ts:285`，改成一個共用的函式。
- **用語**：
  - `render-page.ts:59` 的 `floor`／`placeFloor`：「地板」在用語表裡是模組，是地形要避免的說法。改成例如 `groundPlane`。
  - `overview-controls.ts:83` 的 `anchor`：「錨點」是插槽要避免的說法。改成例如 `pivot`。
- **沒用到的程式碼**：`Viewport.onResize`、`OverviewCamera.focus`／`mapSize`、`OverviewControls.moving`、`MapView.dispose` 只有測試在用。不需要的就刪掉。
- **太大的類別**：`MapView` 有 600 行，同時負責地形、instancing、標記、外框、陰影、點選和資源生命週期。在清單上點一筆違規，也會整個 `refresh()` 一次。建議拆開，例如模組批次、標記、違規標示各自一個類別，並且只更新有變的部分。

## 五、這次不用改

- 視覺方向（測量員的現場標籤、粉線藍、旗紅）：由人看過截圖之後決定。
- 沒有要求、但不影響使用的功能先保留：
  - 在空地上左鍵拖曳會平移
  - Shift+R 反方向轉
  - Agent 修改時短暫用藍框標出物件
  - 修改紀錄面板上的復原、重做按鈕
  - `/render` 的地圖資訊格和兩列排版
- 主要 JavaScript 檔約 690 KB：本機工具可以接受。
