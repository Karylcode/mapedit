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

/**
 * The time limit for one whole screenshot: starting the browser, loading the render page,
 * waiting until it is ready and rendering. It stays below the 60 seconds after which MCP
 * clients give up by default, so the Agent always gets the reason.
 */
export const SCREENSHOT_TIMEOUT_MS = 50_000;
/** The longest error text relayed to the Agent. */
const ERROR_LENGTH = 1_000;

/** The first line of an error, without Playwright's call prefix, capped. */
function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = (text.split('\n')[0] ?? text)
    .replace(/^page\.evaluate: /, '')
    .replace(/^Error: /, '');
  return line.length > ERROR_LENGTH
    ? `${line.slice(0, ERROR_LENGTH)}… (${line.length - ERROR_LENGTH} more characters)`
    : line;
}
class Expired extends Error {}
/** `promise`, or an Expired rejection after `ms`; the timer never outlives the race. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Expired()), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** The front end owns rendering; the backend only calls the documented page contract. */
export class ScreenshotService {
  private browser?: Browser;
  private launch?: Promise<Browser>;
  private readonly timeoutMs: number;
  private readonly editorBuilt?: () => Promise<boolean>;
  /**
   * `timeoutMs` limits one whole capture (SCREENSHOT_TIMEOUT_MS unless a test shortens it).
   * `editorBuilt` tells, at each capture, whether an editor build serves /render, so a
   * capture without one fails at once instead of waiting for a page that never loads. Leave
   * it out when the base URL serves its own render page.
   */
  constructor(
    private readonly baseUrl: string,
    private readonly executablePath?: string,
    options: { timeoutMs?: number; editorBuilt?: () => Promise<boolean> } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? SCREENSHOT_TIMEOUT_MS;
    this.editorBuilt = options.editorBuilt;
  }
  /** Every failure is one short line, so the Agent gets a readable reason. */
  async capture(mapId: string, spec: RenderSpec): Promise<Buffer> {
    try {
      return await this.render(mapId, spec, Date.now() + this.timeoutMs);
    } catch (error) {
      throw new Error(shortError(error), { cause: error });
    }
  }
  private async render(mapId: string, spec: RenderSpec, deadline: number): Promise<Buffer> {
    const left = () => Math.max(1, deadline - Date.now());
    const seconds = this.timeoutMs / 1000;
    if (this.editorBuilt && !(await this.editorBuilt()))
      throw new Error('The editor web build is missing; run pnpm build.');
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
    // A slow start counts toward this capture; the browser keeps starting for the next one.
    const browser = await within(this.launch, left()).catch((error: unknown) => {
      throw error instanceof Expired
        ? new Error(`The headless browser did not start within ${seconds} seconds. Try again.`)
        : error;
    });
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
      const notReady = (error: unknown) => {
        throw error instanceof Error && error.name === 'TimeoutError'
          ? new Error(
              `The render page did not become ready within ${seconds} seconds and was closed. Check that the editor build loads, then try again.`,
            )
          : error;
      };
      await page
        .goto(`${this.baseUrl}/render?map=${encodeURIComponent(mapId)}`, {
          waitUntil: 'domcontentloaded',
          timeout: left(),
        })
        .catch(notReady);
      await page
        .waitForFunction(
          () => (window as unknown as RenderWindow).mapeditRenderReady === true,
          undefined,
          { timeout: left() },
        )
        .catch(notReady);
      // The page reports problems such as missing WebGL or an unknown map as errors. A render
      // that never finishes is abandoned; closing the page below also ends its evaluate call.
      const rendering = page.evaluate(
        async (value) => (window as unknown as RenderWindow).mapeditRender(value),
        spec,
      );
      rendering.catch(() => undefined);
      const data = await within(rendering, left()).catch((error: unknown) => {
        throw new Error(
          error instanceof Expired
            ? `The render page did not finish within ${seconds} seconds and was closed. Try again, or ask for fewer views or a smaller tileSize.`
            : `Render page error: ${shortError(error)}`,
        );
      });
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
