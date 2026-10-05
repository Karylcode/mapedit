# Grey Church

A 100 × 100 m example map: a gothic church about 51 × 30 m. Two west towers with spires
flank a stepped portal and a rose window; a 30 m high nave with clerestory windows rises over
two lower aisles held by flying buttresses, ending in a half-octagon apse. A graveyard and a
few trees stand around it.

Inside, flagstone floors run through the nave and aisles, clustered shafts carry groin
vaults under the roof, and 34 pews face a raised chancel with an altar rail, a pulpit,
an altar with blind arcading, a tall cross and candle stands. A font stands inside the
main door and hooded knight statues line the aisle walls. Press V in the editor to fly
inside in first person. Every module is an untextured grey-white model, and the project
uses `style: toon`, so the editor draws it with cel shading and ink outlines.

The editor launcher copies this folder to `projects/church` the first time it runs; choose
**Grey Church** in the project menu at the top left. To open it by hand after `pnpm install`
and `pnpm build`, from the repository root:

```sh
node packages/cli/dist/index.js dev --projects projects --project church
```
