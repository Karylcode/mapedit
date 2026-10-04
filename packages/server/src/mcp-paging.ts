import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const MAX_TOOL_TEXT = 24_000;
const CAPTURE_TTL = 5 * 60_000;
const MAX_CAPTURES = 64;
const CAPTURE_BYTES = 8 * 1024 * 1024;
interface Capture {
  tool: string;
  text: string;
  isError: boolean | undefined;
  expiresAt: number;
}

/** Capture results, never commands, so reading another page cannot repeat a mutation. */
export class ToolResultPager {
  private readonly captures = new Map<string, Capture>();
  private retainedBytes = 0;
  private timer?: ReturnType<typeof setInterval>;

  private remove(id: string): void {
    const capture = this.captures.get(id);
    if (capture) this.retainedBytes -= capture.text.length * 2;
    this.captures.delete(id);
  }

  private expire(): void {
    for (const [id, capture] of this.captures) if (capture.expiresAt <= Date.now()) this.remove(id);
  }

  bound(tool: string, result: CallToolResult): CallToolResult {
    const safe = { ...result };
    delete safe.structuredContent;
    const text = result.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('');
    if (text.length <= MAX_TOOL_TEXT) return safe;
    this.expire();
    const id = randomUUID();
    const capture: Capture = {
      tool,
      text,
      isError: result.isError,
      expiresAt: Date.now() + CAPTURE_TTL,
    };
    this.captures.set(id, capture);
    this.retainedBytes += text.length * 2;
    // Keep one oversized result pageable even when it alone exceeds the cache budget.
    // Every subsequent capture can evict it; the cache never retains two oversized results.
    while (
      this.captures.size > 1 &&
      (this.captures.size > MAX_CAPTURES || this.retainedBytes > CAPTURE_BYTES)
    )
      this.remove(this.captures.keys().next().value!);
    if (!this.timer) this.timer = setInterval(() => this.expire(), 60_000).unref();
    const page = this.page(id, capture, 0);
    page.content.push(...result.content.filter((content) => content.type !== 'text'));
    return page;
  }

  continue(tool: string, cursor: string): CallToolResult {
    this.expire();
    const match = /^([\da-f-]{36})\.(\d+)$/.exec(cursor);
    if (!match)
      throw new Error(
        'This continuation cursor is unavailable or expired. Run the tool again if needed.',
      );
    const id = match[1]!;
    const capture = this.captures.get(id);
    const offset = Number(match[2]);
    if (!capture || !Number.isSafeInteger(offset) || offset < 0 || offset >= capture.text.length)
      throw new Error(
        'This continuation cursor is unavailable or expired. Run the tool again if needed.',
      );
    if (capture.tool !== tool)
      throw new Error('Use this continuation cursor with its original tool.');
    this.captures.delete(id);
    this.captures.set(id, capture);
    return this.page(id, capture, offset);
  }

  private page(id: string, capture: Capture, offset: number): CallToolResult {
    const encode = (length: number) =>
      JSON.stringify({
        paging: {
          fragment: capture.text.slice(offset, offset + length),
          nextCursor: offset + length < capture.text.length ? `${id}.${offset + length}` : null,
          totalCharacters: capture.text.length,
        },
      });
    let low = 1;
    let high = Math.min(MAX_TOOL_TEXT, capture.text.length - offset);
    let length = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (encode(middle).length <= MAX_TOOL_TEXT) {
        length = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return {
      content: [{ type: 'text', text: encode(length) }],
      ...(capture.isError === undefined ? {} : { isError: capture.isError }),
    };
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.captures.clear();
    this.retainedBytes = 0;
  }
}

const pagers = new WeakMap<object, ToolResultPager>();
export function resultPager(owner: object): ToolResultPager {
  let pager = pagers.get(owner);
  if (!pager) {
    pager = new ToolResultPager();
    pagers.set(owner, pager);
  }
  return pager;
}
export function closeResultPager(owner: object): void {
  pagers.get(owner)?.close();
  pagers.delete(owner);
}
