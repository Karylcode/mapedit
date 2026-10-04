export interface MaterialDefinition {
  id: string;
  name: string;
  color: [number, number, number, number];
  roughness: number;
  metallic: number;
  /** Physical width of one image repeat, in metres. */
  repeatMeters: number;
  texture?: string;
}

export const BUILTIN_MATERIALS: readonly MaterialDefinition[] = [
  {
    id: 'wood_planks',
    name: 'Wood planks',
    color: [1, 1, 1, 1],
    roughness: 0.85,
    metallic: 0,
    repeatMeters: 1.5,
    texture: 'wood_planks.jpg',
  },
  {
    id: 'dark_wood',
    name: 'Dark wood planks',
    color: [0.35, 0.25, 0.18, 1],
    roughness: 0.85,
    metallic: 0,
    repeatMeters: 1.5,
    texture: 'wood_planks.jpg',
  },
  {
    id: 'stone_brick',
    name: 'Stone brick',
    color: [1, 1, 1, 1],
    roughness: 0.9,
    metallic: 0,
    repeatMeters: 1.5,
    texture: 'stone_brick.jpg',
  },
  {
    id: 'plaster',
    name: 'Grey plaster',
    color: [1, 1, 1, 1],
    roughness: 0.95,
    metallic: 0,
    repeatMeters: 1.5,
    texture: 'plaster.jpg',
  },
  {
    id: 'roof_tiles',
    name: 'Roof tiles',
    color: [1, 1, 1, 1],
    roughness: 0.8,
    metallic: 0,
    repeatMeters: 2,
    texture: 'roof_tiles.jpg',
  },
  {
    id: 'thatch',
    name: 'Thatch',
    color: [1, 1, 1, 1],
    roughness: 1,
    metallic: 0,
    repeatMeters: 0.54,
    texture: 'thatch.jpg',
  },
  {
    id: 'grass',
    name: 'Grass',
    color: [1, 1, 1, 1],
    roughness: 1,
    metallic: 0,
    repeatMeters: 1,
    texture: 'grass.jpg',
  },
  {
    id: 'dirt',
    name: 'Dirt',
    color: [1, 1, 1, 1],
    roughness: 1,
    metallic: 0,
    repeatMeters: 1.3,
    texture: 'dirt.jpg',
  },
  {
    id: 'gravel',
    name: 'Gravel',
    color: [1, 1, 1, 1],
    roughness: 1,
    metallic: 0,
    repeatMeters: 2,
    texture: 'gravel.jpg',
  },
  {
    id: 'metal',
    name: 'Metal',
    color: [1, 1, 1, 1],
    roughness: 0.55,
    metallic: 0.9,
    repeatMeters: 1.5,
    texture: 'metal.jpg',
  },
  {
    id: 'white',
    name: 'White',
    color: [0.85, 0.85, 0.85, 1],
    roughness: 0.8,
    metallic: 0,
    repeatMeters: 1,
  },
  {
    id: 'red',
    name: 'Red',
    color: [0.65, 0.07, 0.04, 1],
    roughness: 0.8,
    metallic: 0,
    repeatMeters: 1,
  },
  {
    id: 'blue',
    name: 'Blue',
    color: [0.04, 0.15, 0.65, 1],
    roughness: 0.8,
    metallic: 0,
    repeatMeters: 1,
  },
];

/** The authoring and tool catalogs share the actual built-in material definitions. */
export const BUILTIN_MATERIAL_IDS: readonly string[] = BUILTIN_MATERIALS.map(({ id }) => id);

export function getMaterial(id: string): MaterialDefinition {
  const material = BUILTIN_MATERIALS.find((entry) => entry.id === id);
  if (!material) throw new Error(`Unknown material '${id}'. Choose a built-in material ID.`);
  return material;
}
