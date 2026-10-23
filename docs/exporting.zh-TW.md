[English](exporting.md) | **繁體中文** · [文件索引](README.zh-TW.md)

# 匯出

地圖匯出成 glTF 二進位檔（`.glb`）。碰撞體、標記這類遊戲資料放在 glTF 的 `extras` 裡，再由引擎端的匯入
腳本變成遊戲物件。Mapedit 目前附有 Unity 6 的匯入套件。完整欄位見英文的[GLB 匯出格式第 1 版](export-format.md)。

## 匯出地圖

在專案資料夾裡執行（`mapedit` 指的是 `node <repo 路徑>/packages/cli/dist/index.js`，見[使用方式](usage.zh-TW.md)）：

```sh
mapedit export --out ./export              # 全部地圖
mapedit export --map village --out ./export
```

- `export` 會先檢查所有選到的地圖。只要有一張有違規、檔案錯誤，或有模組建不出形狀，就什麼都不寫，
  列出有問題的地圖，原本的輸出檔案也維持不變。
- 每張地圖變成一個獨立的 `<地圖 id>.glb`，貼圖都包在裡面，不需要其他檔案。
- `--out` 是相對於專案資料夾的路徑，可以直接指到 Unity 專案裡，例如 `<遊戲>/Assets/Maps`，Unity 會自動匯入。

Agent 也可以改用 MCP 的 `export` 工具，帶 `map` 和 `out`。它一次寫出一張地圖，有違規時同樣會拒絕。

## GLB 裡有什麼

```text
Map
├── Terrain
│   └── terrain_<cx>_<cz>            地形網格，每塊 32 公尺
├── <結構 id>
│   └── <實例 id>                    模組網格，位置相對於所屬結構
├── <模組 ref>/foundation            自動產生的地基網格
└── Markers
    └── <標記 id>                    點或方塊
```

- 單位是公尺，+Y 朝上、+X 是東、-Z 是北。匯入腳本只做一次各引擎的座標轉換。
- 每個節點都有 `extras.mapedit`，裡面有 `kind`（`map`、`terrainGroup`、`terrain`、`structure`、`module`、
  `foundation`、`marker`），以及指回原始物件的固定 `ref`。
- 地形塊、模組和地基帶有 `collider: {type: "mesh"}`：靜態、非凸面的網格碰撞體，門洞和窗洞都會保留。
  方塊標記帶有 `isTrigger: true` 的方塊碰撞體。不會匯出剛體或遊戲控制器。
- 標記的位置和旋轉就是節點的 transform；`properties` 以 JSON 原樣保留。
- 相同類型的模組共用同一個網格。根節點的 `version`（目前是 1）只有在既有欄位的意思改變時才會變，
  所以讀取端應該忽略看不懂的欄位。

## Unity 6

[`integrations/unity`](../integrations/unity/README.md) 裡的套件（`com.mapedit.unity`）使用 UnityGLTF 的匯入外掛，
不需要 Mapedit 伺服器在執行。

1. 在 Package Manager 選 **Add package from git URL**：
   `https://github.com/KhronosGroup/UnityGLTF.git#release/2.21.0`。
2. 選 **Add package from disk**，挑 `integrations/unity/package.json`。資料夾請放在固定的位置，或複製到遊戲的
   `Packages/com.mapedit.unity`。
3. **Assets → Create → Mapedit → Marker Mapping**。新增一筆標記類型 `spawn`，配上玩家的 prefab；
   其他標記類型視需要新增。
4. 只有一個對應檔時會自動使用。有好幾個時，到 **Project Settings → UnityGLTF → Mapedit game metadata** 選一個。
5. 把檢查過的地圖匯出到遊戲裡：`mapedit export --map village --out <遊戲>/Assets/Maps`。把匯入的 prefab 拖進
   場景，用你遊戲的控制器按 Play。

匯入時會做的事：

- 模組和地形的網格加上非凸面的 `MeshCollider`；觸發區標記加上 `isTrigger = true` 的 `BoxCollider`。
- 對應到的 prefab 會成為標記空物件的子物件，區域位置和旋轉都是零、縮放是一。空物件保留 `MapeditMarker`
  元件，裡面有 ref、類型和 JSON 屬性。
- 沒有對應 prefab 的標記類型會保留成標記，遊戲程式仍然可以使用，不會被換成不相干的物件。
- 修改對應檔或 prefab 會觸發重新匯入。重新匯出會重建匯入的層級，所以自己的修改請放在外層 prefab，
  不要直接改匯入的素材。

### 驗證 Unity 匯入

在 Windows 上（PowerShell 5.1 或 7）：

```powershell
scripts/test-unity.ps1 -GlbPath <匯出的 village.glb>
```

它會在 `.cache/unity/project` 建立測試專案、安裝 UnityGLTF 和本機套件，再用 Unity 6 的 batchmode 檢查匯入。
GLB 必須包含模組、地形、一個出生點和一個觸發區；`pnpm e2e` 產生的檔案就符合。檢查會用暫時的玩家 prefab，
確認真的有網格碰撞體、觸發碰撞體和出生點 prefab 對應。成功時會寫出 `mapedit-verification.json`。
腳本預設 Unity 6000.0.75f1 裝在 Unity Hub 的預設資料夾，不是的話請加 `-UnityPath`。`.cache` 裡的東西不提交。

## 其他引擎

Unreal、Godot、Blender 的匯入腳本還沒有做，排在之後的版本。這些工具可以把 GLB 當成標準的 glTF 2.0 打開，
但 Mapedit 還沒有測過它們怎麼處理 `extras.mapedit`。依 [ADR 0007](adr/0007-export-playable-levels-via-gltf.md)
的設計調查：Godot 4.4 起會把 extras 放進節點的 meta，Blender 會匯入成自訂屬性，Unreal 5.5 起會匯入，
但讀取方式還要實測。
