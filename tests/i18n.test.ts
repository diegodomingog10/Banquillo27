import { describe, expect, it } from 'vitest';
import { ALL_ATTRS } from '../src/data/attributes';
import { POSITIONS } from '../src/data/positions';
import { ROLES } from '../src/data/roles';
import { PersonalityType } from '../src/data/schema';
import { t } from '../src/i18n';

describe('i18n', () => {
  it('todas las claves de datos tienen traducción', () => {
    for (const a of ALL_ATTRS) expect(t(`attr.${a}`)).not.toBe(`attr.${a}`);
    for (const p of POSITIONS) expect(t(`pos.${p}`)).not.toBe(`pos.${p}`);
    for (const r of ROLES) expect(t(`role.${r.id}`)).not.toBe(`role.${r.id}`);
    for (const p of PersonalityType.options) expect(t(`personality.${p}`)).not.toBe(`personality.${p}`);
  });
  it('interpola variables', () => {
    expect(t('generator.done', { ms: 12 })).toBe('Mundo generado en 12 ms');
  });
});
