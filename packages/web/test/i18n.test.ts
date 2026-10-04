import { describe, expect, it } from 'vitest';
import { detectLang, loadLang, saveLang, translate, STORAGE_KEY } from '../src/i18n/i18n.js';
import { en, zhTW } from '../src/i18n/messages.js';

describe('interface language', () => {
  it('follows the browser: any Chinese locale gets Traditional Chinese', () => {
    expect(detectLang(['zh-TW', 'en'])).toBe('zh-TW');
    expect(detectLang(['zh-CN'])).toBe('zh-TW');
    expect(detectLang(['fr-FR', 'en-GB'])).toBe('en');
    expect(detectLang(['ja'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });

  it('remembers the choice and tolerates broken storage', () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    saveLang('en', store);
    expect(values.get(STORAGE_KEY)).toBe('en');
    expect(loadLang(store)).toBe('en');
    values.set(STORAGE_KEY, 'klingon');
    expect(loadLang(store)).toBeUndefined();
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadLang(broken)).toBeUndefined();
    expect(() => saveLang('zh-TW', broken)).not.toThrow();
    expect(loadLang(undefined)).toBeUndefined();
  });

  it('has every message in both languages', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort());
    for (const lang of ['zh-TW', 'en'] as const)
      for (const key of Object.keys(zhTW) as (keyof typeof zhTW)[]) {
        const text = translate(lang, key, { name: 'x', loaded: 1, total: 2, reason: 'r' });
        expect(text, `${lang} ${key}`).not.toBe('');
        expect(text, `${lang} ${key}`).not.toMatch(/\{\w+\}/);
      }
  });

  it('fills placeholders', () => {
    expect(translate('en', 'loading.map', { name: 'Village' })).toBe('Loading Village…');
    expect(translate('zh-TW', 'loading.models', { loaded: 3, total: 9 })).toBe('模型 3 / 9');
  });
});
