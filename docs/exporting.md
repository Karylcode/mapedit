**English** | [繁體中文](exporting.zh-TW.md) · [Documentation index](README.md)

# Exporting

Maps export as glTF binary files (`.glb`). Game data such as colliders and markers rides along in the
glTF `extras`, and an engine-side importer turns it into game objects. Mapedit ships an importer for
Unity 6. The full field list is in [Export format, version 1](export-format.md).

## Export a map

From inside the project folder (`mapedit` stands for `node <repository>/packages/cli/dist/index.js`; see
[Usage](usage.md)):

```sh
mapedit export --out ./export              # every map
mapedit export --map village --out ./export
```

- `export` checks every selected map first. If any has a violation, a file error or a module without
  geometry, it writes nothing, names the maps with problems, and leaves existing output files as they were.
- Each map becomes one self-contained `<map-id>.glb`, with textures embedded and no external files.
- `--out` is relative to the project folder. It may point into a Unity project, for example
  `<game>/Assets/Maps`; Unity then imports the file by itself.

Agents can call the MCP `export` tool instead, with `map` and `out`. It writes one map and refuses a map
with violations in the same way.

## What the GLB holds

```text
Map
├── Terrain
│   └── terrain_<cx>_<cz>            terrain mesh, 32 m chunks
├── <structure id>
│   └── <instance id>                module mesh, transform relative to the structure
├── <module ref>/foundation          generated foundation mesh
└── Markers
    └── <marker id>                  point or box
```

- Units are meters, +Y up, +X east, -Z north. Importers convert to their engine's axes exactly once.
- Each node carries `extras.mapedit` with a `kind` (`map`, `terrainGroup`, `terrain`, `structure`,
  `module`, `foundation`, `marker`) and a stable `ref` that points back to the source object.
- Terrain chunks, modules and foundations carry `collider: {type: "mesh"}`: static, non-convex mesh
  colliders that keep door and window openings. Box markers carry a box collider with `isTrigger: true`.
  No rigid bodies or game controllers are exported.
- A marker's position and rotation are the node transform; its `properties` are kept as JSON.
- Identical module types share one mesh. The root's `version` (now 1) only changes when existing meanings
  change, so consumers should ignore fields they do not know.

## Unity 6

The package in [`integrations/unity`](../integrations/unity/README.md) (`com.mapedit.unity`) uses the
UnityGLTF import plugin. It does not need the Mapedit server.

1. In Package Manager, **Add package from git URL**:
   `https://github.com/KhronosGroup/UnityGLTF.git#release/2.21.0`.
2. **Add package from disk** and pick `integrations/unity/package.json`. Keep the folder in a fixed place,
   or copy it to your game's `Packages/com.mapedit.unity`.
3. **Assets → Create → Mapedit → Marker Mapping**. Add an entry for marker type `spawn` with your player
   prefab, and others as needed.
4. With one mapping asset, it is used automatically. With several, pick one in **Project Settings →
   UnityGLTF → Mapedit game metadata**.
5. Export a checked map into the game: `mapedit export --map village --out <game>/Assets/Maps`. Drag the
   imported prefab into a scene and press Play with your game's controller.

What the importer does:

- Module and terrain meshes get non-convex `MeshCollider`s; trigger markers get a `BoxCollider` with
  `isTrigger = true`.
- A mapped prefab becomes a child of the marker's empty wrapper, at local position and rotation zero and
  scale one. The wrapper keeps a `MapeditMarker` component with the ref, the type and the JSON properties.
- A marker type with no mapping stays as a marker, so your game code can still use it. It is never
  replaced with an unrelated object.
- Editing a mapping or prefab triggers a reimport. Re-exporting rebuilds the imported hierarchy, so put
  your own changes in an outer prefab, not in the imported asset.

### Verify the Unity import

On Windows (PowerShell 5.1 or 7):

```powershell
scripts/test-unity.ps1 -GlbPath <exported-village.glb>
```

It creates a test project under `.cache/unity/project`, installs UnityGLTF and the local package, and runs
an import check in Unity 6 batchmode. The GLB must contain modules, terrain, one spawn and one trigger;
`pnpm e2e` makes a suitable one. The check uses a temporary player prefab and verifies real mesh colliders,
a trigger collider and the spawn prefab mapping. Success writes `mapedit-verification.json`. The script
expects Unity 6000.0.75f1 in the default Unity Hub folder; pass `-UnityPath` otherwise. Nothing under
`.cache` is committed.

## Other engines

There are no import scripts for Unreal, Godot or Blender yet; they are planned for later versions. These
tools can open the GLB as standard glTF 2.0, but Mapedit has not tested what they do with
`extras.mapedit`. The design research in [ADR 0007](adr/0007-export-playable-levels-via-gltf.md) expects
Godot 4.4 and later to keep extras as node metadata, Blender to import them as custom properties, and
Unreal 5.5 and later to import them in a way still to be tested.
