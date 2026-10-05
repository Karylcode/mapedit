# Mapedit for Unity 6

This UPM package uses the UnityGLTF import plugin to turn `extras.mapedit` into static mesh colliders, trigger boxes and gameplay prefabs. It does not depend on a running Mapedit server.

1. In Package Manager, **Add package from git URL**: `https://github.com/KhronosGroup/UnityGLTF.git#release/2.21.0`.
2. **Add package from disk** and select this directory's `package.json`. Keep this folder in a stable location, or copy it under the game's `Packages/com.mapedit.unity`.
3. Create **Assets → Create → Mapedit → Marker Mapping**. Add an entry with marker type `spawn` and the player's prefab. Add other marker type mappings as needed.
4. With exactly one mapping asset it is selected automatically. With multiple mappings, assign the desired asset in **Project Settings → UnityGLTF → Mapedit game metadata** (UnityGLTF exposes import plugin settings).
5. Export a checked map into the game's `Assets/Maps`: `mapedit export --map village --out <game>/Assets/Maps`. Unity imports the GLB. Drag its imported prefab into a scene and press Play using your game's controller.

All module and terrain meshes get non-convex `MeshCollider` components. Trigger markers get a `BoxCollider` with `isTrigger=true`. Prefab replacement keeps an empty marker wrapper so its `MapeditMarker` component, stable reference, trigger collider and JSON game properties remain available. The mapped prefab is its child at local position/rotation zero and scale one. UnityGLTF handles the right-handed glTF to Unity coordinate conversion; this plugin never applies another conversion.

No matching prefab is an intentional no-op: the marker and its metadata remain available for game code. Mapping and prefab assets are registered as import dependencies, so editing them causes reimport. Re-exporting a map recreates the imported hierarchy; put game overrides in an outer prefab instead of editing the imported asset directly.

## Automated verification

Run `scripts/test-unity.ps1 -GlbPath <exported-village.glb>` from the repository. It creates an isolated project under `.cache/unity/project` if necessary, installs UnityGLTF and this local package, and runs `Mapedit.Editor.MapeditImportVerification.Run` in Unity 6 batchmode. The GLB must contain modules, terrain, one spawn and one trigger. Success writes `mapedit-verification.json` and `MAPEDIT_UNITY_VERIFIED` in the log. The test uses a temporary player prefab and verifies real imported mesh colliders, a trigger collider, and spawn prefab mapping.

UnityGLTF API pinned to [2.21.0's import callbacks](https://github.com/KhronosGroup/UnityGLTF/blob/release/2.21.0/Runtime/Scripts/Plugins/Core/GltfImportPlugin.cs) and [plugin registration](https://github.com/KhronosGroup/UnityGLTF/blob/release/2.21.0/Runtime/Scripts/GLTFSettings.cs). The importer reads `Node.Extras` as a Newtonsoft `JToken`.
