# mapedit

An agent-first 3D game map editor. AI coding agents (Claude Code, Codex) build maps by editing text files, humans make quick fixes in the browser, and maps export to Unity, Unreal, Godot and Blender.

主要給 Agent 用、其次給人用的 3D 遊戲地圖編輯器。Agent（Claude Code、Codex）直接改地圖檔和建模，編輯器負責算出精確位置，並擋下穿模、浮空等違規；人在瀏覽器裡用像玩 Minecraft 一樣的操作做簡單修正；成果匯出到 Unity、Unreal、Godot、Blender。

> 狀態：M0–M7 後端已實作；前端由 Claude 接續。完整驗收紀錄見 [backend-status.md](docs/handoff/backend-status.md)。

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

伺服器只接受本機連線，預設 `http://127.0.0.1:4790`。建置好的前端放在
`packages/web/dist` 時會自動提供靜態檔。目前沒有前端時會顯示後端狀態頁；
正式截圖仍需要前端實作 `/render`，測試使用獨立的假頁面驗證完整流程。
前端開發可直接從 repo 執行 `pnpm mapedit dev --mock`，操作只改記憶體。

在地圖專案目錄中執行 CLI：

```sh
node ../packages/cli/dist/index.js check --map village --json
node ../packages/cli/dist/index.js export --map village --out ./export
node ../packages/cli/dist/index.js mcp
```

`mcp` 以 stdio 連接此專案正在運行的伺服器，或自行啟動一個。HTTP MCP 位於
`/mcp`，提供固定的 10 個工具。`init` 會產生 Claude Code 與 Codex 的 HTTP 設定
和使用絕對 Node/CLI 路徑的 stdio 備用設定。執行期間不呼叫 AI 或外部服務；
材質與貼圖均已包含在 repo。初次安裝相依套件和 UnityGLTF 需要網路。

## 驗證與 Unity

```sh
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` 不使用 AI：從 init 建立專案，寫出三間房子、地形、道路和標記，
通過零違規檢查後匯出 GLB。輸出列出專案和 GLB 路徑。

Unity 6 套件與安裝步驟見 [integrations/unity](integrations/unity/README.md)。
Windows 可使用 `scripts/test-unity.ps1 -GlbPath <village.glb>` 實際驗證 UnityGLTF
匯入、MeshCollider、Trigger 和出生點 prefab。`.cache` 中的測試專案與結果不提交。

## 文件

- [設計文件](docs/design.md)
- [用語表](CONTEXT.md)
- [決策紀錄](docs/adr/)
- [前後端介面契約](docs/protocol.md)
- [後端實作說明（給 Codex）](docs/handoff/codex-backend.md)
- [後端完成紀錄與前端交接](docs/handoff/backend-status.md)
- [地圖檔格式](docs/map-format.md)
- [建模 API 與隔離執行](docs/model-api.md)
- [GLB 匯出格式](docs/export-format.md)

## 授權

[MIT](LICENSE)
