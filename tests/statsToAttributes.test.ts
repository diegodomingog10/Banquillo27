import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATS_MAPPING,
  convertStatsToAttributes,
  leagueScaleFor,
  loadStatsMapping,
  percentileIn,
  probit,
  resolveLeagueStrength,
  type StatsPlayer,
} from '../src/data/statsToAttributes';
import mappingJson from '../src/data/statsMapping.json';

function cohort(n: number, group: StatsPlayer['group'], strength: number, cohortId = 'L1'): StatsPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${cohortId}-${group}-${i}`,
    group,
    cohort: cohortId,
    leagueStrength: strength,
    minutes: 2500,
    stats: {
      pass_completion_pct: 70 + i, // más alto = mejor
      progressive_passes_p90: 2 + i * 0.3,
      passes_completed_p90: 30 + i,
      miscontrols_p90: 3 - i * 0.1, // inversa
      dispossessed_p90: 2 - i * 0.05,
    },
  }));
}

describe('statsToAttributes', () => {
  it('percentil y probit', () => {
    expect(percentileIn([1, 2, 3, 4], 0)).toBe(0);
    expect(percentileIn([1, 2, 3, 4], 5)).toBe(1);
    expect(percentileIn([1, 2, 2, 3], 2)).toBe(0.5);
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.96, 2);
  });
  it('a mejor estadística, mejor atributo (y las inversas al revés)', () => {
    const players = cohort(20, 'CM', 60);
    const res = convertStatsToAttributes(players);
    const worst = res.get('L1-CM-0')!.attributes;
    const best = res.get('L1-CM-19')!.attributes;
    expect(best.passing!).toBeGreaterThan(worst.passing!);
    expect(best.firstTouch!).toBeGreaterThan(worst.firstTouch!); // malos controles: inversa
    for (const v of Object.values(best)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
    }
  });
  it('el mismo percentil vale más en una liga fuerte', () => {
    const strong = convertStatsToAttributes(cohort(20, 'CM', 95, 'S'));
    const weak = convertStatsToAttributes(cohort(20, 'CM', 20, 'W'));
    expect(strong.get('S-CM-19')!.attributes.passing!).toBeGreaterThan(weak.get('W-CM-19')!.attributes.passing!);
    expect(leagueScaleFor(100).mean).toBeGreaterThan(leagueScaleFor(0).mean);
  });
  it('pocos minutos acercan el atributo a la media; muy pocos no convierten', () => {
    const players = cohort(20, 'CM', 60);
    const few = { ...players[19]!, key: 'few', minutes: 400 };
    const none = { ...players[19]!, key: 'none', minutes: 50 };
    const res = convertStatsToAttributes([...players, few, none]);
    expect(res.get('few')!.attributes.passing!).toBeLessThan(res.get('L1-CM-19')!.attributes.passing!);
    expect(res.get('none')!.attributes).toEqual({});
  });
  it('los atributos de portero solo se derivan para porteros', () => {
    const gks: StatsPlayer[] = Array.from({ length: 10 }, (_, i) => ({
      key: `gk${i}`, group: 'GK', cohort: 'L', leagueStrength: 60, minutes: 3000,
      stats: { save_pct: 60 + i * 2, psxg_minus_ga_p90: -0.2 + i * 0.05 },
    }));
    const res = convertStatsToAttributes(gks);
    expect(res.get('gk9')!.attributes.reflexes!).toBeGreaterThan(res.get('gk0')!.attributes.reflexes!);
    const cm = convertStatsToAttributes([{ key: 'x', group: 'CM', cohort: null, leagueStrength: 50, minutes: 3000, stats: { save_pct: 80 } }]);
    expect(cm.get('x')!.attributes.reflexes).toBeUndefined();
  });
  it('avisa de estadísticas desconocidas', () => {
    const res = convertStatsToAttributes([{ key: 'x', group: 'ST', cohort: null, leagueStrength: 50, minutes: 3000, stats: { inventada_p90: 1 } }]);
    expect(res.get('x')!.unknownStats).toEqual(['inventada_p90']);
  });
  it('la tabla por defecto es válida y rechaza estadísticas no declaradas', () => {
    expect(Object.keys(DEFAULT_STATS_MAPPING.attributes).length).toBeGreaterThan(30);
    const bad = structuredClone(mappingJson) as unknown as { attributes: Record<string, unknown> };
    bad.attributes.passing = { outfield: { no_existe: 1 } };
    expect(() => loadStatsMapping(bad)).toThrow(/no declarada/);
  });
  it('fuerza de liga: explícita, por nación y por nivel', () => {
    expect(resolveLeagueStrength(70, 90, 1)).toBe(70);
    expect(resolveLeagueStrength(null, 90, 1)).toBe(90);
    expect(resolveLeagueStrength(null, 90, 2)).toBeCloseTo(72);
    expect(resolveLeagueStrength(null, null, 1)).toBe(50);
  });
});
