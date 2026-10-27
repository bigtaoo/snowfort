import type { en } from './en';
import type { Locale, Table } from './index';

// The languages past English and Chinese, each its own chunk fetched when a player picks it (or
// the platform asks for it at boot), so the first screen does not wait for thirteen tables.
type Loader = () => Promise<Table<typeof en>>;

export const MORE: Partial<Record<Locale, Loader>> = {
  de: () => import('./de').then((m) => m.de),
  fr: () => import('./fr').then((m) => m.fr),
  es: () => import('./es').then((m) => m.es),
  it: () => import('./it').then((m) => m.it),
  pt: () => import('./pt').then((m) => m.pt),
  pl: () => import('./pl').then((m) => m.pl),
  ru: () => import('./ru').then((m) => m.ru),
  ja: () => import('./ja').then((m) => m.ja),
  ko: () => import('./ko').then((m) => m.ko),
  vi: () => import('./vi').then((m) => m.vi),
  tr: () => import('./tr').then((m) => m.tr),
  th: () => import('./th').then((m) => m.th),
  id: () => import('./id').then((m) => m.id),
};

/** Each language's own name for the picker, before its table is fetched (its `lang.name`). */
export const MORE_NAMES: Partial<Record<Locale, string>> = {
  de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português', pl: 'Polski', ru: 'Русский',
  ja: '日本語', ko: '한국어', vi: 'Tiếng Việt', tr: 'Türkçe', th: 'ไทย', id: 'Bahasa Indonesia',
};
