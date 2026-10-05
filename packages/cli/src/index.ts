#!/usr/bin/env node
import {
  createServer,
  buildProjects,
  exportProject,
  connectStdio,
  listProjects,
  SERVER_WEB_ROOT,
} from '@mapedit/server';
import { listFloatingInstances, sceneHasProblems } from '@mapedit/core';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProject } from './init.js';
import { discoverServer, registerServer } from './discovery.js';

/** The editor build that prepare-cli copies into this package for npm installs. */
const PACKED_WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
/**
 * A repository build beside the server comes first, so it stays fresh while the editor is
 * developed; the server looks the candidates up again on every request and screenshot.
 */
const EDITOR_WEB_ROOTS = [SERVER_WEB_ROOT, PACKED_WEB_ROOT];
/** In a folder of projects, the project the editor had open last. */
const LAST_PROJECT = '.last-project';

/**
 * The project of a folder of projects to open first: the one asked for, else the
 * one open last time, else the first by folder name.
 */
async function firstProject(directory: string, requested?: string): Promise<string> {
  const known = await listProjects(directory);
  if (requested !== undefined) {
    if (!known.some((project) => project.id === requested))
      throw new Error(`${requested} is not a project folder in ${directory}.`);
    return requested;
  }
  const last = (await readFile(join(directory, LAST_PROJECT), 'utf8').catch(() => '')).trim();
  const id = known.some((project) => project.id === last) ? last : known[0]?.id;
  if (id === undefined)
    throw new Error(
      `${directory} has no projects. Create one with: mapedit init ${join(directory, 'my-maps')}`,
    );
  return id;
}

/** The value after a flag, or undefined when the flag is absent. */
function flagValue(flags: string[], name: string): string | undefined {
  const index = flags.indexOf(name);
  if (index < 0) return undefined;
  const value = flags[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...flags] = args;
  if (command === 'init') {
    const directory = flags[0] ?? '.';
    if (flags.length > 1 || directory.startsWith('--'))
      throw new Error('Usage: mapedit init [directory]');
    process.stdout.write(`Created Mapedit project at ${await initProject(directory)}\n`);
    return;
  }
  if (command === 'export') {
    const outIndex = flags.indexOf('--out'),
      mapIndex = flags.indexOf('--map');
    const out = flags[outIndex + 1];
    if (outIndex < 0 || !out || out.startsWith('--'))
      throw new Error('export requires --out <directory>.');
    if (mapIndex >= 0 && (!flags[mapIndex + 1] || flags[mapIndex + 1]!.startsWith('--')))
      throw new Error('--map requires a map ID.');
    const files = await exportProject(
      process.cwd(),
      mapIndex >= 0 ? flags[mapIndex + 1] : undefined,
      out,
    );
    process.stdout.write(`${files.join('\n')}\n`);
    return;
  }
  if (command === 'mcp') {
    const serverIndex = flags.indexOf('--server');
    let url = serverIndex >= 0 ? flags[serverIndex + 1] : await discoverServer(process.cwd());
    if (serverIndex >= 0) {
      if (!url) throw new Error('--server requires a local backend URL.');
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password
      )
        throw new Error('--server must refer to a local HTTP backend.');
    }
    let cleanup: (() => Promise<void>) | undefined;
    if (!url) {
      const server = await createServer({
        root: process.cwd(),
        port: 0,
        webRoot: EDITOR_WEB_ROOTS,
      });
      url = server.url;
      const unregister = await registerServer(process.cwd(), url);
      cleanup = async () => {
        await server.close();
        await unregister();
      };
    }
    let close: () => Promise<void>;
    try {
      close = await connectStdio(url, cleanup);
    } catch (error) {
      await cleanup?.();
      throw error;
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => void close().then(() => process.exit(0)));
    return;
  }
  if (command === 'check') {
    const mapIndex = flags.indexOf('--map');
    if (mapIndex >= 0 && (!flags[mapIndex + 1] || flags[mapIndex + 1]!.startsWith('--')))
      throw new Error('--map requires a map ID.');
    const built = await buildProjects(
      process.cwd(),
      mapIndex < 0 ? undefined : flags[mapIndex + 1],
    );
    const maps = built.map(({ scene }) => ({
      map: scene.map.id,
      violations: scene.violations,
      fileErrors: scene.fileErrors,
      floating: listFloatingInstances(scene),
    }));
    if (flags.includes('--json')) {
      process.stdout.write(`${JSON.stringify({ maps }, null, 2)}\n`);
    } else {
      for (const { map, violations, fileErrors, floating } of maps) {
        process.stdout.write(`Map ${map}:\n`);
        for (const error of fileErrors)
          process.stdout.write(`${error.file}:${error.line ?? 1}: ${error.message}\n`);
        for (const violation of violations) {
          const source =
            typeof violation.params.file === 'string'
              ? `${violation.params.file}:${typeof violation.params.line === 'number' ? violation.params.line : 1}: `
              : '';
          process.stdout.write(
            `${source}${violation.kind}: ${violation.message}${violation.suggestion ? ` ${violation.suggestion}` : ''}\n`,
          );
        }
        for (const instance of floating)
          process.stdout.write(
            `canFloat: ${instance.ref} ${instance.moduleType} at [${instance.position.join(', ')}] m\n`,
          );
        process.stdout.write(
          `${violations.length} violations, ${fileErrors.length} file errors, ${floating.length} canFloat instances.\n`,
        );
      }
    }
    process.exitCode = maps.some(sceneHasProblems) ? 1 : 0;
    return;
  }
  if (command === 'dev') {
    const portIndex = flags.indexOf('--port');
    const port = portIndex < 0 ? 4790 : Number(flags[portIndex + 1]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('--port must be an integer between 0 and 65535.');
    }
    const projects = flagValue(flags, '--projects');
    const directory = projects === undefined ? undefined : resolve(projects);
    const root = directory
      ? join(directory, await firstProject(directory, flagValue(flags, '--project')))
      : process.cwd();
    const server = await createServer({
      port,
      mock: flags.includes('--mock'),
      root,
      webRoot: EDITOR_WEB_ROOTS,
      // In a folder of projects every project opened registers itself and is remembered.
      ...(directory && {
        projects: {
          directory,
          async opened(folder: string, url: string) {
            await writeFile(join(directory, LAST_PROJECT), `${basename(folder)}\n`).catch(
              () => undefined,
            );
            return registerServer(folder, url);
          },
        },
      }),
    });
    const unregister = directory ? async () => {} : await registerServer(root, server.url);
    process.stderr.write(`mapedit listening at ${server.url}\n`);
    if (flags.includes('--open')) {
      const platform = process.platform;
      const executable =
        platform === 'win32' ? 'rundll32' : platform === 'darwin' ? 'open' : 'xdg-open';
      const browserArgs =
        platform === 'win32' ? ['url.dll,FileProtocolHandler', server.url] : [server.url];
      const child = spawn(executable, browserArgs, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => process.stderr.write(`Open ${server.url} in your browser.\n`));
      child.unref();
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(
        signal,
        () =>
          void server
            .close()
            .then(unregister)
            .then(() => process.exit(0)),
      );
    }
    return;
  }
  if (command === '--help' || command === undefined) {
    process.stdout.write(
      'mapedit init [directory]\nmapedit dev [--port <port>] [--mock] [--open] [--projects <folder> [--project <name>]]\nmapedit check [--map <id>] [--json]\nmapedit export [--map <id>] --out <directory>\nmapedit mcp\n',
    );
    return;
  }
  throw new Error(`Unknown command: ${command}. Run mapedit --help.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
