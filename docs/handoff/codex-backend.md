# 給 Codex：後端實作說明

你負責這個專案的**全部後端**。前端（`packages/web`）由 Claude 負責，請不要修改它。

**請從 M0 一路做到 M7，中間不要停下來等人確認。** 工作方式見第 9 節。全部做完之後，Claude 會先檢查你的成果，再開始寫前端。

## 0. 開工前先讀

1. [docs/design.md](../design.md)：整體設計，必讀。
2. [CONTEXT.md](../../CONTEXT.md)：用語表。程式裡的命名一律用這裡的英文詞（`Module`、`Socket`、`SocketType`、`Structure`、`Grid`、`Snap`、`Foundation`、`Support`、`Terrain`、`Tile`、`Surface`、`WaterLevel`、`Marker`、`Violation`、`Project`、`Map`、`Material`），不要另外發明同義詞。
3. [docs/adr/](../adr/)：每個重要決定的理由。不要推翻其中任何一項；如果某一項真的做不到，選最接近的可行做法繼續做，並在 `backend-status.md` 的「偏離設計」段落寫清楚原因。
4. [docs/protocol.md](../protocol.md)：你和前端之間的契約。

## 1. 你負責的範圍

| 位置 | 內容 |
|---|---|
| repo 根目錄 | pnpm workspace、TypeScript 設定、lint、CI |
| `packages/protocol` | 前後端訊息型別，必須和 protocol.md 一致 |
| `packages/core` | 領域模型、地圖檔讀寫、編譯、規則檢查、地形運算、建模 API、glTF 產生 |
| `packages/server` | 本機伺服器：檔案監看、WebSocket、MCP、截圖、修改紀錄、靜態檔 |
| `packages/cli` | `mapedit` 指令 |
| `integrations/unity` | Unity 匯入套件（C#） |
| `templates/project` | `mapedit init` 用的專案範本 |
| `docs/map-format.md` | 地圖檔格式的正式說明（由你撰寫） |
| `docs/export-format.md` | 匯出格式的正式說明（由你撰寫） |
| `docs/handoff/backend-status.md` | 進度回報（由你維護） |

## 2. 里程碑

照順序一路做完。每個里程碑結束時，測試要全部通過、commit，並更新 `backend-status.md`，然後直接開始下一個。

### M0：骨架與契約

- pnpm workspace、TypeScript strict、ESM、Vitest、ESLint 和 Prettier。
- GitHub Actions：在 `windows-latest` 和 `ubuntu-latest` 上跑型別檢查和測試。
- `packages/protocol`：照 protocol.md 寫出全部型別。
- `mapedit dev --mock`：用一張固定的測試場景回應 protocol.md 的所有訊息和網址。模組和地形用簡單的方塊 glb；拖動和刪除只改記憶體。
- **驗收**：用 WebSocket 測試客戶端連上 mock，protocol.md 的每一種訊息都有測試。

### M1：地圖檔與編譯

- 設計並實作地圖檔格式（要求見第 3 節），寫成 `docs/map-format.md`。
- YAML 讀寫要保留註解和排版（建議用 `yaml` 套件的 Document API）。
- 解析 `project.yaml`（插槽類型與相容規則、標記類型）、`module.yaml`、`map.yaml`、結構檔和 `markers.yaml`。
- 編譯：插槽接合、結構和模組的座標轉換、15 度與 90 度的旋轉規則、結構用插槽接起來時合併。
- 規則檢查：`off_grid`、`bad_rotation`、`out_of_bounds`、`missing_reference`、`incompatible_socket`，以及檔案格式錯誤（要附檔名和行號）。
- CLI：`mapedit check`，有違規時結束代碼非零，支援 `--json`。
- **驗收**：每一種違規都有測試；同一組檔案的編譯結果固定不變（golden test）。

### M2：幾何與模組

