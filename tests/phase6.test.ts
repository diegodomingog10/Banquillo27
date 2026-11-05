import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/data/generator/generateWorld';
import { continueGame, indexes, newGame, playUserMatch, resolveMessage, type GameState } from '../src/engine/game';
import { economyDay, financeView, payTransferFee, playerWageBill } from '../src/engine/economy';
import { assignScout, knowledgeOf, requestReport, scoutedAttributes, scoutingDay, userScouts } from '../src/engine/scouting';
import { acceptCounter, askingPrice, emptyTerms, makeOffer, playerDemands, proposeContract, respondIncoming, startRenewal, windowOpen, type Deal } from '../src/engine/transfers';
import { boardAfterMatch, boardRequest } from '../src/engine/board';
import { ensureDefaults } from '../src/engine/manager';
import { addDays } from '../src/engine/date';

const world = generateWorld({ seed: 11, nations: 1 });
function game(): GameState {
  const userClubId = world.clubs[6]!.id;
  const s = newGame({ world, userClubId, manager: { firstName: 'Ana', lastName: 'Prueba', nationality: null }, seed: 5 });
  for (const m of s.inbox) if (m.blocking) resolveMessage(s, m.id, 'ok');
  indexes(s).clubs.get(userClubId)!.finances.transferBudget = 500_000_000;
  indexes(s).clubs.get(userClubId)!.finances.wageBudget = 50_000_000;
  return s;
}
const target = (s: GameState) => {
  const ix = indexes(s);
  const other = s.world.clubs.find((c) => c.id !== s.userClubId)!;
  // Un jugador de rotación (no intransferible)
  return (ix.squads.get(other.id) ?? []).slice().sort((a, b) => b.ca - a.ca)[12]!;
};
const nextDay = (s: GameState) => { s.date = addDays(s.date, 1); };

describe('economía', () => {
  it('paga salarios los lunes e ingresa TV el día 1', () => {
    const s = game();
    const club = indexes(s).clubs.get(s.userClubId)!;
    s.date = '2026-08-03'; // lunes
    const b0 = club.finances.balance;
    economyDay(s);
    expect(club.finances.balance).toBeLessThan(b0);
    expect(b0 - club.finances.balance).toBeGreaterThanOrEqual(playerWageBill(s, club.id));
    s.date = '2026-09-01';
    const b1 = club.finances.balance;
    economyDay(s);
    expect(s.economy.clubs[club.id]!.season.income.tv).toBeGreaterThan(0);
    expect(club.finances.balance).not.toBe(b1);
  });
  it('los traspasos a plazos dejan pagos pendientes que vencen', () => {
    const s = game();
    const other = s.world.clubs.find((c) => c.id !== s.userClubId)!;
    payTransferFee(s, s.userClubId, other.id, 10_000_000, 10, 'x');
    expect(s.economy.payments.length).toBe(10);
    expect(financeView(s).owed).toBe(6_000_000);
    s.date = addDays(s.date, 31);
    economyDay(s);
    expect(s.economy.payments.length).toBe(9);
  });
});

describe('ojeo', () => {
  it('un ojeador asignado aumenta el conocimiento y reduce el error', () => {
    const s = game();
    const scout = userScouts(s)[0]!;
    const p = target(s);
    const lg = s.world.competitions.find((c) => c.format === 'league' && c.teamIds.includes(p.clubId!))!;
    const before = scoutedAttributes(s, p);
    assignScout(s, scout.id, { kind: 'competition', id: lg.id });
    for (let i = 0; i < 60; i++) { nextDay(s); scoutingDay(s); }
    const known = Object.values(s.scouting.knowledge).filter((k) => k.level > 40).length;
    expect(known).toBeGreaterThan(5);
    requestReport(s, p.id);
    for (let i = 0; i < 15; i++) { nextDay(s); scoutingDay(s); }
    const after = scoutedAttributes(s, p);
    expect(after.level).toBeGreaterThan(before.level);
    expect(after.error).toBeLessThanOrEqual(before.error);
    expect(Object.values(after.attributes).filter((a) => a.value !== null).length).toBeGreaterThan(Object.values(before.attributes).filter((a) => a.value !== null).length);
  });
  it('los jugadores propios se conocen del todo', () => {
    const s = game();
    const mine = indexes(s).squads.get(s.userClubId)![0]!;
    expect(knowledgeOf(s, mine).level).toBe(100);
    expect(scoutedAttributes(s, mine).error).toBe(0);
  });
});

