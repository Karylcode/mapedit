#!/usr/bin/env node
import { createServer } from '@mapedit/server';
import { spawn } from 'node:child_process';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...flags] = args;
  if (command === 'dev') {
    const portIndex = flags.indexOf('--port');
    const port = portIndex < 0 ? 4790 : Number(flags[portIndex + 1]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('--port must be an integer between 0 and 65535.');
    }
    const server = await createServer({
      port,
      mock: flags.includes('--mock'),
      root: process.cwd(),
    });
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
      process.once(signal, () => void server.close().then(() => process.exit(0)));
    }
    return;
  }
  if (command === '--help' || command === undefined) {
    process.stdout.write('mapedit dev [--port <port>] [--mock] [--open]\n');
    return;
  }
  throw new Error(`Unknown command: ${command}. Run mapedit --help.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
