import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listFloatingInstances,
  type Compilation,
  type ModuleDefinition,
  type TerrainCommand,
} from '@mapedit/core';
import type { InstanceView, SceneSnapshot } from '@mapedit/protocol';
import { ScreenshotService } from './screenshot.js';
import { resultPager, closeResultPager } from './mcp-paging.js';
import { normalizeStructureRef, terrainCommandSchema } from './mcp-inputs.js';

export interface AgentServices {
  flush(): Promise<void>;
  getScene(mapId?: string): Promise<SceneSnapshot>;
  getScenes(mapId?: string): Promise<SceneSnapshot[]>;
  getCompilation(mapId?: string): Promise<Compilation | undefined>;
  getModules(): ModuleDefinition[];
  compatibleSocketTypes(type: string): string[];
  query(mapId: string | undefined, x: number, z: number): Promise<unknown>;
  buildModule(id: string): Promise<{ summary: unknown; preview?: Buffer }>;
  terrain(mapId: string | undefined, command: TerrainCommand): Promise<unknown>;
  export(mapId: string | undefined, out: string): Promise<unknown>;
}
const pageSchema = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
};
const mapSchema = { map: z.string().optional() };
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const textResult = (value: unknown): CallToolResult => {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
};
const page = <T>(values: T[], offset: number, limit: number) => ({
  items: values.slice(offset, offset + limit),
  total: values.length,
  nextOffset: offset + limit < values.length ? offset + limit : null,
});
const units = 'Coordinates are metres, +Y up, +X east, -Z north. ';

function floorPlan(instances: InstanceView[], scene: SceneSnapshot) {
  const cells = instances.map((instance) => {
    const size = scene.moduleTypes.find((module) => module.id === instance.moduleType)?.size ?? [
      0.5, 0.5, 0.5,
    ];
    const m = instance.transform;
    const points = [
      [0, 0],
      [size[0]!, 0],
      [0, size[2]!],
      [size[0]!, size[2]!],
    ].map(([x, z]) => [m[12]! + m[0]! * x! + m[8]! * z!, m[14]! + m[2]! * x! + m[10]! * z!]);
    return {
      instance,
      minX: Math.min(...points.map((p) => p[0]!)),
      maxX: Math.max(...points.map((p) => p[0]!)),
      minZ: Math.min(...points.map((p) => p[1]!)),
      maxZ: Math.max(...points.map((p) => p[1]!)),
    };
  });
  const x = Math.min(...cells.map((cell) => cell.minX)),
    z = Math.min(...cells.map((cell) => cell.minZ));
  const width = Math.max(...cells.map((cell) => cell.maxX)) - x,
    depth = Math.max(...cells.map((cell) => cell.maxZ)) - z;
  const cellSize = Math.max(0.5, Math.ceil((Math.max(width, depth) / 32) * 2) / 2);
  const columns = Math.max(1, Math.ceil(width / cellSize)),
    rows = Math.max(1, Math.ceil(depth / cellSize));
  const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => '.'));
  const symbols = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  cells.forEach((cell, index) => {
    for (
      let row = Math.max(0, Math.floor((cell.minZ - z) / cellSize));
      row < Math.min(rows, Math.ceil((cell.maxZ - z) / cellSize));
      row++
    )
      for (
        let col = Math.max(0, Math.floor((cell.minX - x) / cellSize));
        col < Math.min(columns, Math.ceil((cell.maxX - x) / cellSize));
        col++
      )
        grid[row]![col] = symbols[index % symbols.length]!;
  });
  return {
    origin: [x, z],
    cellSize,
    note: 'North is up (-Z). Cells show projected module bounds; openings and overlaps require a screenshot.',
    plan: grid.map((row) => row.join('')).join('\n'),
    legend: cells.slice(0, 60).map((cell, index) => ({
      symbol: symbols[index % symbols.length],
      ref: cell.instance.ref,
      module: cell.instance.moduleType,
    })),
    totalModules: cells.length,
  };
}

