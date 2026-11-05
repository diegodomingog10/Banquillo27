/// <reference lib="webworker" />
/**
 * Worker de partida: guarda el estado completo del juego y ejecuta el bucle de tiempo
 * y los partidos sin bloquear la interfaz. El hilo principal solo recibe vistas.
 */
import { matchKits } from '../data/kits';
import { generateWorld } from '../data/generator/generateWorld';
import type { WorldDatabase } from '../data/schema';
import { continueGame, markRead, newGame, playUserMatch, prepareUserMatch, resolveMessage, type GameState, type Manager } from '../engine/game';
import { LiveMatch, NARRATOR_NAMES } from '../engine/liveMatch';
import type { MatchCommand } from '../engine/matchEngine';
import { answerPress, skipPress } from '../engine/postMatch';
import { competitionView, competitionsList, dashboardView, inboxView, matchView, preMatchView, squadView } from '../engine/views';
import { clubView, opponentAnalysis, playerProfile, search, squadTable, tacticsView } from '../engine/profileViews';
import { setUserLineup, setUserTactic, type DashboardTile, type SquadView } from '../engine/manager';
import type { TeamTactic } from '../engine/tactics';
import { adjustBudgets, financeView, setTicketPrice } from '../engine/economy';
import { assignScout, requestReport, scoutingView, type ScoutAssignment } from '../engine/scouting';
import { acceptCounter, dealView, exerciseBuyOption, makeOffer, playerDemands, proposeContract, respondIncoming, setListed, startRenewal, transfersView, withdrawDeal, type ContractTerms, type OfferTerms } from '../engine/transfers';
import { acceptJob, boardRequest, boardView, type BoardRequestKind } from '../engine/board';
import { marketSearch, type MarketFilter } from '../engine/market';
import { setIndividualTraining, setTrainingPlan, type IndividualFocus, type TrainingPlan } from '../engine/training';
import { dressingView, talkToPlayer, teamMeeting, type PlayerTalk, type TeamTalk } from '../engine/dressingRoom';
import { awardsView, trainingView } from '../engine/clubLifeViews';
import { deadlineStep, deadlineView } from '../engine/aiClubs';
import { careerView, playersDataView, teamDataView, worldView } from '../engine/dataHub';
import type { Position } from '../data/positions';
import { deleteSave, deserializeGame, listSaves, loadGame, saveGame, serializeGame } from '../store/saves';

let state: GameState | null = null;
let live: { match: LiveMatch; fixtureId: string } | null = null;
let autosave = true;

function need(): GameState {
  if (!state) throw new Error('No hay ninguna partida cargada');
  return state;
}

