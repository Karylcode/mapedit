# 前後端介面契約

> 後端（Codex）和前端（Claude）之間唯一的約定。兩邊都照這份文件實作，`packages/protocol` 的 TypeScript 型別必須和這裡一致。
>
> 要改契約時，先改這份文件，再改型別。只是新增欄位或訊息，不用改版本號；會讓舊程式壞掉的修改，`protocolVersion` 要加 1。

## 1. 程序與網址

- `mapedit dev` 啟動一個本機伺服器，預設網址 `http://127.0.0.1:4790`（可以用 `--port` 改）。
- 只綁定 127.0.0.1。HTTP 和 WebSocket 都要檢查 `Host`（只接受 `127.0.0.1` 或 `localhost` 加上這個連接埠）和 `Origin`（必須同源，或沒有 `Origin`），防止其他網站透過瀏覽器連進來。
- HTTP 回應另帶 `X-Mapedit-Instance`（每次啟動的新識別碼）、`X-Mapedit-Project`（專案實體路徑的 SHA-256）與 `X-Mapedit-Pid`。CLI 使用這些標頭驗證本機連線紀錄，避免連到同一連接埠上後來啟動的其他專案；前端不需要使用。
- 正式版：後端直接提供 `packages/web/dist` 的靜態檔；`/render` 這類前端路徑一律回 `index.html`。
- 開發時：前端用 Vite 開發伺服器，把 `/api`、`/assets`、`/ws` 轉給後端。
- `mapedit dev --mock`：後端用一張固定的測試場景回應所有請求，拖動和刪除只改記憶體，讓前端可以獨立開發和測試。
  - 測試場景要涵蓋快照裡的每一種資料：每一種違規（重疊和沒有支撐要帶 `location` 和 `suggestion`）、地基延伸、點標記和方形標記、檔案錯誤。
  - mock 另外提供 `POST /api/mock/trigger`，body 是 `{ "notice": NoticeCode }`。後端會模擬對應的情境並送出那個提示；`file_error` 會同時在下一份快照加上一筆 `fileErrors`。這個網址只有 mock 模式才有。

| 路徑 | 方法 | 提供者 | 用途 |
|---|---|---|---|
| `/` | GET | 前端 | 編輯器網頁 |
| `/render` | GET | 前端 | 截圖用頁面（見第 6 節） |
| `/ws` | WebSocket | 後端 | 即時通道（見第 4 節） |
| `/api/project` | GET、HEAD | 後端 | GET 回傳 `ProjectInfo`；HEAD 只回本機程序識別 headers，供 CLI 發現伺服器 |
| `/api/scene?map=<mapId>` | GET | 後端 | 回傳目前的 `SceneSnapshot`，給截圖頁面和除錯用 |
| `/assets/...` | GET | 後端 | 產生出來的 glb。網址由 `SceneSnapshot` 提供，前端不要自己拼 |
| `/mcp` | POST、GET | 後端 | MCP（Streamable HTTP），前端不使用 |
| `/api/mock/trigger` | POST | 後端（只有 mock） | 模擬提示情境，給前端測試用 |

## 2. 共同約定

- 長度一律用公尺。Y 軸朝上，+X 是東，-Z 是北，右手座標系（和 glTF、three.js 相同）。
- 角度一律用度，繞 +Y 軸旋轉，從上往下看逆時針為正。
- 矩陣是 16 個數字、column-major，可以直接交給 three.js 的 `Matrix4.fromArray()`。
- 所有 glb 都用公尺、Y 軸朝上，材質和貼圖內嵌在檔案裡。
- 物件參照（`ObjectRef`）是字串：
  - 結構：`structure:<structureId>`
  - 結構裡的模組：`module:<structureId>/<instanceId>`
  - 標記：`marker:<markerId>`

## 3. 場景快照

地圖每次有變動，後端就把整張地圖編譯後的結果送給前端。第一版一律送完整快照，之後有需要再改成只送差異。

