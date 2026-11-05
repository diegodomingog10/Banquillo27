import { describe, expect, it } from 'vitest';
import { buildSeasonCalendar, inRanges, leagueDates, nthWeekday, roundRobin, weekday } from '../src/engine/calendar';
import { computeStandings } from '../src/engine/standings';
import { createRng } from '../src/engine/rng';

describe('calendario', () => {
  it('liga a doble vuelta: cada equipo juega contra todos dos veces, una en casa y otra fuera', () => {
    const teams = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const rounds = roundRobin(teams, 2, createRng(1));
    expect(rounds).toHaveLength(38);
    for (const r of rounds) {
      expect(r).toHaveLength(10);
      const seen = new Set(r.flat());
      expect(seen.size).toBe(20);
    }
    const pairs = new Map<string, number>();
    for (const r of rounds) for (const [h, a] of r) pairs.set(`${h}>${a}`, (pairs.get(`${h}>${a}`) ?? 0) + 1);
    expect(pairs.size).toBe(380);
    for (const v of pairs.values()) expect(v).toBe(1);
    // equilibrio local/visitante
    for (const t of teams) {
      const home = rounds.flat().filter(([h]) => h === t).length;
      expect(home).toBe(19);
    }
  });
  it('número impar de equipos: descansa uno por jornada', () => {
    const rounds = roundRobin(['a', 'b', 'c', 'd', 'e'], 1, createRng(2));
    expect(rounds).toHaveLength(5);
    for (const r of rounds) expect(r).toHaveLength(2);
  });
  it('fechas: en el día preferido, fuera de parones, y con jornadas entre semana si no caben', () => {
    const cal = buildSeasonCalendar(2026);
    const blocked = [...cal.internationalBreaks, { from: '2026-12-19', to: '2027-01-10' }];
    const dates = leagueDates('2026-08-15', '2027-05-30', 38, 6, blocked);
    expect(dates).toHaveLength(38);
    expect(new Set(dates).size).toBe(38);
    for (const d of dates) expect(inRanges(d, blocked)).toBe(false);
    expect(dates.filter((d) => weekday(d) === 3).length).toBeGreaterThan(0);
    expect([...dates].sort()).toEqual(dates);
  });
  it('n-ésimo día de la semana', () => {
    expect(weekday(nthWeekday(2026, 9, 6, 2))).toBe(6);
    expect(nthWeekday(2026, 9, 6, 2).slice(0, 7)).toBe('2026-09');
    expect(weekday(nthWeekday(2027, 3, 6, -1))).toBe(6);
  });
});

describe('clasificación', () => {
  const rules = { pointsForWin: 3, pointsForDraw: 1, tiebreakers: ['points', 'goalDifference', 'goalsFor', 'headToHeadPoints'] as const };
  it('suma puntos y ordena por los criterios', () => {
    const t = computeStandings(['a', 'b', 'c'], [
      { homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0 },
      { homeId: 'b', awayId: 'c', homeGoals: 1, awayGoals: 1 },
      { homeId: 'c', awayId: 'a', homeGoals: 3, awayGoals: 0 },
    ], { ...rules, tiebreakers: [...rules.tiebreakers] });
    expect(t.map((r) => r.clubId)).toEqual(['c', 'a', 'b']);
    expect(t[0]).toMatchObject({ points: 4, gf: 4, ga: 1, won: 1, drawn: 1, played: 2 });
    expect(t[2]!.form).toEqual(['L', 'D']);
  });
  it('empate a puntos y diferencia: decide el enfrentamiento directo si va antes', () => {
    const results = [
      { homeId: 'a', awayId: 'b', homeGoals: 1, awayGoals: 0 },
      { homeId: 'b', awayId: 'c', homeGoals: 3, awayGoals: 0 },
      { homeId: 'c', awayId: 'a', homeGoals: 1, awayGoals: 0 },
    ];
    const h2hFirst = computeStandings(['a', 'b', 'c'], results, { pointsForWin: 3, pointsForDraw: 1, tiebreakers: ['points', 'headToHeadPoints', 'goalDifference'] });
    expect(h2hFirst.map((r) => r.points)).toEqual([3, 3, 3]);
    const gdFirst = computeStandings(['a', 'b', 'c'], results, { pointsForWin: 3, pointsForDraw: 1, tiebreakers: ['points', 'goalDifference'] });
    expect(gdFirst[0]!.clubId).toBe('b');
  });
});