export const api = {
  async newGame(p: { world: WorldDatabase | { generate: { seed: number; nations: number } }; userClubId: string; manager: Manager; seed: number }) {
    const world = 'generate' in p.world ? generateWorld(p.world.generate) : p.world;
    state = newGame({ world, userClubId: p.userClubId, manager: p.manager, seed: p.seed });
    return dashboardView(state);
  },
  /** Lista de clubes por liga para elegir equipo (sin crear la partida). */
  async previewWorld(p: { world: WorldDatabase | { generate: { seed: number; nations: number } } }) {
    const world = 'generate' in p.world ? generateWorld(p.world.generate) : p.world;
    return {
      nations: world.nations.map((n) => ({ id: n.id, name: n.name })),
      leagues: world.competitions.filter((c) => c.format === 'league').map((c) => ({
        id: c.id, name: c.name, nationId: c.nationId, level: c.level,
        clubs: c.teamIds.map((id) => world.clubs.find((x) => x.id === id)!).filter(Boolean)
          .map((x) => ({ id: x.id, name: x.name, reputation: x.reputation, budget: x.finances.transferBudget }))
          .sort((a, b) => b.reputation - a.reputation),
      })),
    };
  },
  async continue() {
    const s = need();
    const result = continueGame(s);
    return { result, dashboard: dashboardView(s) };
  },
  async playMatch() {
    const s = need();
    live = null;
    const { fixture } = playUserMatch(s);
    if (autosave) await saveGame(s, { auto: true }).catch(() => undefined);
    return { match: matchView(s, fixture.id), dashboard: dashboardView(s) };
  },
  /** Empieza (o retoma) el partido del usuario en directo. */
  async liveStart(p?: { assistant?: boolean }) {
    const s = need();
    const prep = prepareUserMatch(s);
    if (!live || live.fixtureId !== prep.fixture.id) live = { match: new LiveMatch(prep.input, prep.userSide, p?.assistant ?? false), fixtureId: prep.fixture.id };
    const home = s.world.clubs.find((c) => c.id === prep.fixture.homeId)!;
    const away = s.world.clubs.find((c) => c.id === prep.fixture.awayId)!;
    return {
      fixtureId: prep.fixture.id,
      userSide: prep.userSide,
      home: { id: home.id, name: home.name, primary: home.colors.primary, secondary: home.colors.secondary },
      away: { id: away.id, name: away.name, primary: away.colors.primary, secondary: away.colors.secondary },
      stadium: home.stadium.name,
      kits: matchKits(home, away),
      narrator: NARRATOR_NAMES[live.match.narrator],
      tick: live.match.tick({ phases: 1 }),
    };
  },
  async liveTick(p: { phases?: number; untilKey?: boolean; toEnd?: boolean }) {
    if (!live) throw new Error('No hay partido en directo');
    return live.match.tick(p);
  },
  async liveCommand(p: { cmd: MatchCommand }) {
    if (!live) throw new Error('No hay partido en directo');
    live.match.command(p.cmd);
    return true;
  },
  async liveAssistant(p: { on: boolean }) {
    if (!live) throw new Error('No hay partido en directo');
    live.match.setAssistant(p.on);
    return true;
  },
  /** Termina el partido en directo y aplica todas sus consecuencias en la partida. */
  async liveFinish() {
    const s = need();
    if (!live) throw new Error('No hay partido en directo');
    const result = live.match.result();
    live = null;
    playUserMatch(s, result);
    if (autosave) await saveGame(s, { auto: true }).catch(() => undefined);
    return { dashboard: dashboardView(s) };
  },
  async postMatch() {
    const s = need();
    if (!s.postMatch) return null;
    return { post: s.postMatch, match: matchView(s, s.postMatch.fixtureId) };
  },
  async pressAnswer(p: { questionId: string; optionId: string }) { return answerPress(need(), p.questionId, p.optionId); },
  async pressSkip() { return skipPress(need()); },
  async dashboard() { return dashboardView(need()); },
  async inbox() { return inboxView(need()); },
  async resolveMessage(p: { id: string; actionId: string | null }) {
    const s = need();
    const m = s.inbox.find((x) => x.id === p.id);
    const action = m?.actions.find((a) => a.id === p.actionId);
    const dealId = action?.payload.dealId as string | undefined;
    // Ofertas por jugadores propios: aceptar o rechazar desde la bandeja
    if (dealId && (p.actionId === 'accept' || p.actionId === 'reject')) {
      const d = s.transfers.deals.find((x) => x.id === dealId);
      if (d?.status === 'pendingUser') respondIncoming(s, dealId, p.actionId);
    }
    if (p.actionId !== 'negotiate') resolveMessage(s, p.id, p.actionId);
    else markRead(s, p.id);
    return dashboardView(s);
  },
  async markRead(p: { id: string }) { markRead(need(), p.id); return true; },
  async competitions() { return competitionsList(need()); },
  async competition(p: { id: string }) { return competitionView(need(), p.id); },
  async match(p: { id: string }) { return matchView(need(), p.id); },
  async preMatch(p: { id: string }) { return preMatchView(need(), p.id); },
  async squad() { return squadView(need()); },
  async player(p: { id: string }) { return playerProfile(need(), p.id); },
  async squadTable(p?: { clubId?: string }) { return squadTable(need(), p?.clubId); },
  async tactics() { return tacticsView(need()); },
  async setTactic(p: { tactic: TeamTactic }) { setUserTactic(need(), p.tactic); return tacticsView(need()); },
  async setLineup(p: { starting: string[]; bench: string[] }) { setUserLineup(need(), p); return tacticsView(need()); },
  async resetLineup() { need().userLineup = null; return tacticsView(need()); },
  async opponent(p: { clubId: string }) { return opponentAnalysis(need(), p.clubId); },
  async search(p: { q: string }) { return search(need(), p.q); },
  async club(p: { id: string }) { return clubView(need(), p.id); },
  async ui() { return need().ui; },
  // ---------------------------------------------------------------- Fase 6
  async finances() { return financeView(need()); },
  async adjustBudgets(p: { weekly: number }) { adjustBudgets(need(), p.weekly); return financeView(need()); },
  async setTicketPrice(p: { price: number }) { setTicketPrice(need(), p.price); return financeView(need()); },
  async scouting() { return scoutingView(need()); },
  async assignScout(p: { scoutId: string; target: ScoutAssignment['target'] | null; focus?: ScoutAssignment['focus'] }) { assignScout(need(), p.scoutId, p.target, p.focus); return scoutingView(need()); },
  async requestReport(p: { playerId: string }) { return requestReport(need(), p.playerId); },
  async transfers() { return transfersView(need()); },
  async market(p: { filter: MarketFilter }) { return marketSearch(need(), p.filter); },
  async makeOffer(p: { playerId: string; terms: OfferTerms }) { return dealView(need(), makeOffer(need(), p.playerId, p.terms)); },
  async acceptCounter(p: { dealId: string }) { return dealView(need(), acceptCounter(need(), p.dealId)); },
  async withdrawDeal(p: { dealId: string }) { withdrawDeal(need(), p.dealId); return transfersView(need()); },
  async renewal(p: { playerId: string }) { return dealView(need(), startRenewal(need(), p.playerId)); },
  async deal(p: { dealId: string }) {
    const s = need();
    const d = s.transfers.deals.find((x) => x.id === p.dealId);
    if (!d) return null;
    return { ...dealView(s, d), demands: d.status === 'negotiating' ? d.demands ?? playerDemands(s, d) : d.demands };
  },
  async proposeContract(p: { dealId: string; terms: ContractTerms }) {
    const s = need();
    const r = proposeContract(s, p.dealId, p.terms);
    return { result: r.result, text: r.text, demands: r.demands, deal: dealView(s, r.deal), dashboard: dashboardView(s) };
  },
  async respondIncoming(p: { dealId: string; answer: 'accept' | 'reject' | { counterFee: number } }) { const s = need(); return { deal: dealView(s, respondIncoming(s, p.dealId, p.answer)), dashboard: dashboardView(s) }; },
  async setListed(p: { playerId: string; listing: { asking: number | null; loan: boolean } | null }) { setListed(need(), p.playerId, p.listing); return true; },
  async exerciseOption(p: { playerId: string }) { exerciseBuyOption(need(), p.playerId); return dashboardView(need()); },
  async board() { return boardView(need()); },
  // ---------------------------------------------------------------- Fase 7
  async training() { return trainingView(need()); },
  async setTrainingPlan(p: { plan: TrainingPlan }) { setTrainingPlan(need(), p.plan); return trainingView(need()); },
  async setIndividualTraining(p: { playerId: string; focus: IndividualFocus; position: Position | null }) { setIndividualTraining(need(), p.playerId, p.focus, p.position); return trainingView(need()); },
  async dressing() { return dressingView(need()); },
  async talkToPlayer(p: { playerId: string; talk: PlayerTalk }) { return talkToPlayer(need(), p.playerId, p.talk); },
  async teamMeeting(p: { talk: TeamTalk }) { return { ...teamMeeting(need(), p.talk), view: dressingView(need()) }; },
  async awards() { return awardsView(need()); },
  // ---------------------------------------------------------------- Fase 8
  async deadline() { return deadlineView(need()); },
  async deadlineStep() { const s = need(); deadlineStep(s); return { view: deadlineView(s), dashboard: dashboardView(s) }; },
  async teamData() { return teamDataView(need()); },
  async playersData() { return playersDataView(need()); },
  async world() { return worldView(need()); },
  async career() { return careerView(need()); },
  async boardRequest(p: { kind: BoardRequestKind }) { return { ...boardRequest(need(), p.kind), view: boardView(need()) }; },
  async acceptJob(p: { clubId: string }) {
    const s = need();
    acceptJob(s, p.clubId);
    for (const m of s.inbox) if (m.blocking && !m.resolvedActionId) resolveMessage(s, m.id, 'ok');
    return dashboardView(s);
  },
  async toggleShortlist(p: { id: string }) {
    const s = need();
    s.ui.shortlist = s.ui.shortlist.includes(p.id) ? s.ui.shortlist.filter((x) => x !== p.id) : [...s.ui.shortlist, p.id];
    return s.ui;
  },
  async setDashboardLayout(p: { tiles: { id: DashboardTile; visible: boolean }[] }) { need().ui.dashboard = p.tiles; return need().ui; },
  async saveSquadView(p: { view: SquadView }) {
    const s = need();
    s.ui.squadViews = [...s.ui.squadViews.filter((v) => v.id !== p.view.id), p.view];
    return s.ui;
  },
  async deleteSquadView(p: { id: string }) { const s = need(); s.ui.squadViews = s.ui.squadViews.filter((v) => v.id !== p.id); return s.ui; },
  async save() { return saveGame(need()); },
  async listSaves() { return listSaves(); },
  async load(p: { id: string }) { state = await loadGame(p.id); return dashboardView(state); },
  async deleteSave(p: { id: string }) { await deleteSave(p.id); return true; },
  async exportSave() { return serializeGame(need()); },
  async importSave(p: { text: string }) { state = deserializeGame(p.text); return dashboardView(state); },
  async setAutosave(p: { on: boolean }) { autosave = p.on; return autosave; },
  async close() { state = null; live = null; return true; },
};

export type GameApi = typeof api;

self.onmessage = async (ev: MessageEvent<{ id: number; method: keyof GameApi; params: unknown }>) => {
  const { id, method, params } = ev.data;
  try {
    const fn = api[method] as (p: unknown) => Promise<unknown>;
    const value = await fn(params);
    self.postMessage({ id, ok: true, value });
  } catch (e) {
    self.postMessage({ id, ok: false, error: (e as Error).message });
  }
};