```ts
type Vec3 = [number, number, number];
type Mat4 = number[]; // 16 個數字，column-major
type ObjectRef = string;

interface SceneSnapshot {
  protocolVersion: 1;
  revision: number;              // 地圖每變動一次就加 1
  map: MapInfo;
  terrain: TerrainView;
  moduleTypes: ModuleTypeView[];
  structures: StructureView[];
  generated: GeneratedMeshView[];
  markers: MarkerView[];
  violations: ViolationView[];
  fileErrors: FileErrorView[];
}

interface MapInfo {
  id: string;
  name: string;
  size: { x: number; z: number };              // 公尺；地圖範圍是 x 從 0 到 size.x、z 從 0 到 size.z
  sun: { azimuth: number; elevation: number }; // 度
}

interface TerrainView {
  revision: number;
  chunks: { cx: number; cz: number; url: string }[]; // 地形切塊的 glb，地圖座標
}

interface ModuleTypeView {
  id: string;
  name: string;
  url: string;          // 模組本身的 glb，模組自己的座標系
  size: Vec3;
  isFoundation: boolean;
  canFloat: boolean;
}

interface StructureView {
  ref: ObjectRef;       // structure:<id>
  name?: string;
  file: string;         // 專案內的相對路徑，用 / 分隔
  transform: Mat4;      // 結構座標 → 地圖座標
  instances: InstanceView[];
}

interface InstanceView {
  ref: ObjectRef;       // module:<structureId>/<instanceId>
  moduleType: string;
  transform: Mat4;      // 模組座標 → 地圖座標（已經乘上結構的轉換）
}

interface GeneratedMeshView {
  owner: ObjectRef;     // 屬於哪個模組，例如地基往下延伸的部分
  url: string;          // glb，地圖座標
}

interface MarkerView {
  ref: ObjectRef;       // marker:<id>
  type: string;         // 'spawn'、'trigger'，或專案自訂的類型
  shape:
    | { kind: 'point'; position: Vec3; rotation: number }
    | { kind: 'box'; center: Vec3; size: Vec3; rotation: number };
  properties: Record<string, unknown>;
}

type ViolationKind =
  | 'overlap'
  | 'incompatible_socket'
  | 'unsupported'
  | 'off_grid'
  | 'bad_rotation'
  | 'out_of_bounds'
  | 'missing_reference';

interface ViolationView {
  id: string;                      // 同一個違規在不同 revision 之間保持相同，例如由 kind 和排序後的 refs 組成
  kind: ViolationKind;
  message: string;                 // 英文，和給 Agent 的訊息相同
  params: Record<string, unknown>; // 前端用 kind 加 params 翻成介面語言；來自檔案的違規會帶 file 和 line
  refs: ObjectRef[];
  location?: Vec3;
  suggestion?: string;             // 英文
}

interface FileErrorView {
  file: string;
  line?: number;
  message: string;                 // 英文
}

interface ProjectInfo {
  name: string;
  maps: { id: string; name: string }[];
}
```

## 4. WebSocket 訊息

連線網址是 `ws://127.0.0.1:4790/ws`，訊息一律是 JSON。

### 前端 → 後端

```ts
type ClientMessage =
  | { type: 'hello'; protocolVersion: 1; client: 'editor' | 'render' }
  | { type: 'openMap'; mapId: string }
  | { type: 'previewEdit'; requestId: number; edit: Edit }
  | { type: 'applyEdit'; requestId: number; edit: Edit; baseRevision: number }
  | { type: 'undo'; requestId: number }
  | { type: 'redo'; requestId: number };

type Edit =
  // 移動整個結構或標記。position 是滑鼠在地圖上指到的點（還沒對齊），
  // 對齊格子和決定高度都由後端負責。rotation 是想要的角度（度）。
  | { kind: 'move'; ref: ObjectRef; position: Vec3; rotation: number }
  // 刪除結構、結構裡的單一模組，或標記。
  | { kind: 'delete'; ref: ObjectRef };
```

### 後端 → 前端

```ts
type ServerMessage =
  | { type: 'welcome'; protocolVersion: 1; project: ProjectInfo }
  | { type: 'scene'; scene: SceneSnapshot }
  | { type: 'previewResult'; requestId: number; ok: boolean; transform?: Mat4; violations: ViolationView[] }
  | { type: 'editResult'; requestId: number; ok: boolean; reason?: string }
  | { type: 'history'; entries: HistoryEntry[]; cursor: number }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; code: NoticeCode; message: string; refs?: ObjectRef[] };

interface HistoryEntry {
  id: number;
  author: 'human' | 'agent';
  time: string;    // ISO 8601
  summary: string; // 英文；前端可以只顯示作者和時間
  files: string[];
}

type NoticeCode =
  | 'agent_changed'           // Agent 改了檔案，refs 是受影響的物件
  | 'overwritten_by_agent'    // 人剛做的修改，被 Agent 後來的修改蓋掉了
  | 'agent_change_overridden' // 人放下時，蓋掉了 Agent 在拖動期間做的修改
  | 'edit_rejected'           // 人的修改被拒絕，例如會造成違規
  | 'file_error';             // 有檔案無法讀取

// notice 的 message 是英文；前端依 code 翻成介面語言。
```