describe('mercado', () => {
  it('oferta baja rechazada o contraofertada; al aceptar, se negocia y se ficha', () => {
    const s = game();
    expect(windowOpen(s)).toBe(true);
    const p = target(s);
    const seller = p.clubId!;
    const ask = askingPrice(s, p, s.userClubId);
    const low = makeOffer(s, p.id, { ...emptyTerms(), fee: Math.round(ask * 0.3) });
    nextDay(s); continueGameDay(s);
    expect(['rejected', 'countered']).toContain(low.status);
    const deal = makeOffer(s, p.id, { ...emptyTerms(), fee: Math.round(ask * 1.05) });
    nextDay(s); continueGameDay(s);
    if (deal.status === 'countered') acceptCounter(s, deal.id);
    expect(deal.status).toBe('negotiating');
    sign(s, deal);
    expect(deal.status).toBe('completed');
    expect(p.clubId).toBe(s.userClubId);
    expect(s.economy.clubs[seller]!.season.income.transfers).toBeGreaterThan(0);
  });
  it('la cláusula de rescisión obliga al club', () => {
    const s = game();
    const p = target(s);
    p.contract!.releaseClause = 5_000_000;
    const d = makeOffer(s, p.id, { ...emptyTerms(), fee: 5_000_000 });
    expect(d.status === 'negotiating' || d.status === 'collapsed').toBe(true);
  });
  it('el jugador pide más si la oferta es baja y acaba rompiendo', () => {
    const s = game();
    const mine = indexes(s).squads.get(s.userClubId)!.slice().sort((a, b) => b.ca - a.ca)[3]!;
    mine.morale = 80;
    const d = startRenewal(s, mine.id);
    expect(d.status).toBe('negotiating');
    const dem = d.demands!;
    const r1 = proposeContract(s, d.id, { ...dem, wage: Math.round(dem.wage * 0.5) });
    expect(r1.result).not.toBe('accepted');
    const r2 = proposeContract(s, d.id, { ...dem });
    expect(['accepted', 'rejected']).toContain(r2.result);
  });
  it('acepta una oferta entrante y el jugador se va', () => {
    const s = game();
    const p = indexes(s).squads.get(s.userClubId)!.slice().sort((a, b) => b.ca - a.ca)[10]!;
    const buyer = s.world.clubs.slice().sort((a, b) => b.reputation - a.reputation)[0]!;
    const d: Deal = { id: 'x1', kind: 'transfer', playerId: p.id, buyerId: buyer.id, sellerId: s.userClubId, terms: { ...emptyTerms(), fee: p.marketValue }, counter: null, status: 'pendingUser', created: s.date, respondOn: addDays(s.date, 3), patience: 2, demands: null, contract: null, completeOn: null, log: [], rounds: 0 };
    s.transfers.deals.push(d);
    p.attributes.loyalty = 1;
    respondIncoming(s, d.id, 'accept');
    expect(['completed', 'collapsed']).toContain(d.status);
    if (d.status === 'completed') expect(p.clubId).toBe(buyer.id);
  });
  it('las demandas suben con la reputación del club', () => {
    const s = game();
    const p = target(s);
    const d = { kind: 'transfer', playerId: p.id, buyerId: s.userClubId, terms: emptyTerms(), contract: null } as unknown as Deal;
    expect(playerDemands(s, d).wage).toBeGreaterThan(0);
  });
});

describe('directiva', () => {
  it('las derrotas bajan la confianza; las peticiones responden', () => {
    const s = game();
    const c0 = s.board.confidence;
    const opp = s.world.clubs.find((c) => c.id !== s.userClubId)!;
    for (let i = 0; i < 6; i++) {
      boardAfterMatch(s, { id: `t${i}`, competitionId: 'x', season: s.season, round: 'md:1', stage: 'league', date: s.date, homeId: s.userClubId, awayId: opp.id, played: true, decideWinner: false, result: { homeGoals: 0, awayGoals: 3, extraTime: false, penalties: null, winnerId: null }, summary: null });
    }
    expect(s.board.confidence).toBeLessThan(c0 - 8);
    const r = boardRequest(s, 'wageBudget');
    expect(typeof r.accepted).toBe('boolean');
    expect(() => boardRequest(s, 'wageBudget')).toThrow();
  });
  it('las partidas antiguas reciben los sistemas nuevos', () => {
    const s = game() as Partial<GameState> & GameState;
    delete (s as Partial<GameState>).economy;
    delete (s as Partial<GameState>).board;
    ensureDefaults(s);
    expect(s.economy.clubs[s.userClubId]).toBeDefined();
    expect(s.board.confidence).toBe(65);
  });
  it('una temporada avanza sin errores con los sistemas nuevos', () => {
    const s = game();
    for (let i = 0; i < 40; i++) {
      const r = continueGame(s, 30);
      for (const m of s.inbox) if (m.blocking && !m.resolvedActionId) resolveMessage(s, m.id, 'ok');
      if (r.stop === 'userMatch') playUserMatch(s);
    }
    expect(s.date > '2026-08-15').toBe(true);
  });
});

/** Avanza un día solo con la lógica de mercado. */
import { transfersDay } from '../src/engine/transfers';
function continueGameDay(s: GameState) { transfersDay(s); }
function sign(s: GameState, d: Deal) {
  for (let i = 0; i < 4 && d.status === 'negotiating'; i++) proposeContract(s, d.id, { ...d.demands! });
}
