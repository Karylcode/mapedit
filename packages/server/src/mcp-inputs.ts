import { z } from 'zod';
import { SURFACES, TERRAIN_HEIGHT_RANGE, type TerrainCommand } from '@mapedit/core';
import { parseObjectRef, structureRef, type ObjectRef } from '@mapedit/protocol';

/** Structure arguments accept either a bare id or a complete Structure ObjectRef. */
export function normalizeStructureRef(value: string): { ref: ObjectRef; structureId: string } {
  const parsed = parseObjectRef(value);
  if (parsed) {
    if (parsed.kind !== 'structure')
      throw new Error('Expected a Structure id or Structure ObjectRef.');
    return { ref: structureRef(parsed.structureId), structureId: parsed.structureId };
  }
  return { ref: structureRef(value), structureId: value };
}

const mapPoint = z.tuple([z.number().finite(), z.number().finite()]);
const terrainRegion = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('circle'),
    center: mapPoint,
    radius: z.number().positive().max(2000),
  }),
  z.object({ kind: z.literal('rectangle'), min: mapPoint, max: mapPoint }),
  z.object({
    kind: z.literal('path'),
    points: z.array(mapPoint).min(2).max(1000),
    width: z.number().positive().max(2000),
  }),
]);
const height = z
  .number()
  .min(TERRAIN_HEIGHT_RANGE.min)
  .max(TERRAIN_HEIGHT_RANGE.max)
  .multipleOf(0.5);
export const terrainCommandSchema: z.ZodType<TerrainCommand> = z.discriminatedUnion('operation', [
  z.object({
    operation: z.enum(['raise', 'lower']),
    amount: z
      .number()
      .positive()
      .max(TERRAIN_HEIGHT_RANGE.max - TERRAIN_HEIGHT_RANGE.min)
      .multipleOf(0.5),
    region: terrainRegion,
  }),
  z.object({ operation: z.literal('flatten'), height: height.optional(), region: terrainRegion }),
  z.object({ operation: z.literal('set_height'), height, region: terrainRegion }),
  z.object({ operation: z.literal('mountain'), height, region: terrainRegion }),
  z.object({ operation: z.literal('paint'), surface: z.enum(SURFACES), region: terrainRegion }),
]);