### 流程

1. 連線後，前端送 `hello`，後端回 `welcome`。
2. 前端送 `openMap`，後端回 `scene` 和 `history`。之後只要地圖有變動（Agent 改檔、人的修改、復原或重做），後端就再送一次 `scene`。
3. **拖動中**：
   - 前端每個畫面最多送一個 `previewEdit`。還沒收到回覆前，只保留最新的一個，舊的直接丟掉。
   - 後端回 `previewResult`：`transform` 是對齊後的位置，`violations` 是放在那裡會造成的違規。`ok` 為 false 時，前端把預覽畫成紅色。
   - 預覽不會修改任何檔案。
4. **放下**：前端送 `applyEdit`，後端重新對齊並檢查：
   - 如果被移動的東西放在那裡會有違規，就拒絕，回 `editResult { ok: false }`，前端把東西彈回原位。
   - 否則寫回檔案（保留註解），回 `editResult { ok: true }`，接著廣播新的 `scene` 和 `history`。
   - 刪除一律允許。刪除後如果有別的東西失去支撐，會以違規的形式顯示。
5. **同時修改**：以後到的修改為準，並提示人。
   - 人放下時，如果同一個物件在 `baseRevision` 之後被 Agent 改過，套用人的修改，並送 `notice { code: 'agent_change_overridden' }`。
   - Agent 改檔時，如果蓋掉了人最近對同一個物件的修改，送 `notice { code: 'overwritten_by_agent' }`。
6. **復原、重做**：`undo`、`redo` 作用在整個專案的修改紀錄上，人和 Agent 的修改都算。後端回 `editResult`，接著送新的 `scene` 和 `history`。
7. **參照失效**：前端手上的 ref 可能因為 Agent 剛改了檔案而失效。`previewEdit`、`applyEdit` 的 `edit.ref` 格式錯誤（不符合第 2 節的 `ObjectRef` 格式），或指向不存在的物件時，後端**不斷線**：
   - `previewEdit` 回 `previewResult { ok: false }`，`violations` 只有一筆 `missing_reference`，它的 `refs` 是收到的 ref。
   - `applyEdit` 回 `editResult { ok: false, reason }`，並送 `notice { code: 'edit_rejected' }`；檔案和修改紀錄都不變。
8. **斷線**：只有訊息本身的結構不合法時，後端才以 1008 關閉連線，例如不是 JSON、`type` 不認得、欄位型別不對（`ref` 不是字串、`position` 不是三個有限數字、`requestId` 不是整數），或是在 `hello` 之前送其他訊息、在 `openMap` 之前送修改。

## 5. 前端的責任範圍（給後端參考）

- 畫出快照：地形切塊、模組（同類型用 instancing）、地基往下延伸的部分、標記圖示，以及違規的紅色標示和清單。
- 點選、滑鼠移過時的提示、拖動預覽、按 R 每次轉 15 度、按 Delete 刪除、Ctrl+Z 和 Ctrl+Y。
- 顯示 notice，並依 code 翻譯。
- 介面語言：繁體中文、英文。
- 前端不做任何規則判斷。對齊、高度和違規，一律以後端的回覆為準。

## 6. 截圖頁面 `/render`

後端用無頭瀏覽器打開 `/render?map=<mapId>`。

- 頁面載入場景（WebSocket `hello` 時帶 `client: 'render'`，或用 `GET /api/scene`），準備好之後設定 `window.mapeditRenderReady = true`。
- 頁面上只有 3D 畫面，不顯示任何介面元素。
- 頁面提供下面這個函式：

```ts
interface RenderSpec {
  views: Array<'top' | 'ne' | 'nw' | 'se' | 'sw'>;
  // top：從正上方往下看，北方朝上
  // ne：相機在東北方的上空，往中心看；nw、se、sw 依此類推
  focus?: { center: Vec3; radius: number }; // 不給就是整張地圖
  tileSize: number;                          // 每個角度的邊長（像素），例如 512
  highlight?: ObjectRef[];                   // 要特別框出來的物件
  showViolations?: boolean;                  // 是否用紅色標出違規
  minRevision?: number;                      // 等場景的 revision 至少到這個值才畫
}

// 把所有角度拼成一張圖，每一格左上角標出角度名稱，top 那一格畫出指北標示。
// 回傳 PNG 的 data URL。
declare function mapeditRender(spec: RenderSpec): Promise<string>; // 掛在 window 上
```

- 後端等到 `mapeditRenderReady` 為 true，才呼叫 `mapeditRender`，再把結果轉成 PNG，用 MCP 的圖片格式回給 Agent。
