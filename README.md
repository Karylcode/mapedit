# mapedit

An agent-first 3D game map editor. AI coding agents (Claude Code, Codex) build maps by editing text files, humans make quick fixes in the browser, and maps export to Unity, Unreal, Godot and Blender.

主要給 Agent 用、其次給人用的 3D 遊戲地圖編輯器。Agent（Claude Code、Codex）直接改地圖檔和建模，編輯器負責算出精確位置，並擋下穿模、浮空等違規；人在瀏覽器裡用像玩 Minecraft 一樣的操作做簡單修正；成果匯出到 Unity、Unreal、Godot、Blender。

> 狀態：設計完成，尚未開始實作。

## 文件

- [設計文件](docs/design.md)
- [用語表](CONTEXT.md)
- [決策紀錄](docs/adr/)
- [前後端介面契約](docs/protocol.md)
- [後端實作說明（給 Codex）](docs/handoff/codex-backend.md)

## 授權

[MIT](LICENSE)
