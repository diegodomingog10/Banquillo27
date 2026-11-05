import { describe, expect, it } from 'vitest';
import { computeCA, derivePersonality, estimateMarketValue, estimatePA } from '../src/data/ability';
import { ALL_ATTRS, type FlatAttributes } from '../src/data/attributes';
import { ROLES, roleSuitability } from '../src/data/roles';

const flat = (v: number): FlatAttributes => Object.fromEntries(ALL_ATTRS.map((a) => [a, v])) as FlatAttributes;

describe('habilidad, potencial y roles', () => {
  it('CA es 10 × nivel medio y está acotada', () => {
    expect(computeCA(flat(10), 'CM')).toBe(100);
    expect(computeCA(flat(20), 'ST')).toBe(200);
    expect(computeCA(flat(1), 'GK')).toBe(10);
  });
  it('la PA nunca es menor que la CA y crece en jóvenes', () => {
    const base = { ca: 100, leagueStrength: 60, professionalism: 12, determination: 12, ambition: 12 };
    expect(estimatePA({ ...base, age: 33 })).toBeGreaterThanOrEqual(100);
    expect(estimatePA({ ...base, age: 18 })).toBeGreaterThan(estimatePA({ ...base, age: 23 }));
    expect(estimatePA({ ...base, ca: 199, age: 17 })).toBeLessThanOrEqual(200);
  });
  it('personalidad derivada', () => {
    expect(derivePersonality({ ...flat(10), professionalism: 20, determination: 18, ambition: 16, loyalty: 16, temperament: 16 })).toBe('modelCitizen');
    expect(derivePersonality(flat(10))).toBe('balanced');
  });
  it('valor de mercado crece con la CA', () => {
    const v = (ca: number) => estimateMarketValue({ ca, pa: ca, age: 26, contractYears: 3, clubReputation: 5000 });
    expect(v(160)).toBeGreaterThan(v(120));
  });
  it('hay al menos 25 roles con atributos válidos', () => {
    expect(ROLES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ROLES.map((r) => r.id)).size).toBe(ROLES.length);
    for (const r of ROLES) {
      const s = roleSuitability(flat(12), r);
      expect(s).toBeCloseTo(12);
    }
  });
});
