# 技術選型：TypeScript、three.js、manifold-3d、YAML、MIT

瀏覽器介面、本機伺服器、CLI 和 MCP 全部用 TypeScript：前後端同一種語言，3D 與幾何函式庫都在這個生態系，Claude Code 和 Codex 也最熟悉，安裝只要一行 `npx`。3D 顯示用 three.js。程式生成的幾何核心用 manifold-3d，因為它的布林運算保證產生完整、不破的模型（Apache-2.0）。地圖的文字檔用 YAML，比 JSON 精簡又能寫註解，Agent 可以在檔案裡留筆記。開源授權用 MIT，和上述函式庫的授權相容。
