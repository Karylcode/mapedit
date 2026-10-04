# 指令同時提供 MCP 和 CLI

Agent 用的指令（檢查違規、查詢、生成地形、截圖等）同時提供 MCP 和 CLI，兩者共用同一套核心。只做 CLI 不夠：截圖只能存成圖片檔，而 Codex 不一定肯自己打開圖片檔（[openai/codex#12439](https://github.com/openai/codex/issues/12439)），這樣 Codex 就看不到成果；MCP 則能把截圖直接傳給模型。「檢查」「匯出」另外做成 CLI，因為它們就像編譯指令，可以放進 git hook 和 GitHub 的自動檢查。

## Consequences

- MCP 回傳截圖時不能同時帶 `structuredContent`，否則 Codex 會把圖片丟掉（[openai/codex#10334](https://github.com/openai/codex/issues/10334)）。
