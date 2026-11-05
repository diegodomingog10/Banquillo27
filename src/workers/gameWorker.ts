/// <reference lib="webworker" />
/**
 * Worker de partida: guarda el estado completo del juego y ejecuta el bucle de tiempo
 * y los partidos sin bloquear la interfaz. El hilo principal solo recibe vistas.
 */
import { generateWorld } from '../data/generator/generateWorld';
import type { WorldDatabase } from '../data/schema';
import { continueGame, markRead, newGame, playUserMatch, resolveMessage, type GameState, type Manager } from '../engine/game';
import { competitionView, competitionsList, dashboardView, inboxView, matchView, preMatchView, squadView } from '../engine/views';
import { clubView, opponentAnalysis, playerProfile, search, squadTable, tacticsView } from '../engine/profileViews';
import { setUserLineup, setUserTactic, type DashboardTile, type SquadView } from '../engine/manager';
import type { TeamTactic } from '../engine/tactics';
import { deleteSave, deserializeGame, listSaves, loadGame, saveGame, serializeGame } from '../store/saves';

let state: GameState | null = null;
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
    const { fixture } = playUserMatch(s);
    if (autosave) await saveGame(s, { auto: true }).catch(() => undefined);
    return { match: matchView(s, fixture.id), dashboard: dashboardView(s) };
  },
  async dashboard() { return dashboardView(need()); },
  async inbox() { return inboxView(need()); },
  async resolveMessage(p: { id: string; actionId: string | null }) {
    resolveMessage(need(), p.id, p.actionId);
    return dashboardView(need());
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
  async close() { state = null; return true; },
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
