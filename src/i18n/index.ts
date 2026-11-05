import { es, type Dictionary } from './es';

const dictionaries: Record<string, Dictionary> = { es };
let current: Dictionary = es;

export function setLanguage(lang: string): void {
  current = dictionaries[lang] ?? es;
}

export function registerLanguage(lang: string, dict: Dictionary): void {
  dictionaries[lang] = dict;
}

/** Traduce una clave con puntos ("attr.passing") e interpola {variables}. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let node: unknown = current;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) node = (node as Record<string, unknown>)[part];
    else return key;
  }
  if (typeof node !== 'string') return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

export { es };
