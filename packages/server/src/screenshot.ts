import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import type { RenderSpec, RenderWindow } from '@mapedit/protocol';

export async function findBrowser(): Promise<string | undefined> {
  const candidates =
    process.platform === 'win32'
      ? [
          join(
            process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
            'Microsoft/Edge/Application/msedge.exe',
          ),
          join(
            process.env['PROGRAMFILES'] ?? 'C:/Program Files',
            'Google/Chrome/Application/chrome.exe',
          ),
          join(process.env['LOCALAPPDATA'] ?? '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ];
  for (const path of candidates)
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return path;
  return undefined;
}

/**
 * Headless browser flags. SwiftShader lets the render page create a WebGL context on
 * machines without a GPU, such as CI runners; with a GPU it changes nothing.
 */
export const SCREENSHOT_BROWSER_ARGS = ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'];

/** How long one render may take before its page is closed. */
const RENDER_TIMEOUT_MS = 60_000;
/** The longest render page error text relayed to the Agent. */
const RENDER_ERROR_LENGTH = 1_000;

/** The render page's own error text, without Playwright's call prefix and stack, capped. */
function renderPageError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = (text.split('\n')[0] ?? text)
    .replace(/^page\.evaluate: /, '')
    .replace(/^Error: /, '');
  return line.length > RENDER_ERROR_LENGTH
    ? `${line.slice(0, RENDER_ERROR_LENGTH)}… (${line.length - RENDER_ERROR_LENGTH} more characters)`
    : line;
}
class RenderTimeout extends Error {}

/** The front end owns rendering; the backend only calls the documented page contract. */
export class ScreenshotService {
  private browser?: Browser;
  private launch?: Promise<Browser>;
  private readonly renderTimeoutMs: number;
  constructor(
    private readonly baseUrl: string,
    private readonly executablePath?: string,
    options: { renderTimeoutMs?: number } = {},
  ) {
    this.renderTimeoutMs = options.renderTimeoutMs ?? RENDER_TIMEOUT_MS;
  }
  async capture(mapId: string, spec: RenderSpec): Promise<Buffer> {
    if (!this.launch)
      this.launch = (async () => {
        const executablePath = this.executablePath ?? (await findBrowser());
        if (!executablePath)
          throw new Error(
            'No supported system browser was found. Install Edge or Chrome to enable screenshots.',
          );
        this.browser = await chromium.launch({
          executablePath,
          headless: true,
          args: SCREENSHOT_BROWSER_ARGS,
        });
        return this.browser;
      })().catch((error) => {
        this.launch = undefined;
        throw error;
      });
    const browser = await this.launch;
    const page = await browser.newPage();
    try {
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return url.origin === new URL(this.baseUrl).origin ||
          url.protocol === 'data:' ||
          url.protocol === 'blob:'
          ? route.continue()
          : route.abort();
      });
      await page.goto(`${this.baseUrl}/render?map=${encodeURIComponent(mapId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForFunction(
        () => (window as unknown as RenderWindow).mapeditRenderReady === true,
        undefined,
        { timeout: 30_000 },
      );
      // The page reports problems such as missing WebGL or an unknown map as errors. A render
      // that never finishes is abandoned; closing the page below also ends its evaluate call.
      const rendering = page.evaluate(
        async (value) => (window as unknown as RenderWindow).mapeditRender(value),
        spec,
      );
      rendering.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new RenderTimeout()), this.renderTimeoutMs);
      });
      const data = await Promise.race([rendering, timeout])
        .catch((error: unknown) => {
          throw new Error(
            error instanceof RenderTimeout
              ? `The render page did not finish within ${this.renderTimeoutMs / 1000} seconds and was closed. Try again, or ask for fewer views or a smaller tileSize.`
              : `Render page error: ${renderPageError(error)}`,
          );
        })
        .finally(() => clearTimeout(timer));
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))
        throw new Error('The render page did not return a PNG data URL.');
      const png = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
      if (
        png.length > 32 * 1024 * 1024 ||
        png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      )
        throw new Error('The render page returned an invalid or oversized PNG.');
      return png;
    } finally {
      await page.close();
    }
  }
  async close(): Promise<void> {
    if (this.launch)
      await this.launch.then(
        (browser) => browser.close(),
        () => undefined,
      );
    this.browser = undefined;
    this.launch = undefined;
  }
}
