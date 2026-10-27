import { en } from './en';
import { MORE, MORE_NAMES } from './more';
import { zh } from './zh';

// String tables, after Holy Kicker's (D:\standing\client\src\i18n). English is the source: every
// other table is typed as Table<typeof en>, so a missing or extra key is a compile error. Keys are
// dotted paths checked at compile time: t('menu.turns'). English and Chinese ship in the main
// chunk; the other languages are fetched when picked (more.ts).

export type Locale = 'en' | 'zh' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'pl' | 'ru' | 'ja' | 'ko' | 'vi' | 'tr' | 'th' | 'id';
export const LOCALES: readonly Locale[] = ['en', 'zh', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'vi', 'tr', 'th', 'id'];
export const DEFAULT_LOCALE: Locale = 'en';

export type Table<T> = { [K in keyof T]: T[K] extends string ? string : Table<T[K]> };

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type Key = Paths<typeof en>;

const TABLES: Partial<Record<Locale, Table<typeof en>>> = { en, zh };

/** Fetches `locale`'s table if it is not in hand yet; false when that failed (offline, say). */
export async function loadLocale(locale: Locale): Promise<boolean> {
  if (TABLES[locale]) return true;
  const load = MORE[locale];
  if (!load) return false;
  try {
    TABLES[locale] = await load();
    return true;
  } catch {
    return false;
  }
}

let current: Locale = DEFAULT_LOCALE;

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  document.documentElement.lang = locale;
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * The first supported language in a preference list (the portal's language, navigator.languages);
 * only the base subtag counts ('in', Indonesian's old code, reads as 'id'). English when none.
 */
export function detectLocale(languages: readonly (string | null | undefined)[]): Locale {
  for (const tag of languages) {
    const raw = tag?.split(/[-_]/)[0]?.toLowerCase();
    const base = raw === 'in' ? 'id' : raw;
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

function lookup(key: string, locale: Locale): string {
  let node: unknown = TABLES[locale] ?? TABLES.en;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return key;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : key;
}

/** The text for `key` in the current locale, with {name} placeholders filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const text = lookup(key, current);
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** A language's own name for itself, for the language picker. */
export function localeName(locale: Locale): string {
  return TABLES[locale]?.lang.name ?? MORE_NAMES[locale] ?? en.lang.name;
}
