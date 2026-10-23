[English](agent-workflow.md) | **繁體中文** · [文件索引](README.zh-TW.md)

# Agent 工作流程

Agent（例如 Claude Code 或 Codex）在你的電腦上執行，從外部連進編輯器。編輯器本身不內建任何 AI。
Agent 直接改[地圖檔](map-files.zh-TW.md)，並用 MCP 工具檢查、查詢、改地形和看成果。

## `init` 為 Agent 產生的檔案

| 檔案                              | 用途                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `AGENTS.md`                       | 說明書：工作流程、檔案格式、模組、地形、常見錯誤。Codex 會讀這個檔案 |
| `.claude/skills/mapedit/SKILL.md` | 同一份說明書，做成 Claude Code skill                                 |
| `.mcp.json`                       | Claude Code：用 HTTP 連 `http://127.0.0.1:4790/mcp`                   |
| `.mcp.stdio.json`                 | Claude Code：用 stdio 連，備用                                        |
| `.codex/config.toml`              | Codex：用 HTTP 連 `http://127.0.0.1:4790/mcp`                         |
| `.codex/config.stdio.toml`        | Codex：用 stdio 連，備用                                              |
| `.gitignore`                      | 忽略 `.mapedit/`，`mapedit dev` 在這裡記錄正在執行的伺服器           |

給 Agent 的內容（說明書、工具說明、違規訊息）都用英文，Agent 讀英文最穩定，也最省 token。

## 連線方式

**HTTP（預設）。** 先啟動編輯器（`mapedit dev` 或 Windows 啟動檔）。MCP 位在編輯器伺服器的 `/mcp`，
操作的是編輯器目前開著的專案，所以請把「專案」選單切到 Agent 要改的專案。

**stdio（備用）。** HTTP 工具用不了的時候改用 stdio，例如編輯器沒開、用了別的連接埠，或開著別的專案。
Claude Code：把 `.mcp.json` 的內容換成 `.mcp.stdio.json`；Codex：把 `.codex/config.toml` 裡的那一段換成
`.codex/config.stdio.toml`。

- stdio 設定用 `init` 當時 Node.js 和 CLI 的絕對路徑執行 `mapedit mcp`，避開 Windows 上 `npx` 啟動的問題。
  專案或 repo 搬家後，要更新這些路徑。
- `mapedit mcp` 會先找這個專案正在執行的編輯器伺服器（讀 `.mapedit/server.json`），找到就接上去，
  修改紀錄和截圖都共用同一個；找不到就在空的連接埠自己啟動一個，Agent 斷線時關掉。

## 工作循環

`AGENTS.md` 要 Agent 照這個順序做：

1. 讀地圖和結構的 YAML。用 `modules` 和 `free_sockets` 查尺寸和可以接的插槽。
2. 用穩定、看得懂的 id 改檔案。大的結構自己一個檔，保留說明設計意圖的註解。
3. 每完成一段修改，就執行 MCP `check`（或 `mapedit check --json`）。修好所有違規和檔案錯誤，再檢查一次。
4. 每張改過的地圖都呼叫 `screenshot` 看圖。修正看起來不對的地方，重複檢查和截圖，直到兩者都沒問題。
5. 檢查通過後匯出：`mapedit export --out ./export`，只匯出一張就加 `--map <id>`。

提示詞一句話就夠，例如：「蓋一個有三間房子、一條路和出生點的小村莊。」設計目標是 Claude Code 和 Codex
都能只靠這樣一句話，做出零違規的地圖。

## 10 個 MCP 工具

工具清單是固定的。座標一律是公尺，+Y 朝上、+X 是東、-Z 是北。`map` 可以不填：`check` 和 `overview`
會檢查全部地圖，其他工具用目前的地圖。清單類的結果可以用 `offset`（預設 0）和 `limit`（1–100，預設 50）。

