# Frontend implementation status

`packages/web` is the browser editor and the `/render` screenshot page. It follows
[claude-frontend.md](claude-frontend.md) and [protocol.md](../protocol.md); the backend
is not modified here.

## 目前進度

| 階段 | 狀態 | 驗收 |
|---|---|---|
| W0 骨架 | 完成 | `test/connection.test.ts`、`test/i18n.test.ts`；mock 上實際畫面 |
| W1 畫出場景 | 完成 | `test/map-view.test.ts`、`test/snapshot-index.test.ts`、`test/camera-math.test.ts`；mock、真的村莊和 1000 × 1000 公尺地圖的實際畫面 |
| W2 俯瞰操作 | 完成 | `test/overview-controls.test.ts`、`test/selection.test.ts`、`test/editor-browser.test.ts`（真的 Edge） |
| W3 編輯 | 進行中 | |
| W4 違規、提示、語言 | 未開始 | |
| W5 `/render` | 未開始 | |
| W6 端到端 | 未開始 | |

## 每個階段完成了什麼、怎麼驗證

- **W0**：Vite 8 + TypeScript strict + three.js 的 `@mapedit/web`。根目錄 `pnpm build`
  在 `tsc -b` 之後執行 `vite build`，`tsc -b` 也型別檢查 web；ESLint 與 Vitest 的既有設定
  已涵蓋 `packages/web`。Vite 開發伺服器把 `/api`、`/assets`、`/ws` 轉給
  `MAPEDIT_BACKEND`（預設 `http://127.0.0.1:4790`），並改寫 `Host`（`changeOrigin`）
  與 `Origin`（HTTP 有帶時、WebSocket 一律）。WebSocket 客戶端：`hello` → `welcome` →
  `openMap`，斷線後退避重連並重新開啟目前的地圖；格式不明的伺服器訊息直接忽略。
  畫面左上角的「圖框」顯示專案名稱、地圖、版次和連線狀態，並可切換語言。
  驗證：`connection.test.ts` 用假 socket 測流程、重連、request 編號、版本不相容，
  另外對真的 mock 伺服器測 `welcome`/`scene`/`history` 和伺服器重啟後自動重連；
  瀏覽器預覽 `pnpm mapedit dev --mock` + Vite，畫面顯示 Mock project、Mock village、
  版次 0、即時同步。

- **W1**：`MapView` 把快照畫成 three.js 物件：地形切塊（同一種地表共用一個材質）、
  模組（每個模組類型的每個 primitive 一個 `InstancedMesh`）、地基延伸、點標記（地面圓盤、
  朝向箭頭、桿子）和方形標記（半透明方塊加邊線），標記上方有固定螢幕大小的圖示。
  太陽依 `azimuth`/`elevation` 打光並投影，陰影範圍跟著鏡頭。glb 以網址快取，新快照只載入
  網址變了的地形切塊、模組類型和地基延伸；模組矩陣、標記和違規標示每次重算；不再被引用的
  glb 會釋放。換地圖時先清掉舊地圖。找不到模組類型（或 glb 載入失敗）的模組畫成紅色半透明
  方塊，不會整個消失。違規：紅色玻璃方塊和紅框包住相關物件，`location` 插上編號的測量旗，
  遠的旗子會縮小。標題列可以切換地圖，載入中顯示進度。
  驗證：`map-view.test.ts` 對 mock 伺服器的真 glb 測每一種資料、點選、只重新載入變動的部分、
  釋放不用的 glb、換地圖；瀏覽器實測 mock、`pnpm e2e` 的村莊（貼圖、轉 15/30 度的房子、山、
  道路），以及 1000 × 1000 公尺、1,024 個地形切塊、400 棟房子（3,200 個模組）、103 個違規的
  地圖：伺服器建好之後 9.4 秒載完 1,090 個 glb；看整張地圖時每個畫面中位數 8.7 ms、
  90% 在 12 ms 內（`gl.finish()` 計時，含陰影，2,311 次 draw call、400 萬個三角形）。
