[English](map-files.md) | **繁體中文** · [文件索引](README.zh-TW.md)

# 地圖檔

地圖是專案資料夾裡的一組文字檔，這些檔案就是地圖本身。Agent 像改程式碼一樣改它們；編輯器讀檔、
算出每個東西的位置，並回報違規。這一頁是入門說明，完整規格見英文的[地圖檔格式第 1 版](map-format.md)；
建模見英文的[建模 API 與隔離執行](model-api.md)。

## 單位與格子

- 一律用公尺。Y 軸朝上；+X 是東，-Z 是北（和 Minecraft 相同）。
- 位置、高度、模組尺寸和插槽位置都必須是 0.5 公尺的倍數。檔案裡直接寫公尺（例如 `12.5`），不寫格數。
- 正的旋轉角度，從上往下看是逆時針。結構每次轉 15 度；結構裡的模組每次轉 90 度。
- 地圖的長和寬各在 100 到 1000 公尺之間，而且是整數公尺。
- 每個結構有自己的格子，結構轉了角度，格子也跟著轉，所以轉過的結構裡，模組可以不在地圖的 0.5 公尺格子上。

## 專案結構

```text
my-maps/                         專案
├── project.yaml                 名稱、渲染風格、自訂插槽類型和標記類型
├── modules/
│   └── wall/                    一個模組一個資料夾
│       ├── module.yaml          尺寸、插槽、是否為地基、可不可以浮空
│       └── model.ts             用程式寫的模組外型
├── maps/
│   └── village/
│       ├── map.yaml             id、名稱、大小、太陽
│       ├── structures/          結構檔，每個檔可以放一個或多個結構
│       │   └── house.yaml
│       ├── markers.yaml         出生點、觸發區（可以沒有）
│       └── terrain/
│           ├── height.png
│           └── surface.png
├── AGENTS.md                    給 Agent 的說明書（Codex 會讀）
└── .claude/skills/mapedit/      同一份說明書，做成 Claude Code skill
```

id 以英文字母開頭，只能有英文字母、數字、`_` 或 `-`。模組 id 在整個專案裡不能重複；結構和標記的 id
在同一張地圖裡不能重複；模組實例的 id 在同一個結構裡不能重複。模組和地圖沒寫 id 時，用資料夾名稱。

## project.yaml

```yaml
name: My game
style: toon
socketTypes:
  gate:
    compatibleWith: [gate, wall]
markerTypes:
  checkpoint:
    shape: point
```

- `style` 決定編輯器和截圖怎麼上色：`standard`（預設）或 `toon`（卡通渲染加上墨線輪廓）。不影響匯出的檔案。
- 內建的插槽類型是 `foundation`、`floor`、`wall`、`roof` 和 `stair`。可以相接的組合：foundation 接
  foundation／wall／floor／stair；floor 接 floor／wall／stair；wall 接 wall／roof；roof 接 roof；stair 接 stair。
  相容是雙向的：任一邊的 `compatibleWith` 有寫就可以接。
- 內建的標記類型是 `spawn`（點）和 `trigger`（方塊）。
- 第 1 版只有內建材質：`wood_planks`、`dark_wood`、`stone_brick`、`plaster`、`roof_tiles`、`thatch`、`grass`、
  `dirt`、`gravel`、`metal`、`white`、`red`、`blue`。

## 模組

模組是可以重複使用的建造單位，尺寸固定。模組不能縮放；需要不同大小時，就做成另一個模組。

```yaml
id: stone_foundation
size: [2, 0.5, 2] # x、y、z；模型占 [0, size] 的範圍
isFoundation: true
foundationStyle: skirt # 或 pillars
material: stone_brick
sockets:
  - { id: east, type: foundation, position: [2, 0.5, 1], direction: east }
  - { id: top, type: floor, position: [1, 0.5, 1], direction: up }
```

- `direction` 是 `north`、`east`、`south`、`west`、`up` 或 `down`。每個插槽只能接一個東西。
- `isFoundation` 的模組遇到不平的地面，會往下延伸到地面：`skirt` 照外型往下延伸，`pillars` 用四根柱子。
  地形本身不會被改動。
- `canFloat: true` 讓模組不需要支撐，而且它也能撐住放在上面的東西。`check` 和 `overview` 一律列出這些模組，
  方便發現被濫用的地方。
- `terrainFollow: true` 讓直接擺放的模組貼合它中心下方的地形，前提是結構高度設為自動。

`model.ts` 用 `box`、`cylinder`、`extrude`、`revolve`、`union`、`difference`、`intersection`、`translate`、
`rotate` 和 `material` 寫出外型，形狀不能超出宣告的尺寸。貼圖照真實尺寸自動貼上，不用處理 UV。
程式在隔離的 QuickJS 沙盒裡執行，不能碰檔案、網路或 Node.js。