| 工具           | 參數                                                         | 回傳                                                 |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `overview`     | `map`                                                        | 地圖大小、結構、標記、`canFloat` 實例、違規數量      |
| `check`        | `map`                                                        | 違規和修正建議、檔案錯誤、`canFloat` 實例、`ok`      |
| `screenshot`   | `map`、`structure`、`views`、`tileSize`、`focus`、`highlight`、`showViolations` | 俯視加四個斜角拼成的 PNG |
| `floor_plan`   | `map`、`structure`                                           | 每一層的文字版平面圖和模組位置                       |
| `query`        | `map`、`x`、`z`                                              | 該位置的地形高度、地表和物件                         |
| `free_sockets` | `map`、`structure`                                           | 空著的插槽，以及能接上去的模組插槽                   |
| `modules`      | —                                                            | 模組的尺寸、插槽和支撐特性                           |
| `build_module` | `module`                                                     | 隔離建出 `model.ts`：診斷結果和預覽圖                |
| `terrain`      | `map`、`command`                                             | 套用一個地形指令                                     |
| `export`       | `map`、`out`                                                 | 寫出一個 GLB；有違規的地圖會被拒絕                   |

- `screenshot`：`views` 可以是 `top`、`ne`、`nw`、`se`、`sw` 的任意組合（預設五個都要）；`tileSize` 是 64–1024
  像素（預設 512）；`focus` 是 `{center: [x, y, z], radius}`；`highlight` 最多 100 個物件 ref；`showViolations`
  預設是 true。
- `terrain`：`command.operation` 是 `raise` 或 `lower`（加 `amount`）、`flatten`（`height` 可不填）、
  `set_height` 或 `mountain`（加 `height`），或 `paint`（加 `surface`）。`command.region` 是
  `{kind: "circle", center: [x, z], radius}`、`{kind: "rectangle", min: [x, z], max: [x, z]}` 或
  `{kind: "path", points: [[x, z], ...], width}`。高度以 0.5 公尺為一階。
- `export`：`out` 是相對於專案資料夾的路徑。

`terrain` 呼叫範例：

```json
{
  "map": "village",
  "command": {
    "operation": "paint",
    "surface": "gravel",
    "region": { "kind": "path", "points": [[10, 20], [40, 20]], "width": 3 }
  }
}
```

## 很長的結果

每次回傳的文字最多 24,000 個字元。更長的結果或錯誤會變成
`{"paging": {"fragment": "...", "nextCursor": "...", "totalCharacters": 12345}}`。用同一個工具、只帶
`{"cursor": "..."}` 繼續呼叫，直到 `nextCursor` 是 `null`，再依序把 fragment 接起來。

- 後續的頁讀的是存下來的結果，所以改地形、匯出和建模組都只會執行一次。圖片在第一頁。
- 存下來的結果五分鐘後失效，快取滿了也可能被清掉。
- 翻頁之間專案檔案有變動時，會回傳 `Results changed since the first page. Run the tool again without cursor.`
- cursor 失效或作廢後，先看目前的狀態，再決定要不要重做會修改東西的工具。

## 截圖

伺服器用無頭的 Edge 或 Chrome 打開編輯器的 `/render` 頁面來截圖，所以 Agent 看到的畫面和人看到的一致。
需要編輯器的建置（`pnpm build`）和其中一種瀏覽器。一次截圖最多 50 秒；時間不夠時，減少角度或縮小
`tileSize` 會有幫助。

截圖用 MCP 的圖片格式回傳，而且不帶 `structuredContent`，否則 Codex 會把圖片丟掉
（[openai/codex#10334](https://github.com/openai/codex/issues/10334)）。截圖也不只存成檔案，因為 Codex 不一定
肯自己打開圖片檔（[openai/codex#12439](https://github.com/openai/codex/issues/12439)）。`/render` 不能用時，
Agent 應該回報「畫面還沒確認」：`check` 通過不代表地圖看起來沒問題。

## 寫新模組

Agent 可以自己寫新模組：在 `modules/` 底下建一個新資料夾，放 `module.yaml` 和 `model.ts`。用 `build_module`
取得診斷結果和預覽圖。模型程式在獨立的 Node.js 程序裡、全新的 QuickJS WebAssembly 環境中執行，
預設 10 秒時限，另外還有其他硬性限制。詳細見英文的[建模 API 與隔離執行](model-api.md)。