- **W2**：鏡頭是遊戲式的狀態（看著的地面點、方位角、俯角、距離）。右鍵拖曳轉動（地圖跟著游標走）、
  中鍵拖曳平移（抓住的地面點留在游標下）、WASD／方向鍵平移（速度跟距離成正比）、滾輪往游標縮放
  （游標下的點不動）、F 平滑飛到選取的東西（沒有選取就看整張地圖；系統設定減少動態時直接跳過去）。
  看的點不能離開地圖超過地圖邊長的 10%（至少 10 公尺），距離和俯角有上下限，看的點會貼著地形高度。
  滑過時顯示名牌（種類、名稱、所屬結構、違規數），並用細的粉線藍框標出「現在點下去會選到什麼」。
  點選：第一次選整個結構，再點同一個結構裡的模組就只選那個模組；標記直接選；點空地或 Esc 取消。
  底部的動作列顯示選取的東西和能用的按鍵，沒有選取時顯示怎麼看地圖。
  驗證：`overview-controls.test.ts` 測轉動方向和上下限、平移時抓住的點不動、WASD 方向、縮放時游標下的點不動、
  不會飛出地圖、平滑對焦；`selection.test.ts` 測點選規則、Agent 刪掉選取的東西時清掉選取、名牌與按鍵提示；
  `editor-browser.test.ts` 用 Vite 建置後由 mock 伺服器提供、在 headless Edge 裡用真的滑鼠和鍵盤測：
  名牌、結構→模組選取、標記選取、點空地取消、Esc、F 對焦、右鍵轉動、中鍵平移、滾輪縮放、WASD，且沒有頁面錯誤。

## 自行決定的事

- 打包後的 JS/CSS 放在 `dist/static/`，因為 `/assets/` 是後端產生 glb 的網址；
  後端遇到 `/assets/` 找不到就回 404，不會落到前端靜態檔。
- 只用系統字型：標題與標籤用 Bahnschrift（Windows 內建的 DIN 字體）、內文用
  Segoe UI／系統字型、數字與檔名用 Cascadia Mono／Consolas，中文退回微軟正黑體或蘋方。
- 視覺方向「測量員的現場標籤」：墨綠黑與粉筆白的標籤面板，粉線藍（木工彈線的藍色粉）
  只用在選取和吸附，旗紅只用在違規，琥珀色用在警告。
- 地圖可以用網址 `?map=<id>` 指定；沒有指定或不存在時開第一張。
- 左鍵在空地上拖曳也會平移地圖（像網頁地圖），方便沒有中鍵的觸控板；在物件上拖曳留給 W3 的移動。
- 太陽方位角：從上往下看、從北方順時針量（0 度北方 −Z、90 度東方 +X），已寫進 protocol.md
  第 2 節並通知後端。點標記 `rotation` 為 0 時面向南方 +Z（glTF 的前方，也和 Minecraft 的
  yaw 0 相同），一併寫進 protocol.md。
- 違規的物件用「建造遊戲放不下去」的語彙標示：紅色半透明方塊加紅框，而不是只把顏色變紅
  （有貼圖的模組乘上紅色會變成褐色，看不出來）。
- 地形材質的 metalness 在前端強制為 0（後端已在 `backend` 分支 64be461 修正地形 glb；
  合併後這段可以拿掉）。

## 需要後端配合

- 地形切塊 glb 的材質沒有設定 `metallicFactor`（glTF 預設 1），地形變成金屬、陰影全黑：
  已通知「項目後端修正」，已在 `backend` 分支 64be461 修好，等合併。
- 太陽方位角和點標記朝向的定義寫進 protocol.md 第 2 節：已通知後端讓 `docs/map-format.md`
  一致。

## 需要人處理

（目前沒有）

## 已知問題

（目前沒有）
