// ponytail: two languages inline. Move to per-locale JSON files when a third one lands.
export interface L {
  en: string;
  es: string;
}

const locale = (): string =>
  process.env.ALLINBOX_LANG ?? process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale ?? 'en';

export const lang: keyof L = locale().toLowerCase().startsWith('es') ? 'es' : 'en';

export const tr = (text: L): string => text[lang];

/** Yes/no answers in both languages; empty answer takes the default. */
export const isYes = (answer: string, fallback: boolean): boolean =>
  answer === '' ? fallback : /^(y|yes|s|si|sí)$/i.test(answer.trim());