function checkInputSize(value: unknown): void {
  const pending = [value];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    visited++;
    const children = Array.isArray(current)
      ? current
      : current && typeof current === 'object'
        ? Object.values(current)
        : [];
    if (visited + pending.length + children.length > 10_000)
      throw new Error('Tool arguments exceed the 10000 element input limit.');
    pending.push(...children);
  }
}

export function createMcpServer(services: AgentServices, screenshots: ScreenshotService): Server {
  const server = new Server(
    { name: 'mapedit', version: '0.1.0' },
    {
      instructions:
        'Edit project files, check, screenshot, then fix violations. All coordinates are metres; +X east and -Z north. Tool lists are fixed.',
      capabilities: { tools: {} },
    },
  );
  const pager = resultPager(services);
  const tools = new Map<
    string,
    { definition: Tool; run(args: unknown): Promise<CallToolResult> }
  >();
  function registerTool<S extends z.ZodRawShape>(
    name: string,
    config: { description: string; inputSchema: S },
    handler: (args: z.output<z.ZodObject<S>>) => Promise<CallToolResult>,
  ): void {
    const input = z.object(config.inputSchema).strict();
    const cursor = z.object({ cursor: z.string().max(128) }).strict();
    tools.set(name, {
      definition: {
        name,
        description:
          config.description +
          ' Oversized text uses paging.fragment and paging.nextCursor. Continue with only {"cursor":"..."} on this same tool; do not repeat the original arguments.',
        inputSchema: {
          type: 'object',
          anyOf: [z.toJSONSchema(input, { io: 'input' }), z.toJSONSchema(cursor, { io: 'input' })],
        },
      },
      async run(args) {
        if (args && typeof args === 'object' && 'cursor' in args)
          return pager.continue(name, cursor.parse(args).cursor);
        return handler(input.parse(args ?? {}));
      },
    });
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((tool) => tool.definition),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    try {
      checkInputSize(request.params.arguments);
      const tool = tools.get(name);
      if (!tool) throw new Error('Unknown tool. Use tools/list to see the fixed tool names.');
      return pager.bound(name, await tool.run(request.params.arguments));
    } catch (error) {
      return pager.bound(name, {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      });
    }
  });
  registerTool(
    'overview',
    {
      description:
        units +
        'Map size, structures, markers, canFloat instances and violation counts for every map unless map is specified. Example: {"map":"village"}.',
      inputSchema: { ...mapSchema, ...pageSchema },
    },
    async ({ map, offset, limit }) => {
      await services.flush();
      const scenes = await services.getScenes(map);
      return textResult({
        maps: scenes.map((scene) => ({
          map: scene.map,
          revision: scene.revision,
          structures: page(
            scene.structures.map((s) => ({
              ref: s.ref,
              name: s.name,
              modules: s.instances.length,
            })),
            offset,
            limit,
          ),
          markers: page(scene.markers, offset, limit),
          violations: scene.violations.length,
          fileErrors: scene.fileErrors.length,
          floating: page(listFloatingInstances(scene), offset, limit),
        })),
      });
    },
  );
  registerTool(
    'check',
    {
      description:
        units +
        'List violations, actionable suggestions and canFloat instances for every map unless map is specified. canFloat instances are informational, including those on the ground. Example: {"map":"village","limit":50}.',
      inputSchema: { ...mapSchema, ...pageSchema },
    },
    async ({ map, offset, limit }) => {
      await services.flush();
      const scenes = await services.getScenes(map);
      return textResult({
        maps: scenes.map((scene) => ({
          map: scene.map.id,
          revision: scene.revision,
          ok: scene.violations.length === 0 && scene.fileErrors.length === 0,
          violations: page(scene.violations, offset, limit),
          fileErrors: page(scene.fileErrors, offset, limit),
          floating: page(listFloatingInstances(scene), offset, limit),
        })),
      });
    },
  );
  registerTool(
    'screenshot',
    {
      description:
        units +
        'Return a PNG montage of top and four angled views. Example: {"map":"village","structure":"house","tileSize":512}.',
      inputSchema: {
        ...mapSchema,
        structure: z.string().optional(),
        views: z
          .array(z.enum(['top', 'ne', 'nw', 'se', 'sw']))
          .min(1)
          .max(5)
          .default(['top', 'ne', 'nw', 'se', 'sw']),
        tileSize: z.number().int().min(64).max(1024).default(512),
        focus: z.object({ center: vector, radius: z.number().positive() }).optional(),
        highlight: z.array(z.string()).max(100).optional(),
        showViolations: z.boolean().default(true),
      },
    },
    async ({ map, structure, views, tileSize, focus, highlight, showViolations }) => {
      const target = structure === undefined ? undefined : normalizeStructureRef(structure);
      await services.flush();
      const scene = await services.getScene(map);
      if (target) {
        const object = scene.structures.find((s) => s.ref === target.ref);
        if (!object) throw new Error(`Structure '${structure}' does not exist.`);
        const compilation = await services.getCompilation(map);
        const bounds = compilation?.instances
          .filter((i) => i.structureId === target.structureId)
          .map((i) => i.bounds);
        if (bounds?.length) {
          const min = [0, 1, 2].map((axis) => Math.min(...bounds.map((b) => b.min[axis]!)));
          const max = [0, 1, 2].map((axis) => Math.max(...bounds.map((b) => b.max[axis]!)));
          focus = {
            center: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2],
            radius: Math.max(
              2,
              Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2,
            ),
          };
        } else
          focus = {
            center: [object.transform[12]!, object.transform[13]!, object.transform[14]!],
            radius: 5,
          };
        highlight = [object.ref];
      }
      const png = await screenshots.capture(scene.map.id, {
        views,
        tileSize,
        ...(focus ? { focus } : {}),
        ...(highlight ? { highlight } : {}),
        showViolations,
        minRevision: scene.revision,
      });
      return { content: [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }] };
    },
  );
  registerTool(
    'floor_plan',
    {
      description:
        units +
        'Return per-floor text plans with module positions. North is -Z. Example: {"structure":"house"}.',
      inputSchema: { ...mapSchema, structure: z.string(), ...pageSchema },
    },
    async ({ map, structure, offset, limit }) => {
      const { ref } = normalizeStructureRef(structure);
      await services.flush();
      const scene = await services.getScene(map);
      const found = scene.structures.find((s) => s.ref === ref);
      if (!found) throw new Error(`Structure '${structure}' does not exist.`);
      const levels = new Map<number, InstanceView[]>();
      for (const instance of found.instances) {
        const y = instance.transform[13]!;
        const values = levels.get(y) ?? [];
        values.push(instance);
        levels.set(y, values);
      }
      return textResult({
        structure: found.ref,
        north: '-Z',
        floors: page(
          [...levels]
            .sort(([a], [b]) => a - b)
            .map(([height, instances]) => ({ height, ...floorPlan(instances, scene) })),
          offset,
          Math.min(limit, 5),
        ),
      });
    },
  );
  registerTool(
    'query',
    {
      description:
        units +
        'Inspect terrain height, surface and objects at a map position. Example: {"x":12.5,"z":8}.',
      inputSchema: { ...mapSchema, x: z.number().finite(), z: z.number().finite() },
    },
    async ({ map, x, z }) => {
      await services.flush();
      return textResult(await services.query(map, x, z));
    },
  );
  registerTool(
    'free_sockets',
    {
      description:
        units +
        'List empty sockets and compatible module socket pairs. Example: {"structure":"house"}.',
      inputSchema: { ...mapSchema, structure: z.string(), ...pageSchema },
    },
    async ({ map, structure, offset, limit }) => {
      const { ref } = normalizeStructureRef(structure);
      await services.flush();
      const compiled = await services.getCompilation(map);
      if (!compiled) return textResult({ items: [], total: 0, nextOffset: null });
      const object = compiled.scene.structures.find((s) => s.ref === ref);
      if (!object) throw new Error(`Structure '${structure}' does not exist.`);
      const refs = new Set(object.instances.map((i) => i.ref));
      const values = compiled.sockets
        .filter((socket) => refs.has(socket.instanceRef) && !socket.occupied)
        .map((socket) => ({
          ref: socket.ref,
          type: socket.type,
          position: socket.position,
          compatibleModules: services
            .getModules()
            .flatMap((module) =>
              module.sockets
                .filter((candidate) =>
                  services.compatibleSocketTypes(socket.type).includes(candidate.type),
                )
                .map((candidate) => ({ module: module.id, socket: candidate.id })),
            )
            .slice(0, 100),
        }));
      return textResult(page(values, offset, limit));
    },
  );
  registerTool(
    'modules',
    {
      description:
        units +
        'List module dimensions, sockets and support properties. Example: {"offset":0,"limit":25}.',
      inputSchema: pageSchema,
    },
    async ({ offset, limit }) => {
      await services.flush();
      return textResult(
        page(
          services
            .getModules()
            .map(({ id, name, size, sockets, isFoundation, canFloat, terrainFollow }) => ({
              id,
              name,
              size,
              sockets: sockets.map(({ id, type, position, direction }) => ({
                id,
                type,
                position,
                direction,
              })),
              isFoundation,
              canFloat,
              terrainFollow,
            })),
          offset,
          limit,
        ),
      );
    },
  );
  registerTool(
    'build_module',
    {
      description:
        units +
        'Build model.ts in isolation and return diagnostics with a module preview PNG. Example: {"module":"wall"}.',
      inputSchema: { module: z.string() },
    },
    async ({ module }) => {
      await services.flush();
      const result = await services.buildModule(module);
      return {
        content: [
          { type: 'text', text: JSON.stringify(result.summary) },
          ...(result.preview
            ? [
                {
                  type: 'image' as const,
                  mimeType: 'image/png',
                  data: result.preview.toString('base64'),
                },
              ]
            : []),
        ],
      };
    },
  );
  registerTool(
    'terrain',
    {
      description:
        units +
        'Apply a terrain command to a circle, rectangle or path. Height steps are 0.5 m. Example: {"command":{"operation":"raise","amount":0.5,"region":{"kind":"circle","center":[10,10],"radius":3}}}.',
      inputSchema: { ...mapSchema, command: terrainCommandSchema },
    },
    async ({ map, command }) => {
      await services.flush();
      return textResult(await services.terrain(map, command));
    },
  );
  registerTool(
    'export',
    {
      description:
        units +
        'Export a map GLB including collider and marker extras. Refuses violations. Example: {"map":"village","out":"./export"}.',
      inputSchema: { ...mapSchema, out: z.string().min(1) },
    },
    async ({ map, out }) => {
      await services.flush();
      return textResult(await services.export(map, out));
    },
  );
  return server;
}

export function createMcpHttpHandler(services: AgentServices, screenshots: ScreenshotService) {
  const active = new Set<Server>();
  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const server = createMcpServer(services, screenshots);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      active.add(server);
      response.once('close', () => {
        active.delete(server);
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response);
    },
    async close(): Promise<void> {
      await Promise.all([...active].map((server) => server.close()));
      closeResultPager(services);
    },
  };
}

/** Forward stdio to the same running backend so file history and screenshots stay shared. */
export async function connectStdio(
  url: string,
  onClose?: () => Promise<void>,
): Promise<() => Promise<void>> {
  const client = new Client({ name: 'mapedit-stdio-bridge', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', url)));
  const server = new Server({ name: 'mapedit', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    process.stdin.off('end', handleEnd);
    await server.close();
    await client.close();
    await onClose?.();
  };
  const handleEnd = () => {
    void close();
  };
  process.stdin.once('end', handleEnd);
  transport.onclose = () => {
    void close();
  };
  return close;
}
