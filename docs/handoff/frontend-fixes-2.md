# 給「編輯器前端」：PR #2 第二輪修正清單

「遊戲地圖編輯器網頁軟體」這個 session 檢查了第一輪修正（FE1–FE23，到 b5da89d 為止），方式如下：

- 從規格和錯誤兩個方向檢查程式碼。
- 實際操作：同一個 18 種模組的專案，讓 Agent 一次改掉全部模型，畫面最長只停頓 35 毫秒（修正前是好幾秒）；寬 960 和 700 像素時，面板和提示都不會重疊。

FE1–FE3、FE5–FE8、FE10–FE23 都確實修好了，CI 的修正（25fa361）也綠燈。FE4 和 FE9 只修了一部分。編號接著上一輪，從 FE24 開始。

## 工作方式

- 和上一輪相同：照順序一路修完，不要停下來等人確認。
- 修 bug 的項目先寫會失敗的測試。
- 每項一個 commit。這份清單跟第一個修正一起 commit。
- 全部修完之後：
  - 確認 Windows 上的測試全部通過。
  - 推上 GitHub，確認 PR #2 的 CI 綠燈。
  - 在 `frontend-status.md` 新增「第二輪修正」。
  - 通知「遊戲地圖編輯器網頁軟體」。
- FE30 要等後端的 F39（後端清單 `docs/handoff/backend-fixes-4.md`）。先做其他項目，後端改好會通知你，到時候 `git merge backend`。

## 一、必修

### FE24. 放下被拒絕後，排隊中的 Ctrl+Z 還是會送出（FE9 的後續）

- **位置**：`packages/web/src/editor/editing.ts:202-212`、`:369-377`；`packages/web/src/editor/editor.ts:64`。
- **原因**：
  - 放下後立刻按 Ctrl+Z，復原會排隊等回覆。但不管回覆是成功還是失敗，排隊的復原都會送出。情境：把房子放到會穿模的地方，馬上按 Ctrl+Z 想收回。後端拒絕這次放下、房子彈回原位，接著排隊的 `undo` 送出，復原的是**前一次**修改，可能是 Agent 剛做的事。
  - `cancelDrag` 不會清掉排隊的復原，所以換地圖之後它還會留著，等到下一次放下的回覆時才送出，把那次放下復原掉。
- **修法**：
  - 放下失敗時丟掉排隊的復原或重做，並用提示告訴人。
  - 取消拖動（包括換地圖）時也清掉。
  - 排隊的指令要綁定在對應那次放下的 request id 上。
- **驗收**：上面兩個情境都有測試，復原不會作用在別的修改上。

### FE25. 開發代理仍然可以被 DNS rebinding 繞過（FE4 的後續）

- **位置**：`packages/web/dev-proxy.ts:16`。
- **原因**：只要 `Origin` 等於 `http://<Host>` 就改寫。惡意網頁可以用 DNS rebinding，讓 `http://rebind.attacker:5173` 指向 127.0.0.1，這時 Origin 和 Host 會剛好對上，Origin 被改成後端的，`changeOrigin` 又改寫了 Host，兩道檢查都被繞過。Vite 8.3.2 的 `allowedHosts` 不會檢查代理的 WebSocket 升級請求（`vite/dist/node/chunks/node.js:19764`）。
- **修法**：照上一輪的要求，只接受迴路位址：`127.0.0.1`、`localhost`、`[::1]` 加上開發伺服器的連接埠。
- **驗收**：測試 `forwardedOrigin('http://rebind.example:5173', 'rebind.example:5173', …)` 不會改寫 Origin。

### FE26. 估算出來的重疊看起來和確定的一樣

- **位置**：`packages/web/src/editor/violations.ts:99-102`。
- **原因**：後端的 F32 在重疊很多時，會用外框估算之後的重疊，並標上 `params.estimated: true`。實測裡大約一半的估算是假的。前端沒有讀這個欄位，只依 `target` 翻譯，所以「可能重疊」看起來和確定重疊一模一樣。
- **修法**：`estimated` 為 true 時，翻成「可能重疊（估算，修好前面的重疊後重新檢查）」，畫面上的標示也要看得出來不同，例如換一種外框樣式。後端的 F38 會把英文訊息改成「may overlap」，兩邊說法要一致。
- **驗收**：`estimated` 的重疊在清單和地圖上都看得出是估算的。

### FE27. 非拉丁字母的鍵盤用不了快捷鍵（FE7 的後續）

- **位置**：`packages/web/src/editor/keys.ts:24`。
- **原因**：現在只看 `event.key`。俄文、希臘文、希伯來文鍵盤上，Ctrl+Z、Ctrl+Y、R、F 會全部失效，而改之前用 `event.code` 時是可以用的。
- **修法**：`event.key` 是 ASCII 字母時用它；不是的時候，退回用 `event.code`。
- **驗收**：`key: 'я'`、`code: 'KeyZ'`、Ctrl 的事件會復原；QWERTZ 的情境仍然正確。

### FE28. 「你的修改被 Agent 蓋掉」的警告還是可能被擠掉（FE19 的後續）

- **位置**：`packages/web/src/editor/hud/toasts.ts:36-41`。
- **原因**：現在錯誤的優先順序比警告高。後端會先送 `overwritten_by_agent`，再送 `file_error`（`packages/server/src/disk-state.ts:238-244`）。Agent 一次寫壞四個檔案時，四則檔案錯誤會把這則警告擠掉。FE19 原本就是要保護這則警告。
- **修法**：檔案錯誤在違規面板裡本來就看得到，所以提示太多時，先移掉檔案錯誤的提示，「你的修改被蓋掉」最後才移掉。
- **驗收**：先顯示 `overwritten_by_agent`，再來四則 `file_error`，警告還在。

## 二、建議一起修

### FE29. 小問題

- **放下後等待回覆時按 Delete 沒有反應**（`editing.ts:255`）：拖曳時會提示「請稍候」，Delete 也給同樣的提示。
- **沒有地形的一般地圖**（`render-page.ts:194`、`:213`）：`/render` 現在依 `MapInfo.kind` 決定要不要畫地面格線。但一般地圖也可能沒有地形，例如 `map.yaml` 無法讀取時，這時會畫在一片天空上。沒有地形切塊時一律畫格線。
- **測試會改寫正式的建置結果**：`dev-command-browser.test.ts` 在 CI 上發現 `packages/web/dist` 過期時，會直接取代它。改成建置到暫存資料夾。
- **FE1 的測試缺口**：`map-view-loading.test.ts` 只測第一次打開。補一個「模型還在載入時又來了新快照」的情況，也就是 Agent 一次改掉 18 種模型。

## 三、要等後端

### FE30. 修改紀錄依地圖區分

- **原因**：後端的 F39 會讓修改紀錄標出是哪張地圖：人的修改加 `mapId`，Agent 的修改依地圖分組列出 `refs`。現在前端標出物件時，可能標到另一張地圖上同 id 的東西。
- **修法**：後端改好之後，只標出目前地圖上的物件；其他地圖的修改，在修改紀錄裡註明地圖名稱。
- **驗收**：Agent 同時改兩張地圖時，只會標出目前地圖上的物件。
