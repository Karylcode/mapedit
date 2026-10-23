[English](development.md) | **繁體中文** · [文件索引](README.zh-TW.md)

# 開發

## repo 結構

這是 TypeScript 套件組成的 pnpm workspace（嚴格 ESM）。

| 位置                     | 內容                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `packages/core`          | 領域模型、地圖檔讀寫、編譯、規則檢查、地形、建模 API、glTF 產生、內建材質 |
| `packages/protocol`      | 伺服器和瀏覽器編輯器共用的訊息型別（[protocol.md](protocol.md)）         |
| `packages/server`        | 本機伺服器：監看檔案、WebSocket、MCP、截圖、修改紀錄                    |
| `packages/cli`           | `mapedit` 指令                                                          |
| `packages/web`           | 瀏覽器編輯器和 `/render` 截圖頁面（three.js）                           |
| `integrations/unity`     | Unity 6 匯入套件                                                        |
| `templates/project`      | `mapedit init` 複製的內容：基本模組、範例村莊、給 Agent 的說明書、MCP 設定 |
| `templates/church`       | Windows 啟動檔複製到 `projects/church` 的 Grey Church 範例              |
| `templates/authoring.md` | 給 Agent 的說明書原稿                                                   |
| `scripts`                | 啟動檔、更新程式、端到端測試、封裝和 Unity 驗收                         |

## 指令

在 `pnpm install` 之後，於 repo 根目錄執行。

| 指令                                | 作用                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `pnpm build`                        | 準備 CLI 範本、用 `tsc -b` 編譯、建置 `packages/web/dist`        |
| `pnpm typecheck`                    | 檢查所有套件的型別                                               |
| `pnpm test`                         | 執行所有 Vitest 測試                                             |
| `pnpm lint`                         | 對 `packages` 執行 ESLint                                        |
| `pnpm format`／`pnpm format:check`  | Prettier，改寫或只檢查                                           |
| `pnpm e2e`                          | 端到端的村莊驗收（要先 `pnpm build`）                            |
| `pnpm generate:authoring`           | 從 `templates/authoring.md` 重新產生給 Agent 的說明書            |
| `pnpm mapedit <指令>`               | 執行建置好的 CLI                                                 |
| `pnpm dev:web`                      | 瀏覽器編輯器的 Vite 開發伺服器                                   |

## 測試

```sh
pnpm typecheck
pnpm test
pnpm e2e
```

- `pnpm test` 執行所有 `packages/**/test/**/*.test.ts`。瀏覽器測試會用系統的 Edge 或 Chrome（無頭模式）
  實際操作編輯器和 `/render`。找不到瀏覽器時會跳過；但有設定 `CI` 環境變數時，找不到瀏覽器就算失敗。
- `pnpm e2e` 不使用 AI：用 `init` 建立專案，寫出三間房子、堆一座山、鋪一條碎石路，保留範本裡的出生點和
  觸發區標記，通過零違規檢查後匯出 GLB，並列出專案和 GLB 的路徑。想保留專案，就指定資料夾：
  `node scripts/e2e.mjs <資料夾>`。

## CI

`.github/workflows/ci.yml`（workflow 名稱是「Backend」）在推送到 `main` 和 pull request 時執行。它在
`ubuntu-latest` 和 `windows-latest` 上用 Node.js 22 和 24，執行 `pnpm install --frozen-lockfile`、
`pnpm typecheck`、`pnpm lint` 和 `pnpm test`。不執行 `pnpm e2e`、`pnpm format:check` 和 Unity 驗收。

## 前端開發

```sh
pnpm build
pnpm mapedit dev --mock
pnpm dev:web
```

打開 `http://127.0.0.1:5173`。Vite 開發伺服器把 `/api`、`/assets`、`/ws` 轉給 `http://127.0.0.1:4790`；
後端在別的連接埠時設定 `MAPEDIT_BACKEND`，例如 `MAPEDIT_BACKEND=http://127.0.0.1:4791`。

`--mock` 用固定的測試場景，操作只改記憶體。`POST /api/mock/trigger`（body 例如 `{"notice": "agent_changed"}`）
可以觸發每一種提示，只有 mock 模式才有。

## 給 Agent 的說明書

`templates/authoring.md` 是給 Agent 的說明書唯一的原稿。`pnpm generate:authoring` 會把它寫成
`templates/project/AGENTS.md`，再加上 front matter 寫成 `templates/project/.claude/skills/mapedit/SKILL.md`。
`pnpm build` 也會做這件事，並把 `templates/project` 複製到 `packages/cli/templates`（不受 Git 管理）。
`node scripts/generate-authoring.mjs --check` 會在產生的檔案過期時失敗。

## CLI 封裝驗收

封裝或安裝本機 tarball 前先執行 `pnpm build`，產生四個套件的 `dist` 與 CLI 自己的範本。CLI 的 `prepack`
會更新範本；core、server、protocol 的 `pack` 不會自動重新編譯 TypeScript。

```sh
pnpm build
pnpm --dir packages/cli pack --pack-destination ../../.cache/packages
node scripts/test-packed-cli.mjs --keep
```

最後一行會另行把四個 workspace 套件執行 `pnpm pack`，在 repo 外的暫存目錄以本機 tarball overrides 和
repo 鎖定的完整相依版本圖離線安裝，再用封裝的 CLI 執行 `init` 與 `check`。先前的
`pnpm install --frozen-lockfile` 需已填入套件快取；驗收安裝同樣使用 frozen lockfile，並明確沿用 repo 安裝時的
套件快取，避免 Windows 跨磁碟時選到空快取。輸出會列出保留的暫存路徑。測試驗證套件及相依解析沒有連回 repo，
並檢查模型、材質、WASM 與範本都能使用。

目前所有套件仍保留 `"private": true`。發佈到 npm 前，需要人決定正式套件名稱、`@mapedit` 相依套件的 scope，
以及使用的 npm 帳號。目前還沒有發佈。

## Unity 驗收

`scripts/test-unity.ps1 -GlbPath <village.glb>` 會在 Unity 6 的 batchmode 匯入 GLB，檢查碰撞體、觸發區和
出生點 prefab。見[匯出](exporting.zh-TW.md#驗證-unity-匯入)。

## 專案狀態

後端（M0–M7）與瀏覽器編輯器（W0–W6）都已實作。驗收紀錄見 [backend-status.md](handoff/backend-status.md) 和
[frontend-status.md](handoff/frontend-status.md)。設計文件、決策紀錄和其他交接檔案列在
[文件索引](README.zh-TW.md#專案筆記)。
