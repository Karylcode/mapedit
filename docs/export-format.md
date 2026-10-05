# Export format, version 1

`mapedit export --map <id> --out <directory>` produces one self-contained `<id>.glb`. Export first processes current project files and refuses any file error, rule violation or missing module geometry. The output directory may be inside a Unity project's `Assets`. Files use meters, +Y up, +X east and -Z north; rotations are right-handed around +Y. Importers must handle their engine's coordinate conversion exactly once.

## Scene hierarchy

```text
Map
├── Terrain
│   └── terrain_<cx>_<cz> (mesh)
├── <structure id> (structure transform)
│   └── <instance id> (module mesh, local transform)
├── <module ref>/foundation (generated world-coordinate mesh)
└── Markers
    └── <marker id> (point/box transform)
```

Identical module types share glTF mesh objects and embedded materials/textures. Instance transforms are relative to the owning structure, so multiplying the hierarchy yields the compiled map transform. Terrain chunks and generated foundation meshes use map coordinates. Geometry is indexed triangles with normals and UVs; material textures are embedded. There are no external image or buffer dependencies.

Game data is namespaced under each node's `extras.mapedit`. Other `extras` namespaces remain available to consumers. Version 1 guarantees the following fields:

| Node kind            | `extras.mapedit` fields                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Map root             | `version: 1`, `kind: "map"`, `id`, `units: "meters"`, `size: {x,z}`, `sun: {azimuth,elevation}`                      |
| Terrain group        | `kind: "terrainGroup"`                                                                                               |
| Terrain chunk        | `kind: "terrain"`, `collider: {type:"mesh"}`                                                                         |
| Structure            | `kind: "structure"`, `ref: "structure:<id>"`, `source` (relative YAML filename)                                      |
| Module instance      | `kind: "module"`, `ref: "module:<sourceStructure>/<instance>"`, `moduleType`, `collider: {type:"mesh"}`              |
| Generated foundation | `kind: "foundation"`, `owner` (module ref), `collider: {type:"mesh"}`                                                |
| Point marker         | `kind: "marker"`, `ref: "marker:<id>"`, `markerType`, `properties`, `shape: {kind:"point"}`                          |
| Box marker           | Point marker fields with `shape: {kind:"box",size:[x,y,z]}` and `collider: {type:"box",size:[x,y,z],isTrigger:true}` |

Marker position and rotation live in the glTF node transform, not duplicated in `extras`. A box is centered on that node origin. Its dimensions are local meters, before the node's rotation. `properties` preserves the YAML mapping as JSON. Stable `ref`/`owner` values identify the source objects even when structures have been merged or node names repeat.

Mesh colliders use the actual node mesh, including holes and generated foundation geometry. They are static non-convex surfaces; no rigid bodies or gameplay controllers are exported. A consumer should inspect the `collider` discriminator rather than guessing from mesh names. Box triggers are the only trigger shape in version 1.

## Unity 6 importer

The UPM package in `integrations/unity` depends on UnityGLTF 2.21.0 and automatically registers an import plugin. `OnAfterImportNode` reads the node's extras, adds mesh or box colliders, and resolves marker types through a `MapeditMarkerMapping` ScriptableObject. A `MapeditMarker` component preserves the stable ref, type and JSON properties. The mapped prefab becomes the marker wrapper's child at local identity, retaining imported transform and trigger behavior.

An unknown marker type or absent prefab mapping preserves the marker for game scripts; it does not silently substitute an unrelated object. Select a mapping explicitly in UnityGLTF plugin settings when multiple mapping assets exist. Editing a referenced mapping or prefab triggers reimport through asset dependencies. See [the Unity package README](../integrations/unity/README.md) for installation and batchmode acceptance testing.

Version changes that alter existing semantics require incrementing the root version. Additional optional fields or new node kinds may be added without changing existing fields; consumers should ignore unknown metadata they do not implement.
