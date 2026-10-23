[English](README.md) | **繁體中文**

# Mapedit

[![CI](https://github.com/Karylcode/mapedit/actions/workflows/ci.yml/badge.svg)](https://github.com/Karylcode/mapedit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22.13+](https://img.shields.io/badge/node-22.13%2B-blue.svg)](https://nodejs.org/)
[![Unity 6](https://img.shields.io/badge/Unity-6-orange.svg)](integrations/unity/README.md)

Mapedit 是主要給 Agent 用、其次給人用的 3D 遊戲地圖編輯器。Claude Code、Codex 這類 AI coding agent
直接改地圖的文字檔，並呼叫 MCP 工具。編輯器像編譯器：算出每個東西的精確位置，標出穿模、浮空等違規，
並在瀏覽器裡即時顯示；人在瀏覽器裡用像玩 Minecraft 一樣的操作做簡單修正。地圖匯出成 glTF，再用匯入套件
在 Unity 6 裡變成可以直接玩的關卡。程式用 TypeScript、three.js 和 manifold-3d 寫成，只在你的電腦上執行。

## 可以做什麼

- **地圖就是文字檔。** 專案、模組、地圖、結構和標記都是 YAML，地形是兩張 PNG 圖片。git 留下所有紀錄，
  在瀏覽器裡修改也會保留檔案裡的註解。
- **Agent 蓋，編輯器檢查。** `init` 會產生 `AGENTS.md`、Claude Code skill，以及 Claude Code 和 Codex
  的 MCP 設定。MCP 伺服器有固定的 10 個工具，從 `check`、`screenshot` 到 `terrain`。
- **規則很嚴格。** 東西會對齊 0.5 公尺的格子和相容的插槽。`check` 會列出穿模、沒有支撐、位置或角度
  不在格子上、超出地圖、找不到引用、插槽不相容，每一項都附修正建議。有違規的地圖不能匯出。
- **瀏覽器編輯器，做簡單修正。** 轉動、移動、縮放鏡頭；選取、拖曳、每次轉 15 度、刪除、復原、重做。
  放下去會造成違規的話，就放不下去。按 V 可以用第一人稱在地圖裡飛。介面有繁體中文和英文。
- **模組用程式寫。** 每個模組的外型是一個 `model.ts`，用建立在 manifold-3d 上的建模 API 寫成，
  在 QuickJS 裡隔離執行。內建材質的貼圖照真實尺寸貼上。
- **地形。** 由 1 公尺見方的地塊組成，每塊有高度和地表。`terrain` 工具可以堆高、挖低、整平、
  鋪地表和堆山。地基遇到斜坡會自己往下延伸到地面。
- **匯出 glTF。** 每張地圖匯出成一個獨立的 `.glb`，包含層級、材質、網格碰撞體和標記資料。
  Unity 6 套件會把這些資料變成碰撞體、觸發區和你自己的 prefab。
- **只在本機執行。** 伺服器只聽 `127.0.0.1`，執行期間不呼叫 AI 或任何線上服務。

## 需求

- Node.js 22.13 以上
- pnpm 11.19。Windows 的啟動檔會透過 Corepack 執行 pnpm，走這條路就不用另外安裝。
- Windows 或 Linux。CI 在兩者上用 Node.js 22 和 24 測試。
- Edge 或 Chrome，給 MCP 的 `screenshot` 工具使用
- Git，給 `git clone` 和 `更新.bat` 使用
- 選用：Unity 6 加上 UnityGLTF 2.21.0，用來把地圖匯入 Unity

詳細：[安裝](docs/installation.zh-TW.md)。

## 快速開始

**Windows：** 下載這個 repo（git clone 或 ZIP 都可以），雙擊 `啟動地圖編輯器.bat`。第一次會安裝並建置
編輯器，大約需要幾分鐘，接著加入範例的教堂專案，並用瀏覽器打開 `http://127.0.0.1:4790`。

**任何系統：**

```sh
git clone https://github.com/Karylcode/mapedit.git
cd mapedit
pnpm install
pnpm build
pnpm mapedit init projects/my-maps
pnpm mapedit dev --open --projects projects --project my-maps
```

接著在 `projects/my-maps` 裡啟動 Claude Code 或 Codex，跟它說例如：「蓋一個有三間房子、一條路和出生點
的小村莊。」Agent 會改檔案、執行 `check` 和 `screenshot`，再修正回報的問題；你可以在瀏覽器裡看著它做。

接著看：[使用方式](docs/usage.zh-TW.md)。

## 疑難排解

- **`.bat` 檔顯示 `Node.js was not found`**：到 https://nodejs.org 安裝 Node.js 22.13 以上。
- **Agent 改到別的專案**：HTTP 的 MCP 操作的是編輯器目前開著的專案。在左上角的「專案」選單選對專案，
  或改用 `init` 產生的 stdio 設定。
- **`screenshot` 失敗**：安裝 Edge 或 Chrome，並執行 `pnpm build`，讓編輯器的網頁存在。
- **`更新.bat` 沒有更新就停下來**：它不會蓋掉你在 repo 裡改過的檔案，並會列出這些檔案。
  地圖請放在 `projects/`，更新不會動到它。

更多：[疑難排解](docs/troubleshooting.zh-TW.md)。

## 文件

- [文件索引](docs/README.zh-TW.md)：所有頁面，以及設計和交接筆記
- [安裝](docs/installation.zh-TW.md)：需求、Windows 啟動檔、手動安裝、更新
- [使用方式](docs/usage.zh-TW.md)：啟動編輯器、專案資料夾、編輯器操作、CLI 指令
- [地圖檔](docs/map-files.zh-TW.md)：專案結構、模組、結構、標記、地形、違規
- [Agent 工作流程](docs/agent-workflow.zh-TW.md)：Agent 設定、10 個 MCP 工具、修改－檢查－截圖的循環
- [匯出](docs/exporting.zh-TW.md)：匯出 GLB、Unity 6 套件、其他引擎
- [疑難排解](docs/troubleshooting.zh-TW.md)：常見問題和錯誤訊息
- [開發](docs/development.zh-TW.md)：repo 結構、測試、CI、前端開發、CLI 封裝
- [後端完成紀錄](docs/handoff/backend-status.md)：後端 M0–M7 都已實作，附驗收紀錄
- [前端完成紀錄](docs/handoff/frontend-status.md)：瀏覽器編輯器 W0–W6 都已實作，附驗收紀錄

## 授權

MIT，詳見 [LICENSE](LICENSE)。

- 內建材質的圖片是 Poly Haven 的 CC0 貼圖，來源和校驗碼見 [SOURCES.md](packages/core/materials/SOURCES.md)。