- 建模 API（底層用 manifold-3d）：方塊、圓柱、擠出、旋轉體、聯集、差集、指定材質等，讓 Agent 在 `model.ts` 裡使用。單位公尺，Y 軸朝上。
- 執行 `model.ts`：用 esbuild 轉譯，放在獨立的子程序裡執行，要有逾時；能用 Node 的 permission model 限制檔案和網路存取就用。把它當成不可信任的程式碼。
- 檢查形狀沒有超出 `module.yaml` 宣告的尺寸。
- 模組輸出成 glb（含材質）。
- 內建材質庫第一版，大約 10 到 15 種：木板、深色木板、石磚、灰泥、瓦片、茅草、草地、泥土、碎石、金屬，加上幾種純色。貼圖只用 CC0 素材，在 `SOURCES.md` 記下出處。貼圖依真實尺寸自動投影，Agent 不用碰 UV。
- 碰撞體：依模組外型自動產生。
- 規則檢查：
  - `overlap`：只有真的重疊才算，剛好貼齊不算，要有容許誤差。地基和貼地的模組可以埋進地形，其他模組不行。
  - `unsupported`：放在別的模組上面也算有支撐；標明「可以浮空」的模組例外。
- 地基往下延伸的幾何。
- **驗收**：重疊、剛好貼齊、浮空、可以浮空、地基延伸都有測試。

### M3：地形

- `terrain/height.png`（16-bit）和 `terrain/surface.png`。地塊 1 公尺，高度以 0.5 公尺為一階。
- 地形指令：堆高、挖低、整平、設定高度、鋪地表、堆山。範圍可以是圓形、矩形或沿著路徑。
- 地形網格切塊輸出成 glb，自動把高低差修成平順的斜坡和崖壁。
- 貼地的模組自動貼合地形高度；地基和地形的接合。
- **驗收**：地形指令和接合都有測試；1000 × 1000 公尺的地圖可以順利產生網格。

### M4：伺服器

- 檔案監看、重新編譯，以及 protocol.md 第 4 節的全部 WebSocket 協定。
- 拖動預覽與套用：對齊格子、高度自動貼合地形、會造成違規就拒絕；寫回 YAML 時保留註解。
- 修改紀錄、復原與重做，人和 Agent 的修改都算；同時修改時送出提示。
- 提供 `packages/web/dist` 的靜態檔；檢查 `Host` 和 `Origin`。
- **驗收**：WebSocket 測試涵蓋 protocol.md 第 4 節的所有流程（拖動預覽、套用、拒絕、刪除、復原、同時修改的提示）；一般村莊大小的地圖，拖動預覽來回在 30 毫秒內。

### M5：Agent 介面

- MCP 伺服器：Streamable HTTP（`/mcp`）和 stdio（`mapedit mcp`：連到正在執行的伺服器，沒有的話就自己啟動一個）。
- 工具：見第 4 節。
- 截圖服務：用 `playwright-core` 打開前端的 `/render` 頁面（契約見 protocol.md 第 6 節）。優先使用系統已經安裝的 Edge 或 Chrome，避免另外下載瀏覽器。前端要等後端完成後才會做，所以先用一個測試專用的假頁面（放在測試資料夾，不要放進 `packages/web`）實作 protocol.md 第 6 節的介面，驗證整條截圖流程。
- 文字版平面圖、違規修正建議、查詢。
- **驗收**：用 MCP SDK 的客戶端測試全部工具，stdio 和 HTTP 兩種連法都要測；截圖流程用假頁面跑通。在真的 Claude Code 和 Codex 裡實際使用的部分，等前端完成後再一起驗收。

### M6：匯出與 Unity

- glTF 匯出（建議用 `@gltf-transform/core`）：層級、材質、碰撞體資訊、標記，遊戲資料放在 extras。格式寫成 `docs/export-format.md`。
- 有違規就拒絕匯出；`--out` 可以直接指到 Unity 專案的 Assets 資料夾。
- Unity 匯入套件（UPM 格式，依賴 UnityGLTF）：
  - 碰撞體資訊變成 Collider。
  - 觸發區變成 Trigger Collider。
  - 標記依對應表換成 prefab，對應表是一個 ScriptableObject。
- **驗收**：範例地圖在 Unity 6 匯入後有正確的碰撞體，出生點換成指定的 prefab。如果這台電腦有 Unity 6，就用 batchmode 自動跑這個測試；沒有的話，把手動驗證步驟寫進 `backend-status.md`，然後繼續做下去。

### M7：專案範本與端到端驗收

- `mapedit init` 產生：
  - `project.yaml`
  - 基本模組：地基、地板、牆、有門的牆、有窗的牆、屋頂、樓梯
  - 一張範例地圖
  - `AGENTS.md` 和 `.claude/skills/mapedit/SKILL.md`
  - Claude Code（`.mcp.json`）和 Codex（`.codex/config.toml`）的 MCP 設定
