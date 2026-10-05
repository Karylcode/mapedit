# 給 Codex：PR #1 審查修正清單

Claude 審查了 [PR #1](https://github.com/Karylcode/mapedit/pull/1)，從兩個方向檢查：有沒有照規格做，以及程式寫法有沒有照規範。整體品質很好，protocol 型別、MCP 工具、違規種類、匯出和 Unity 匯入都符合規格。下面是需要修正的地方。

請在同一個 `backend` 分支上修，修完推上去更新 PR。

## 工作方式

- 照編號順序一路修完，中間不要停下來等人確認，做法和 [codex-backend.md](codex-backend.md) 第 9 節相同。
- 每一項都要有測試。修 bug 的項目，先寫出能重現問題的測試，再修到通過。
- 每修完一項或一組就 commit，commit 訊息標上編號，例如 `fix(F1): ...`。
- 這一輪 Claude 已經先更新了 [protocol.md](../protocol.md)（違規 id 要穩定、違規帶檔名和行號、mock 的觸發網址），`packages/protocol` 請跟著對齊。
- 全部修完之後：
  - 確認所有測試在這台 Windows 電腦上通過。
  - 推上 GitHub，PR 的 CI 要綠燈。
  - 在 `backend-status.md` 新增「審查修正」段落，F1 到 F16 逐項寫：怎麼修、測試在哪、有沒有偏離。也更新最上面的總結。

## 一、必修：行為錯誤

### F1. 合法的拖動會被無關的違規擋下

- **位置**：`packages/server/src/disk-state.ts:307-313`；違規 id 在 `packages/core/src/compiler.ts:101` 產生；行號位移發生在 `packages/core/src/format.ts:590-600`。
- **原因**：判斷「這次拖動有沒有造成新違規」時，拿整筆違規的 JSON 比對。但違規 id 是照產生順序編號的（`out_of_bounds:2`），補上 `rotation` 欄位時 `params.line` 也會跟著變，所以其他沒變的違規會被誤認成新的。
- **重現**：
  1. 結構 a 和 b 都超出地圖。把 a 拖回範圍內，結果因為 b 的違規 id 從 `out_of_bounds:2` 變成 `:1`，拖動被拒絕。
  2. 同一個檔案裡另一個結構已經有 `unsupported` 違規時，沒寫 `rotation` 欄位的結構完全拖不動。
- **修法**：
  - 違規 id 改成穩定的：同一個違規在不同 revision 之間 id 不變，例如由 kind 和排序後的 refs 組成；同一組 kind 和 refs 有多筆時再加上區分。
  - 比對新舊違規時用穩定 id，不要用整筆 JSON。
  - 拒絕的條件：被移動的東西放在新位置會有違規；或者這次移動讓其他東西多出原本沒有的違規（例如原本放在它上面的東西失去支撐）。其他和這次移動無關的違規，一律不影響。
- **驗收**：上面兩個重現情境都有測試，而且都能拖動成功。

### F2. 拖動方形標記後會埋進地面

- **位置**：`packages/core/src/format.ts:519`、`:580-583`。
- **原因**：移動標記時，把方形標記的中心高度直接設成地面高度。例如 `[50,1,50]` 拖動後變成 `[60,0,60]`，有一半埋進地裡。
- **修法**：移動標記時，保留它原本和地面之間的高度差。方形標記以底面計算，也就是新的 `center.y` = 新位置的地面高度 + 原本底面離地的高度 + `size.y / 2`。點標記同理。
- **驗收**：
  - 底面貼地的方形標記，移到地面比較高的地方後，底面仍然貼地。
  - 離地 2 公尺的方形標記，移動後仍然離地 2 公尺。

### F3. `mapedit check` 沒加 `--map` 時只檢查第一張地圖

- **位置**：`packages/core/src/compiler.ts:62`、`packages/cli/src/index.ts:67-70`。
- **原因**：沒指定地圖時預設只編譯第一張，第二張地圖有違規時結束代碼仍然是 0。放進 git hook 或 GitHub Actions 時會漏抓。
- **修法**：
  - `check` 沒加 `--map` 時檢查全部地圖，任何一張有違規或檔案錯誤就回傳非零的結束代碼。
  - `--json` 一律輸出 `{ "maps": [{ "map": "...", "violations": [...], "fileErrors": [...], "floating": [...] }] }`；加了 `--map` 時格式一樣，只是只有一張。`floating` 見 F4。
  - `export` 沒加 `--map` 時匯出全部地圖；任何一張有違規就全部拒絕，並說明是哪幾張。
  - MCP 的 `check` 和 `overview` 沒指定地圖時，也要涵蓋全部地圖。
  - 同步更新 `docs/map-format.md`、README 和 AGENTS.md 範本裡的說明。
- **驗收**：第二張地圖有 `off_grid` 違規時，不加 `--map` 的 `check` 回傳非零結束代碼。

### F4. 「可以浮空」的模組要讓人看得到

- **決定**（[ADR 0011](../adr/0011-can-float-supports-but-is-listed.md)）：維持現在的行為，標了「可以浮空」的模組能撐住接在它上面或放在它上面的東西。
- **要加的**：`check`（CLI 文字模式、`--json`、MCP）和 `overview` 都要列出所有標了「可以浮空」的模組實例，包含 ref、模組類型和位置。這份清單不算違規，也不影響結束代碼。
- **驗收**：有浮空島和上面房子的測試地圖，`check` 和 `overview` 都會列出浮空島，而且沒有違規。

## 二、必修：漏做的規格

### F5. 修正建議要具體，重疊和沒有支撐要帶位置

- **位置**：`packages/core/src/geometry.ts:277`、`:322`。
- **規格**：design.md 第 6 節要求修正建議要像「往東移 0.5 公尺就不會重疊」這樣具體。現在的建議是固定字串，重疊和沒有支撐也沒有帶 `location`。
- **要求**：
  - `overlap` 和 `unsupported` 都要帶 `location`。
  - `overlap`：找出沿東、西、南、北方向，以 0.5 公尺為單位、最短可以解除重疊的移動距離（最多找 5 公尺左右）。例如：`Move structure:house_01 east by 0.5 m to clear the overlap with structure:tree_03.` 如果找不到，就說明是跟哪個東西、在哪裡重疊。
  - `unsupported`：如果正下方 3 公尺內有地面或模組，建議往下移多少公尺；不然就建議附近可以接的空插槽（寫出插槽名稱）；或者提示「如果本來就該浮空，請在模組定義標明可以浮空」。
  - 其他種類也要具體：`off_grid` 給最接近的合法數值；`bad_rotation` 給最接近的合法角度；`out_of_bounds` 說明要往哪個方向移多少；`missing_reference` 列出名稱最接近的候選；`incompatible_socket` 列出可以接的插槽類型。
- **驗收**：每一種違規的建議都有測試。

### F6. CLI 文字輸出要有檔名和行號

- **位置**：`packages/cli/src/index.ts:79-82`。
- **規格**：codex-backend.md 第 3 節：「錯誤訊息要指出檔名和行號」。
- **要求**：來自某個檔案的違規，在 `params` 帶 `file` 和 `line`（protocol.md 已註明）。CLI 文字模式輸出成 `file:line: kind: message suggestion`，MCP 的 `check` 也要附上。
- **驗收**：CLI 文字輸出的測試裡看得到檔名和行號。

### F7. AGENTS.md 本身就要完整

- **位置**：`templates/project/AGENTS.md:14-15`。
- **原因**：現在把地圖格式和常見錯誤都交給 Claude skill，但 Codex 只會讀 AGENTS.md，所以 Codex 拿不到這些說明。
- **要求**：AGENTS.md 本身要包含地圖格式重點、工作流程和常見錯誤；SKILL.md 可以是同樣的內容。兩份從同一個來源產生，避免之後內容不一致。
- **驗收**：測試確認兩份都有這三部分。

### F8. mock 要涵蓋所有情境

- **位置**：`packages/server/src/mock.ts:42-52`、`packages/server/src/mock-services.ts:177`。
- **原因**：前端開發和測試會靠 mock，但現在的測試場景缺少違規、地基延伸、方形標記和檔案錯誤；`overwritten_by_agent`、`agent_change_overridden`、`file_error` 這三種提示也送不出來。
- **要求**：照 protocol.md 第 1 節（已更新）：
  - 測試場景包含每一種違規（重疊和沒有支撐要帶 `location` 和 `suggestion`）、地基延伸、點標記和方形標記、檔案錯誤。
  - 加上 `POST /api/mock/trigger`，可以觸發每一種提示。
- **驗收**：每一種提示都有 WebSocket 測試。

## 三、必修：多做的部分

### F9. 移除 `project.yaml` 的 `materials:`

- **位置**：`packages/core/src/format.ts:248-251`；`packages/core/src/materials.ts:129-133` 只認得內建材質。
- **原因**：`materials:` 可以宣告，但建模時只認得內建材質，所以宣告了反而一定失敗。而且自訂材質需要匯入外部貼圖，這是之後的版本才做的事。
- **要求**：`project.yaml` 出現 `materials:` 時，回報格式錯誤，訊息說明第一版只能使用內建材質；從 `docs/map-format.md` 移除相關說明。
- **驗收**：有 `materials:` 的專案會得到格式錯誤。

## 四、必修：違反規範

### F10. 改掉「錨點」這個命名

- **位置**：`packages/core/src/compiler.ts:53,336,372`。
- **規範**：CONTEXT.md 的 Socket 把「錨點」列為不要用的詞；codex-backend.md 第 0 節：「不要另外發明同義詞」。
- **要求**：`SocketAnchor` 改成 `PlacedSocket`，`targetAnchor`、`localAnchor` 改成 `targetSocket`、`localSocket`。順便掃一遍所有識別字，CONTEXT.md 列在 _Avoid_ 的詞都改掉。HTTP 的 `/assets` 這種跟用語表無關的不用改。

### F11. MCP 回傳大小要有統一上限

- **位置**：`packages/server/src/mcp.ts:67`、`:386-399`。
- **規範**：codex-backend.md 第 4 節：「一般控制在 8,000 token 以內」。
- **要求**：所有工具的文字回傳都經過同一個有上限的函式，上限降到大約 24,000 字元（約 6,000 到 8,000 token），超過就分頁。`build_module` 現在沒經過上限，要一起改。
- **驗收**：每個工具在大量資料下的回傳都不超過上限的測試。

## 五、這次只做一部分

### F12. 讓 CLI 可以打包

- **位置**：`packages/cli/package.json:11`、`packages/cli/src/init.ts:147`。
- **規格**：ADR 0010：「安裝只要一行 `npx`」。
- **這次要做**：`init` 改成從 CLI 套件自己的位置找範本（建置時把 `templates/project` 複製進 cli 套件），不要依賴 repo 內的相對路徑。用 `pnpm pack` 打包出來的套件，放到別的資料夾也能執行 `init`。
- **這次不做**：`private` 先保留。發佈到 npm 需要人決定套件名稱和用哪個 npm 帳號（`mapedit` 這個名稱目前在 npm 上還沒有人用），把這件事記在「需要人處理」，不要停下來等。
- **驗收**：打包後在暫存資料夾執行 `init` 的測試。

## 六、建議一起修：程式寫法

這些不是錯誤，但會讓之後維護比較辛苦，請在這一輪一起整理。

### F13. 子程序程式碼不要寫在字串裡

`packages/server/src/model-worker.ts:2-35` 把整段子程序寫在模板字串裡，不受 TypeScript strict 和 ESLint 檢查。搬到獨立的 `.ts` 檔，跟其他程式碼一起建置和檢查。

### F14. Unity 測試腳本要能在 PowerShell 5.1 執行

`scripts/test-unity.ps1:31` 的 `ConvertFrom-Json -AsHashtable` 需要 PowerShell 6 以上，Windows 內建的 5.1 跑不了。改成 5.1 也能執行的寫法。

### F15. 重複的程式碼合併成一份

- **ObjectRef**：在 `packages/protocol` 提供產生和解析的函式，例如 `structureRef(id)`、`moduleRef(structureId, instanceId)`、`markerRef(id)`、`parseObjectRef(ref)`。所有地方都改用它們，不要再手動拼接字串或用 `slice` 切；MCP 的參數正規化集中在一個地方。
- **terrain 參數**：`packages/server/src/mcp.ts:26` 改成有型別的驗證，拿掉 `packages/server/src/services.ts:135` 的 `as unknown as TerrainCommand`。
- **矩陣**：刪掉 `packages/server/src/mock.ts:3` 的 `matrix()`，統一用 `packages/core/src/math.ts` 的 `transformMatrix()`。正式程式碼不要從 mock 匯入東西。
- **材質 id 清單**：只保留 `packages/core/src/materials.ts` 一份，`packages/core/src/domain.ts:122` 和 `packages/server/src/mcp.ts:61` 改成引用它。
- **插槽相容規則**：只保留 core 的一份，`packages/server/src/services.ts:28-35` 改成呼叫它（`packages/core/src/compiler.ts:187-191`）。
- **專案識別雜湊**：`packages/cli/src/discovery.ts:12-15` 和 `packages/server/src/index.ts:90-92` 共用同一個函式。
- **讀取輸入檔**：`packages/server/src/disk-state.ts:83-133` 和 `packages/server/src/project-files.ts:17-46` 合併成一套。「路徑在不在專案裡」的檢查（`inside === '..' || …`，出現 5 次）抽成一個函式。
- **notice 和 record**：`packages/server/src/state.ts:50,107` 和 `packages/server/src/disk-state.ts:178,200` 共用。

### F16. 其他整理

- **產生違規**：統一用一個函式，參數用一個物件。取代 `packages/core/src/compiler.ts:91` 的 `emit(...)` 和 `packages/core/src/geometry.ts:139` 的 `violation(...)`，這兩個現在參數相同但順序不同。
- **標記座標**：`shape.kind === 'point' ? position : center` 出現在五個地方（compiler、export、disk-state、format、state），抽成一個函式。
- **StateStore**：`getScene` 和 `asset` 改成必要方法，`MemoryState` 也實作它們，拿掉 `instanceof` 判斷和重複的備用邏輯（`packages/server/src/index.ts:109-113,302`、`packages/server/src/mock-services.ts:21-25,61`）。
- **改名**：
  - `packages/core/src/compiler.ts:110` 的 `grid()` 和 `:122` 的 `rotation()`，改成看得出是在檢查的名稱，例如 `checkGridAlignment`、`checkRotation`。
  - `packages/server/src/mcp.ts:87` 的 `cells` 改成 `footprint`；`:113` 的 `grid` 改成 `raster` 之類的名稱，避免跟用語表的 Grid（0.5 公尺格子）衝突。
  - 拿掉 `packages/server/src/disk-state.ts:17` 的 `ProjectBuild` 別名。
- **刪掉沒用的程式碼**：`packages/server/src/disk-state.ts:440` 的 `writeAgentFiles` 沒有人呼叫。
