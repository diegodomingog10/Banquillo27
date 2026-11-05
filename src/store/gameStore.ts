import { create } from 'zustand';
import type { WorldDatabase } from '../data/schema';
import type { DashboardView } from '../engine/views';

export type Screen = 'home' | 'newGame' | 'generate' | 'import' | 'browse' | 'options';
export type GameScreen = 'dashboard' | 'inbox' | 'squad' | 'tactics' | 'competitions' | 'club' | 'player' | 'prematch' | 'match' | 'live' | 'postmatch' | 'transfers' | 'finances' | 'board' | 'training' | 'dressing';

interface Nav {
  screen: GameScreen;
  messageId: string | null;
  fixtureId: string | null;
  playerId: string | null;
  clubId: string | null;
}

interface UiState {
  screen: Screen;
  world: WorldDatabase | null;
  fontScale: number;
  dashboard: DashboardView | null;
  nav: Nav;
  back: Nav[];
  busy: boolean;
  status: string | null;
  searchOpen: boolean;
  setScreen(s: Screen): void;
  setWorld(w: WorldDatabase | null): void;
  setFontScale(v: number): void;
  setDashboard(d: DashboardView | null): void;
  go(s: GameScreen, opts?: Partial<Omit<Nav, 'screen'>>): void;
  goBack(): void;
  setBusy(b: boolean): void;
  setStatus(s: string | null): void;
  setSearchOpen(v: boolean): void;
}

const EMPTY_NAV: Nav = { screen: 'dashboard', messageId: null, fixtureId: null, playerId: null, clubId: null };

const readScale = () => {
  try {
    const v = Number(localStorage.getItem('banquillo.fontScale'));
    return v >= 0.8 && v <= 1.5 ? v : 1;
  } catch {
    return 1;
  }
};

export const useGame = create<UiState>((set) => ({
  screen: 'home',
  world: null,
  fontScale: readScale(),
  dashboard: null,
  nav: EMPTY_NAV,
  back: [],
  busy: false,
  status: null,
  searchOpen: false,
  setScreen: (screen) => set({ screen }),
  setWorld: (world) => set({ world }),
  setFontScale: (fontScale) => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
    try { localStorage.setItem('banquillo.fontScale', String(fontScale)); } catch { /* sin almacenamiento */ }
    set({ fontScale });
  },
  setDashboard: (dashboard) => set(dashboard ? { dashboard } : { dashboard: null, nav: EMPTY_NAV, back: [] }),
  go: (screen, opts = {}) =>
    set((s) => ({
      back: [...s.back, s.nav].slice(-30),
      nav: {
        screen,
        messageId: opts.messageId !== undefined ? opts.messageId : s.nav.messageId,
        fixtureId: opts.fixtureId !== undefined ? opts.fixtureId : s.nav.fixtureId,
        playerId: opts.playerId !== undefined ? opts.playerId : s.nav.playerId,
        clubId: opts.clubId !== undefined ? opts.clubId : s.nav.clubId,
      },
    })),
  goBack: () => set((s) => (s.back.length ? { nav: s.back[s.back.length - 1]!, back: s.back.slice(0, -1) } : {})),
  setBusy: (busy) => set({ busy }),
  setStatus: (status) => set({ status }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
}));

if (typeof document !== 'undefined') document.documentElement.style.setProperty('--font-scale', String(readScale()));
