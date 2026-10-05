# mapedit

An agent-first 3D game map editor. AI coding agents (Claude Code, Codex) build maps by editing text files, humans make quick fixes in the browser, and maps export to Unity, Unreal, Godot and Blender.

主要給 Agent 用、其次給人用的 3D 遊戲地圖編輯器。Agent（Claude Code、Codex）直接改地圖檔和建模，編輯器負責算出精確位置，並擋下穿模、浮空等違規；人在瀏覽器裡用像玩 Minecraft 一樣的操作做簡單修正；成果匯出到 Unity、Unreal、Godot、Blender。

> 狀態：後端（M0–M7）與瀏覽器編輯器（W0–W6）都已實作。驗收紀錄見 [backend-status.md](docs/handoff/backend-status.md) 和 [frontend-status.md](docs/handoff/frontend-status.md)。

## 開發與執行

需要 Node.js 22.13 以上與 pnpm 11.19。Windows、Linux 均在 CI 驗證。

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm mapedit init ./my-maps
cd my-maps
node ../packages/cli/dist/index.js check --json
node ../packages/cli/dist/index.js dev
```

伺服器只接受本機連線，預設 `http://127.0.0.1:4790`。`pnpm build` 會一起建出
`packages/web/dist`，`dev` 就直接在這個網址提供編輯器，以及 MCP `screenshot` 用的
`/render` 截圖頁面；網址加上 `?map=<id>` 可以直接打開某一張地圖。Agent 改檔案時畫面會即時更新，
人在網頁上的修改會寫回 YAML 並保留註解。

### 編輯器操作

| 操作 | 做法 |
|---|---|
| 轉動鏡頭 | 右鍵拖曳 |
| 移動鏡頭 | 中鍵拖曳、在空地上左鍵拖曳，或 WASD／方向鍵 |
| 縮放 | 滾輪（往游標的位置） |
| 對焦 | F：飛到選取的東西；沒有選取時看整張地圖 |
| 選取 | 點一下選整個結構，再點一次同一個結構裡的模組就只選那個模組；Esc 取消 |
| 移動 | 拖曳結構或標記；預覽變紅就是放不下去，放開時不會套用 |
| 旋轉 | R 轉 15 度（Shift+R 反方向），拖曳中也可以按 |
| 刪除 | Delete 或 Backspace |
| 復原、重做 | Ctrl+Z；Ctrl+Y 或 Ctrl+Shift+Z |

左邊列出違規（編號和地圖上的旗子一致，點一下就飛過去）和檔案錯誤，右邊是修改紀錄；
介面語言可以在左上角切換繁體中文或英文。

### 前端開發

```sh
pnpm build
pnpm mapedit dev --mock
pnpm dev:web
```

打開 `http://127.0.0.1:5173`。Vite 開發伺服器把 `/api`、`/assets`、`/ws` 轉給
`http://127.0.0.1:4790`；後端在別的連接埠時設定 `MAPEDIT_BACKEND`，例如
`MAPEDIT_BACKEND=http://127.0.0.1:4791`。`--mock` 用固定的測試場景，操作只改記憶體，
`POST /api/mock/trigger`（body `{"notice":"agent_changed"}` 等）可以觸發每一種提示。
瀏覽器測試會用系統的 Edge 或 Chrome（無頭模式）實際操作編輯器和 `/render`，找不到瀏覽器時跳過。

在地圖專案目錄中執行 CLI：

```sh
node ../packages/cli/dist/index.js check --map village --json
node ../packages/cli/dist/index.js export --map village --out ./export
node ../packages/cli/dist/index.js mcp
```

`check` 與 `export` 沒加 `--map` 時會處理全部地圖。任何一張有違規或檔案錯誤，
檢查就以非零代碼結束；匯出會在寫入任何檔案前全部拒絕，並列出問題地圖。
`check --json` 固定回傳 `{ "maps": [{ "map": "village", "violations": [],
"fileErrors": [], "floating": [] }] }`，指定地圖時陣列只有一項。
`floating` 列出所有 `canFloat` 模組的 ref、模組類型與世界座標，包含目前貼地的實例；
這是提示資訊，不算違規。MCP `check` 和 `overview` 同樣預設檢查全部地圖。

`mcp` 以 stdio 連接此專案正在運行的伺服器，或自行啟動一個。HTTP MCP 位於
`/mcp`，提供固定的 10 個工具。`init` 會產生 Claude Code 與 Codex 的 HTTP 設定
和使用絕對 Node/CLI 路徑的 stdio 備用設定。執行期間不呼叫 AI 或外部服務；
材質與貼圖均已包含在 repo。初次安裝相依套件和 UnityGLTF 需要網路。

## CLI 封裝驗收

封裝或安裝本機 tarball 前先執行 `pnpm build`，產生四個套件的 `dist` 與
CLI 自己的範本。CLI 的 `prepack` 會更新範本；core/server/protocol 的
`pack` 不會自動重新編譯 TypeScript。

```sh
pnpm build
pnpm --dir packages/cli pack --pack-destination ../../.cache/packages
node scripts/test-packed-cli.mjs --keep
```

最後一行會另行把四個 workspace 套件執行 `pnpm pack`，在 repo 外的暫存目錄
以本機 tarball overrides 和 repo 鎖定的完整相依版本圖離線安裝，再用封裝 CLI
執行 `init` 與 `check`。先前的 `pnpm install --frozen-lockfile` 需已填入相依套件
快取；驗收安裝同樣使用 frozen lockfile，並明確沿用 repo 安裝時的套件快取，
避免 Windows 跨磁碟時選到空快取。輸出會列出保留的暫存路徑。
測試驗證套件及相依解析沒有連回 repo，並檢查模型、材質、WASM 與範本都能使用。

目前所有套件仍保留 `private: true`。發佈到 npm 前，需要人決定正式套件名稱、
`@mapedit` 相依套件的 scope，以及使用的 npm 帳號；這一輪未發佈。

## 驗證與 Unity

```sh
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` 不使用 AI：從 init 建立專案，寫出三間房子、地形、道路和標記，
通過零違規檢查後匯出 GLB。輸出列出專案和 GLB 路徑。

Unity 6 套件與安裝步驟見 [integrations/unity](integrations/unity/README.md)。
Windows PowerShell 5.1 或 PowerShell 7 可使用 `scripts/test-unity.ps1 -GlbPath <village.glb>` 實際驗證 UnityGLTF
匯入、MeshCollider、Trigger 和出生點 prefab。`.cache` 中的測試專案與結果不提交。

## 文件

- [設計文件](docs/design.md)
- [用語表](CONTEXT.md)
- [決策紀錄](docs/adr/)
- [前後端介面契約](docs/protocol.md)
- [後端實作說明（給 Codex）](docs/handoff/codex-backend.md)
- [後端完成紀錄與前端交接](docs/handoff/backend-status.md)
- [前端實作說明](docs/handoff/claude-frontend.md)與[前端完成紀錄](docs/handoff/frontend-status.md)
- [地圖檔格式](docs/map-format.md)
- [建模 API 與隔離執行](docs/model-api.md)
- [GLB 匯出格式](docs/export-format.md)

## 授權

[MIT](LICENSE)
