/**
 * Integración: cinco temporadas completas sin errores ni valores fuera de rango
 * (atributos, CA/PA, condición, moral, dinero, plantillas, calendario).
 */
import { describe, expect, it } from 'vitest';
import { ALL_ATTRS } from '../src/data/attributes';
import { generateWorld } from '../src/data/generator/generateWorld';
import { continueGame, hasBlocking, newGame, playUserMatch, resolveMessage, type GameState } from '../src/engine/game';
import { respondIncoming } from '../src/engine/transfers';

function check(s: GameState, label: string): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const p of s.world.players) {
    if (ids.has(p.id)) errs.push(`${label}: jugador duplicado ${p.id}`);
    ids.add(p.id);
    for (const a of ALL_ATTRS) {
      const v = (p.attributes as Record<string, number>)[a]!;
      if (!Number.isInteger(v) || v < 1 || v > 20) errs.push(`${label}: ${p.id}.${a}=${v}`);
    }
    if (p.ca < 1 || p.ca > 200 || p.pa < p.ca || p.pa > 200) errs.push(`${label}: ${p.id} CA/PA ${p.ca}/${p.pa}`);
    if (!(p.condition >= 0 && p.condition <= 100)) errs.push(`${label}: ${p.id} condición ${p.condition}`);
    if (!(p.morale >= 5 && p.morale <= 100)) errs.push(`${label}: ${p.id} moral ${p.morale}`);
    if (!Number.isFinite(p.marketValue) || p.marketValue < 0) errs.push(`${label}: ${p.id} valor ${p.marketValue}`);
    if (p.clubId && !p.contract) errs.push(`${label}: ${p.id} con club y sin contrato`);
    if (p.injury && p.injury.daysRemaining < 0) errs.push(`${label}: ${p.id} lesión negativa`);
  }
  for (const c of s.world.clubs) {
    if (!Number.isFinite(c.finances.balance) || !Number.isFinite(c.finances.transferBudget) || c.finances.transferBudget < 0) errs.push(`${label}: finanzas de ${c.id}`);
    const n = s.world.players.filter((p) => p.clubId === c.id).length;
    if (c.id !== s.userClubId && (n < 16 || n > 32)) errs.push(`${label}: plantilla de ${c.id} con ${n}`);
  }
  if (!(s.board.confidence >= 0 && s.board.confidence <= 100)) errs.push(`${label}: confianza ${s.board.confidence}`);
  return errs;
}

describe('integración', () => {
  it('cinco temporadas completas sin errores ni valores fuera de rango', () => {
    const world = generateWorld({ seed: 31, nations: 1 });
    const s = newGame({ world, userClubId: world.clubs[3]!.id, manager: { firstName: 'Ana', lastName: 'Prueba', nationality: null }, seed: 77 });
    let seasons = 0;
    let guard = 0;
    const errors: string[] = [];
    while (seasons < 5 && guard++ < 5000) {
      if (hasBlocking(s)) for (const m of s.inbox) if (m.blocking && !m.resolvedActionId) resolveMessage(s, m.id, 'ok');
      for (const d of s.transfers.deals) if (d.status === 'pendingUser') respondIncoming(s, d.id, 'reject');
      // El usuario renueva a todos para que la plantilla no se vacíe
      for (const p of s.world.players) if (p.clubId === s.userClubId && p.contract && p.contract.expires <= s.calendar.end) p.contract.expires = `${s.seasonYear + 2}-06-30`;
      if (s.board.fired) break;
      const r = continueGame(s);
      if (r.stop === 'userMatch') playUserMatch(s);
      if (r.stop === 'seasonEnd') {
        const left = s.fixtures.filter((f) => !f.played && f.date <= s.date);
        if (left.length) errors.push(`temporada ${s.season}: ${left.length} partidos sin jugar`);
      }
      if (r.stop === 'newSeason') { seasons++; errors.push(...check(s, s.season)); }
    }
    expect(errors.slice(0, 10)).toEqual([]);
    expect(seasons === 5 || s.board.fired).toBe(true);
    expect(s.history.length).toBeGreaterThanOrEqual(seasons);
  }, 900_000);
});