```ts
import { box, difference, material, translate } from '@mapedit/model';

// module.yaml 宣告 size: [2, 3, 0.5]。
const wall = box([2, 3, 0.5]);
const opening = translate(box([1, 2.5, 1]), [0.5, 0, -0.25]);
export default material('stone_brick', difference(wall, opening));
```

## 地圖

```yaml
id: village
name: River village
size: { x: 100, z: 100 }
sun: { azimuth: 135, elevation: 45 }
```

地圖範圍是 x = 0…size.x、z = 0…size.z。`sun.azimuth` 是方位角（0 北、90 東、180 南）；`elevation` 是離地平線的角度。

## 結構

結構是一群用插槽接在一起、一起移動的模組。`structures/` 裡的每個檔案都有一個 `structures` 清單：
大的結構自己一個檔，零散的小東西可以放在同一個檔。

```yaml
# 東邊的瞭望塔
structures:
  - id: watchtower_east
    position: [20, 30] # x、z
    rotation: 30 # 15 的倍數
    modules:
      - { id: base, module: stone_foundation, at: [0, 0, 0] }
      - { id: floor, module: wood_floor, attach: { socket: bottom, to: base.top } }
```

- `height` 預設是 `auto`：結構貼合它原點位置的地形。寫數字就固定高度，例如浮空島。
- 模組要嘛寫 `at: [x, y, z]`（轉向後外框的最小角）加上選用的 `rotation`，要嘛只寫 `attach`。
  用插槽接上去的模組，位置由編輯器算。
- 整個結構也能用 `attach: { socket: base.west, to: other/base.east }` 接到另一個結構上，這時不寫 `position`、
  `height` 和 `rotation`。兩者會合併：移動或刪除根結構，會連同接上的結構一起移動或刪除。
- 編輯器把修改寫回檔案時，會保留註解。

## 標記

`markers.yaml` 放對遊戲有意義的點和方塊，它們沒有實體外型。

```yaml
markers:
  - id: player_spawn
    type: spawn
    shape: { kind: point, position: [10, 0, 10], rotation: 0 }
    properties: { team: blue }
  - id: village_gate
    type: trigger
    shape: { kind: box, center: [15, 1, 10], size: [2, 2, 4], rotation: 15 }
    properties: { event: enter_village }
```

旋轉為 0 時，點標記朝南（+Z）；旋轉 90 朝東。方塊用中心定位，所以地面高度 0、高 2 公尺的方塊要寫
`center.y: 1`。`properties` 可以是任何 JSON 相容的資料，匯出時原樣保留。

## 地形

地形由 1 × 1 公尺的地塊組成。每個地塊有一個高度（0.5 公尺一階）和一種地表：`grass`、`dirt`、`gravel`、
`stone` 或 `sand`。地形存成 `map.yaml` 旁邊的兩張 PNG，一個像素是一個地塊：

- `terrain/height.png`：16 位元灰階，`sample = 公尺 * 2 + 32768`；
- `terrain/surface.png`：8 位元灰階，0 草地、1 泥土、2 碎石、3 石頭、4 沙地。

兩張都沒有時，地圖是高度 0 的平坦草地；只有其中一張是檔案錯誤。1000 公尺的地圖有 100 萬個地塊，
不要手寫地形，請用 MCP 的 `terrain` 工具（`raise`、`lower`、`flatten`、`set_height`、`mountain`、`paint`，
範圍可以是圓形、矩形或路徑）。編輯器會把平緩的高低差修成斜坡，超過 1 公尺的落差做成崖壁。
樹、石頭是放在地形上的模組。

## 違規

檔案可以暫時有違規，就像程式寫到一半會有編譯錯誤；編輯器會立刻標出來。只要有違規，地圖就不能匯出。

| 類型                  | 意思                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `overlap`             | 兩個模組的實際形狀互相重疊。只碰到表面不算；地基和貼地的模組可以埋進地形   |
| `unsupported`         | 模組底下沒有一路接到地面的支撐，而且沒有標 `canFloat`                      |
| `incompatible_socket` | 插槽類型或方向不相容，或插槽已經被用掉                                     |
| `off_grid`            | 位置或高度不是 0.5 公尺的倍數                                              |
| `bad_rotation`        | 角度不是 15 度（結構、標記）或 90 度（模組）的倍數                         |
| `out_of_bounds`       | 有東西超出地圖範圍                                                         |
| `missing_reference`   | 引用了不存在的模組、插槽、結構、材質或類型，或互相接成一個圈               |

檔案錯誤另外列出：YAML 寫錯、未知的欄位、重複的 id，或 `model.ts` 失敗，都會附上檔名和行號。
違規會附上修正建議，例如往哪個方向移多遠就不會重疊。套用建議後，再執行一次 `check`。
