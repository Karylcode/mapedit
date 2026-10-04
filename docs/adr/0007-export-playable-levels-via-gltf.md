# 匯出成可以直接玩的關卡：glTF 加上各引擎的匯入腳本

匯出的目標是可以直接玩的關卡：模型、層級、碰撞體，加上出生點、巡邏路線、觸發區這類標記。格式統一用 glTF，遊戲資料放在 glTF 的自訂欄位（extras）裡，四個引擎都收得到；再為每個引擎附一個小匯入腳本，把這些資料變成碰撞體、prefab 等遊戲物件。匯入腳本先做 Unity，其他引擎依序補上；補好之前，它們也收得到模型、層級和標記資料，只是要手動處理。沒有選 FBX，因為它是封閉格式，在網頁端很難寫好；也沒有選 OpenUSD，因為 Unity 和 Godot 目前都沒有可靠的支援。

## Consequences

- Unity 沒有內建 glTF 匯入，要先裝 glTFast 或 UnityGLTF。UnityGLTF 的匯入外掛在 Editor 裡就讀得到 extras。
- Godot 4.4 起會把 extras 放進節點的 `meta["extras"]`；Blender 會把 extras 匯入成自訂屬性。
- Unreal 5.5 起會匯入 extras，但官方沒寫清楚怎麼讀，做 Unreal 匯入腳本前要先實測。
