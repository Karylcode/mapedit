import { en, zhTW, type Message, type MessageKey, type Params } from './messages.js';

export type Lang = 'zh-TW' | 'en';
export const LANGS: readonly Lang[] = ['zh-TW', 'en'];
export const STORAGE_KEY = 'mapedit.lang';

const dictionaries: Record<Lang, Record<MessageKey, Message>> = { 'zh-TW': zhTW, en };

/** Chinese browsers get Traditional Chinese; everything else gets English. */
export function detectLang(languages: readonly string[]): Lang {
  for (const language of languages) {
    const lower = language.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-TW';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Storage may be missing or throw (private windows, blocked site data). */
export function loadLang(store: StorageLike | undefined = storage()): Lang | undefined {
  try {
    const value = store?.getItem(STORAGE_KEY);
    return LANGS.find((lang) => lang === value);
  } catch {
    return undefined;
  }
}

export function saveLang(lang: Lang, store: StorageLike | undefined = storage()): void {
  try {
    store?.setItem(STORAGE_KEY, lang);
  } catch {
    // The choice still applies to this page; it just is not remembered.
  }
}

export function initialLang(): Lang {
  return loadLang() ?? detectLang(globalThis.navigator?.languages ?? []);
}

export function translate(lang: Lang, key: MessageKey, params: Params = {}): string {
  const message = dictionaries[lang][key] as Message | undefined;
  // Keys can come from server data (kinds, codes); an unknown one shows itself.
  if (message === undefined) return key;
  if (typeof message === 'function') return message(params);
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function hasMessage(key: string): key is MessageKey {
  return key in zhTW;
}

export type Translator = (key: MessageKey, params?: Params) => string;
export type { MessageKey, Params };

/** Translation into one language: the `t` a view renders with. */
export function translator(lang: Lang): Translator {
  return (key, params) => translate(lang, key, params);
}

/** Translation into whatever language `lang()` gives at each call, for code that outlives a render. */
export function liveTranslator(lang: () => Lang): Translator {
  return (key, params) => translate(lang(), key, params);
}
