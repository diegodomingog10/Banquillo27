import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/data/generator/generateWorld';
import { WorldDatabase } from '../src/data/schema';
import { verifyDatabase } from '../src/data/verify';
import { computeCA, mainPosition } from '../src/data/ability';

const world = generateWorld({ seed: 2026 });

describe('generador de mundo ficticio', () => {
  it('cumple el esquema Zod', () => {
    const r = WorldDatabase.safeParse(world);
    if (!r.success) console.error(r.error.issues.slice(0, 5));
    expect(r.success).toBe(true);
  });
  it('crea 8 naciones con 2 divisiones de 20 equipos y plantillas de 25', () => {
    expect(world.nations).toHaveLength(8);
    const leagues = world.competitions.filter((c) => c.format === 'league');
    expect(leagues).toHaveLength(16);
    for (const l of leagues) expect(l.teamIds).toHaveLength(20);
    const bySquad = new Map<string, number>();
    for (const p of world.players) if (p.clubId) bySquad.set(p.clubId, (bySquad.get(p.clubId) ?? 0) + 1);
    for (const c of world.clubs) expect(bySquad.get(c.id)).toBe(25);
    expect(world.players.some((p) => p.clubId === null)).toBe(true);
  });
  it('incluye copas nacionales y torneos continentales', () => {
    expect(world.competitions.filter((c) => c.format === 'cup')).toHaveLength(8);
    const cont = world.competitions.filter((c) => c.format === 'groupCup');
    expect(cont).toHaveLength(2);
    for (const c of cont) expect(c.teamIds).toHaveLength(32);
  });
  it('pasa la verificación sin errores ni avisos', () => {
    const r = verifyDatabase(world);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('es determinista con la misma semilla y distinto con otra', () => {
    const again = generateWorld({ seed: 2026, nations: 2 });
    const same = generateWorld({ seed: 2026, nations: 2 });
    const other = generateWorld({ seed: 2027, nations: 2 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(same));
    expect(other.players[0]?.lastName + String(other.players[0]?.ca)).not.toBe(again.players[0]?.lastName + String(again.players[0]?.ca));
  });
  it('CA coherente con atributos y PA >= CA', () => {
    for (const p of world.players) {
      expect(p.pa).toBeGreaterThanOrEqual(p.ca);
      expect(computeCA(p.attributes, mainPosition(p.positions))).toBe(p.ca);
    }
  });
  it('la calidad sigue a la reputación del club', () => {
    const avgCa = (clubId: string) => {
      const ps = world.players.filter((p) => p.clubId === clubId).map((p) => p.ca).sort((a, b) => b - a).slice(0, 11);
      return ps.reduce((a, b) => a + b, 0) / ps.length;
    };
    const sorted = world.clubs.slice().sort((a, b) => b.reputation - a.reputation);
    const top = sorted.slice(0, 10).map((c) => avgCa(c.id));
    const bottom = sorted.slice(-10).map((c) => avgCa(c.id));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(top)).toBeGreaterThan(145);
    expect(mean(bottom)).toBeLessThan(80);
  });
  it('no usa nombres repetidos de club', () => {
    expect(new Set(world.clubs.map((c) => c.name)).size).toBe(world.clubs.length);
  });
  it('genera el mundo completo en menos de 3 s', () => {
    const t0 = performance.now();
    generateWorld({ seed: 1 });
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