- AGENTS.md 和 skill 用英文寫，內容包括：地圖檔格式、工作流程（改檔 → `check` → `screenshot` → 修正）、常見錯誤。
- **驗收**：寫一個不靠 AI 的端到端腳本：用 `mapedit init` 建立專案，寫出範例小村莊的地形和結構檔，跑 `check` 得到零違規，再匯出成 glb。設計文件的完整完成標準（兩個 Agent 只靠一句話蓋出村莊，在 Unity 按 Play 走進房子），等前端完成後再一起驗收。

## 3. 地圖檔格式的要求

正式格式由你設計，但必須符合以下要求：

- 一律用公尺。位置和高度必須是 0.5 的倍數；角度用度。
- 用插槽接上去的模組，只寫「接在哪個插槽上」，不寫座標。
- 每個東西都有穩定、看得懂的 id，例如 `watchtower_east`、`wall_n`。
- 一個結構檔可以放一個或多個結構。
- 結構的高度預設自動貼合地形，也可以明確指定（例如浮空島）。
- 建議：模組的位置指的是它旋轉後所佔範圍的最小角，這樣不管怎麼轉，位置都會落在 0.5 公尺的格點上。
- 錯誤訊息要指出檔名和行號，並給出修正建議。
- 檔案要小到 Agent 讀得完。
- 示意範例見 design.md 第 7 節，不必照抄。

## 4. MCP 工具（第一版）

| 工具 | 用途 |
|---|---|
| `overview` | 地圖摘要：大小、結構清單、標記、違規數量 |
| `check` | 檢查違規，附修正建議 |
| `screenshot` | 一張圖拼好幾個角度（俯視加四個斜角），可以只看某個區域或結構 |
| `floor_plan` | 某個結構每一層的文字版平面圖 |
| `query` | 某個位置有什麼：地形高度、地表、物件 |
| `free_sockets` | 某個結構還有哪些空著的插槽，各自能接哪些模組 |
| `modules` | 模組清單：尺寸、插槽、特性 |
| `build_module` | 建出某個模組，回報錯誤並附預覽圖 |
| `terrain` | 改地形：堆高、挖低、整平、設定高度、鋪地表、堆山 |
| `export` | 匯出 |

工具名稱可以調整，但要遵守：

