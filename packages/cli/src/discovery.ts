import { mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

interface ServerRecord {
  root: string;
  url: string;
  pid: number;
  instance: string;
}
const filename = (root: string) => path.join(root, '.mapedit', 'server.json');
const projectIdentity = (root: string) =>
  createHash('sha256')
    .update(process.platform === 'win32' ? root.toLowerCase() : root)
    .digest('hex');

export async function registerServer(root: string, url: string): Promise<() => Promise<void>> {
  const canonicalRoot = await realpath(root);
  const response = await fetch(new URL('/api/project', url), {
    method: 'HEAD',
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  const instance = response.headers.get('X-Mapedit-Instance');
  if (
    !response.ok ||
    !instance ||
    response.headers.get('X-Mapedit-Project') !== projectIdentity(canonicalRoot) ||
    response.headers.get('X-Mapedit-Pid') !== String(process.pid)
  )
    throw new Error('Cannot register a backend belonging to another project or process.');
  const record: ServerRecord = { root: canonicalRoot, url, pid: process.pid, instance };
  await mkdir(path.dirname(filename(root)), { recursive: true });
  await writeFile(filename(root), JSON.stringify(record));
  return async () => {
    try {
      const current = JSON.parse(await readFile(filename(root), 'utf8')) as ServerRecord;
      if (
        current.pid === record.pid &&
        current.url === record.url &&
        current.instance === record.instance
      )
        await rm(filename(root), { force: true });
    } catch {
      /* The registry is only a discovery hint; a removed file is harmless. */
    }
  };
}

export async function discoverServer(root: string): Promise<string | undefined> {
  try {
    const record = JSON.parse(await readFile(filename(root), 'utf8')) as ServerRecord;
    if (
      record.root !== (await realpath(root)) ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.instance !== 'string'
    )
      return undefined;
    const url = new URL(record.url);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return undefined;
    process.kill(record.pid, 0);
    const response = await fetch(new URL('/api/project', url), {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000),
      redirect: 'error',
    });
    if (
      !response.ok ||
      response.headers.get('X-Mapedit-Instance') !== record.instance ||
      response.headers.get('X-Mapedit-Project') !== projectIdentity(record.root) ||
      response.headers.get('X-Mapedit-Pid') !== String(record.pid)
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
