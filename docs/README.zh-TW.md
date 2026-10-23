[English](README.md) | **繁體中文** · [專案 README](../README.zh-TW.md)

# 文件

| 頁面                                         | 內容                                                     |
| -------------------------------------------- | -------------------------------------------------------- |
| [安裝](installation.zh-TW.md)                | 需求、Windows 啟動檔、手動安裝、更新                     |
| [使用方式](usage.zh-TW.md)                   | 啟動編輯器、專案資料夾、編輯器操作、CLI 指令             |
| [地圖檔](map-files.zh-TW.md)                 | 專案結構、模組、地圖、結構、標記、地形、違規             |
| [Agent 工作流程](agent-workflow.zh-TW.md)    | `init` 為 Agent 產生的檔案、HTTP 或 stdio 的 MCP、10 個工具、分頁 |
| [匯出](exporting.zh-TW.md)                   | `mapedit export`、GLB 的內容、Unity 6 套件、其他引擎     |
| [疑難排解](troubleshooting.zh-TW.md)         | 常見問題和錯誤訊息                                       |
| [開發](development.zh-TW.md)                 | repo 結構、指令、測試、CI、前端開發、CLI 封裝            |

## 專案筆記

設計和實作 Mapedit 時留下的紀錄，維持原樣。大多是繁體中文；三份格式說明是英文。

**狀態：** 後端（M0–M7）與瀏覽器編輯器（W0–W6）都已實作。驗收紀錄見
[backend-status.md](handoff/backend-status.md) 和 [frontend-status.md](handoff/frontend-status.md)。

### 設計與規格

| 筆記                                | 內容                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| [用語表](../CONTEXT.md)             | 專案用語，以及要避免的說法                                 |
| [設計文件](design.md)               | 第一版設計：目標、空間規則、Agent 和人的介面、範圍         |
| [前後端介面契約](protocol.md)       | 瀏覽器編輯器和伺服器之間的訊息                             |
| [地圖檔格式](map-format.md)         | 地圖檔第 1 版的完整說明（英文）                            |
| [建模 API 與隔離執行](model-api.md) | `model.ts` 的函式、材質、沙盒和限制（英文）                |
| [GLB 匯出格式](export-format.md)    | GLB 層級和 `extras.mapedit` 欄位，第 1 版（英文）          |

### 決策紀錄

| 紀錄                                                 | 決定                                             |
| ---------------------------------------------------- | ------------------------------------------------ |
| [0001](adr/0001-two-level-grid.md)                   | 兩層格子：地圖一張，每個結構也各有一張           |
| [0002](adr/0002-local-first-open-source.md)          | 本機執行、在 GitHub 開源                         |
| [0003](adr/0003-agent-first-simple-ui.md)            | Agent 優先，人的操作像玩 Minecraft 一樣簡單      |
| [0004](adr/0004-map-as-text-files.md)                | 地圖以看得懂的文字檔為準                         |
| [0005](adr/0005-mcp-and-cli.md)                      | 指令同時提供 MCP 和 CLI                          |
| [0006](adr/0006-procedural-modeling-plus-imports.md) | 模組外型：程式生成，加上匯入外部素材             |
| [0007](adr/0007-export-playable-levels-via-gltf.md)  | 用 glTF 加上各引擎的匯入腳本，匯出可以直接玩的關卡 |
| [0008](adr/0008-foundations-extend-down.md)          | 地基在斜坡上自動往下延伸，不自動整地             |
| [0009](adr/0009-map-size-limit.md)                   | 地圖大小限制在 100 到 1000 公尺                  |
| [0010](adr/0010-tech-stack.md)                       | TypeScript、three.js、manifold-3d、YAML、MIT     |
| [0011](adr/0011-can-float-supports-but-is-listed.md) | 可以浮空的模組能撐住上面的東西，但一律列出來     |

### 交接紀錄

| 紀錄                                               | 內容                               |
| -------------------------------------------------- | ---------------------------------- |
| [codex-backend.md](handoff/codex-backend.md)       | 後端實作說明（給 Codex）           |
| [backend-status.md](handoff/backend-status.md)     | 後端完成紀錄、測試結果與前端交接   |
| [backend-fixes.md](handoff/backend-fixes.md)       | PR #1 審查修正，第一輪             |
| [backend-fixes-2.md](handoff/backend-fixes-2.md)   | PR #1 審查修正，第二輪             |
| [backend-fixes-3.md](handoff/backend-fixes-3.md)   | PR #1 審查修正，第三輪             |
| [backend-fixes-4.md](handoff/backend-fixes-4.md)   | PR #1 審查修正，第四輪             |
| [claude-frontend.md](handoff/claude-frontend.md)   | 前端實作說明（給 Claude）          |
| [frontend-status.md](handoff/frontend-status.md)   | 前端完成紀錄與驗收                 |
| [frontend-fixes.md](handoff/frontend-fixes.md)     | PR #2 審查修正，第一輪             |
| [frontend-fixes-2.md](handoff/frontend-fixes-2.md) | PR #2 審查修正，第二輪             |

### repo 裡的其他說明

- [Unity 套件說明](../integrations/unity/README.md)：安裝 Unity 6 匯入套件，以及 batchmode 驗收（英文）
- [Grey Church](../templates/church/README.md)：Windows 啟動檔加入的範例專案（英文）
- [給 Agent 的說明書原稿](../templates/authoring.md)：`init` 複製成 `AGENTS.md` 和 Claude Code skill 的內容（英文）
- [材質來源](../packages/core/materials/SOURCES.md)：每張內建貼圖的出處（英文）