- 工具清單固定不變。Codex 會忽略 `tools/list_changed`，也不支援 MCP prompts，所以不要依賴這兩個功能。
- 回傳要精簡，一般控制在 8,000 token 以內，資料多的時候分頁。Claude Code 單次回傳超過約 10,000 token 會警告，預設上限約 25,000。
- 截圖用 MCP 的 image content 回傳，同一個回覆不要帶 `structuredContent`，否則 Codex 會把圖片丟掉（[openai/codex#10334](https://github.com/openai/codex/issues/10334)）。
- 所有文字一律用英文。
- 回答前必須先處理完最新的檔案變動。Agent 剛改完檔案就呼叫 `check`，不能拿到過時的結果。
- 工具說明要寫清楚單位（公尺）、座標方向（+X 東、-Z 北），並附用法範例。

## 5. CLI

| 指令 | 用途 |
|---|---|
| `mapedit init [dir]` | 建立專案（見 M7） |
| `mapedit dev [--port] [--mock] [--open]` | 啟動編輯器伺服器 |
| `mapedit check [--map <id>] [--json]` | 檢查違規，有違規時結束代碼非零 |
| `mapedit export [--map <id>] --out <dir>` | 匯出，有違規就拒絕 |
| `mapedit mcp` | 用 stdio 提供 MCP |

## 6. 技術約束

- Node 22 以上、pnpm、TypeScript strict、ESM。
- Windows 是一級平台：路徑、換行字元、子程序啟動都要在 Windows 上測過。避免需要編譯的原生相依套件（例如需要 node-gyp 的）；PNG 用純 JavaScript 的函式庫，而且要支援 16-bit。
- `packages/core` 不能使用 Node 專屬的 API（`fs`、`child_process` 等），要保持在瀏覽器裡也能執行；用到檔案的部分放在 `packages/server`。
- 不呼叫任何 AI 服務。第一版不需要任何對外的網路連線。
- 相依套件的授權必須和 MIT 相容；材質貼圖只用 CC0。
- 效能目標：有 2,000 個模組的地圖，完整編譯加檢查要在 2 秒內完成。地圖最大是 1000 × 1000 公尺。

## 7. 和前端協作

- 以 docs/protocol.md 為準。需要改契約時，先改文件，再改型別。只是新增不用改版本號；會讓舊程式壞掉的修改，要把 `protocolVersion` 加 1。
- 不要修改 `packages/web`。需要前端配合的事（例如截圖頁面要加新參數），寫在 `backend-status.md` 的「需要前端配合」段落。
- 前端會在後端全部完成、檢查過之後才開始，所以後端的測試不能依賴前端。mock 要留著，之後前端開發和測試會用到。

## 8. 第一版不要做

- 第一人稱模式、用快捷欄放新模組、把模組拖到別的插槽
- 散佈區、匯入外部素材、程式寫的貼圖、匯入外部貼圖、水位、會發光的模組
- Unreal、Godot、Blender 的匯入腳本
- 任何雲端功能、帳號系統、內建 AI

## 9. 工作方式與進度回報

- 從 M0 一路做到 M7，中間不要停下來等人確認。唯一可以停下來的時候，是全部做完。
- 在 `backend` 分支上工作，每個里程碑至少一個 commit。
- 設計文件沒寫清楚的地方，照設計文件和 ADR 的精神選最合理的做法，記在「自行決定的事」，然後繼續。
- 只有人能處理的事（例如要登入帳號、要安裝付費軟體），跳過那一項，記在「需要人處理」，然後繼續做其他部分。
- `docs/handoff/backend-status.md` 隨時保持最新，它也是你的進度紀錄。如果對話被壓縮，或換了新的工作階段，先讀它再接著做。內容分成這幾段：
  - 目前進度：做到哪個里程碑、下一步是什麼
  - 每個里程碑完成了什麼、怎麼驗證
  - 自行決定的事
  - 偏離設計
  - 需要人處理
  - 需要前端配合
  - 已知問題
- 全部做完後：
  - 確認所有測試在這台 Windows 電腦上通過。
  - 把 `backend` 分支推上 GitHub，開一個 PR 到 `main`，PR 說明附上 `backend-status.md` 的重點；推上去之後 CI 要綠燈。如果沒辦法連網，就留在本機分支。
  - 在 `backend-status.md` 最上面寫一段總結，讓 Claude 檢查時知道從哪裡看起。

## 10. 已經查證過的坑

- **Codex 的 MCP**：
  - 同一個回覆裡有 `structuredContent` 時，圖片會被丟掉（[openai/codex#10334](https://github.com/openai/codex/issues/10334)）。
  - 不支援 MCP prompts（[openai/codex#5059](https://github.com/openai/codex/issues/5059)），會忽略 `tools/list_changed`（[openai/codex#37417](https://github.com/openai/codex/issues/37417)）。
  - Windows 上，Codex App 用 `npx` 啟動 stdio 伺服器在某些環境會失敗（[openai/codex#16229](https://github.com/openai/codex/issues/16229)）；桌面版也回報過 HTTP 伺服器顯示就緒、卻看不到工具（[openai/codex#49758](https://github.com/openai/codex/issues/49758)）。範本要同時提供 HTTP 和 stdio 兩種設定，並在 AGENTS.md 寫明遇到問題時怎麼換。
  - Codex 不一定肯自己打開圖片檔（[openai/codex#12439](https://github.com/openai/codex/issues/12439)），所以截圖一定要透過 MCP 回傳。
- **Claude Code 的 MCP**：單次回傳超過約 10,000 token 會警告，預設上限約 25,000，超過的文字會被存成檔案、只回傳路徑。
- **Unity**：沒有內建 glTF 匯入。UnityGLTF 的匯入外掛（例如 `OnAfterImportNode`）在 Editor 裡就讀得到 extras；glTFast 在 Editor 匯入時能不能讀 extras，官方沒有寫清楚，所以選 UnityGLTF。
- **之後的引擎**（第一版不做，先記著）：Godot 4.4 起會把 extras 放進節點的 `meta["extras"]`；Blender 會把 extras 匯入成自訂屬性；Unreal 5.5 起會匯入 extras，但讀取方式要實測。
