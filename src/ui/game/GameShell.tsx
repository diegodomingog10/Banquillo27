import { useCallback, useEffect, type ReactNode } from 'react';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame, type GameScreen } from '../../store/gameStore';
import { fmtDateLong } from '../format';
import { Icon, type IconName } from '../icons';
import { cx } from '../kit';
import { ClubScreen } from './ClubScreen';
import { Competitions } from './Competitions';
import { Dashboard } from './Dashboard';
import { InboxScreen } from './InboxScreen';
import { LiveMatchScreen } from './LiveMatchScreen';
import { PostMatchScreen } from './PostMatchScreen';
import { MatchReport } from './MatchReport';
import { PlayerScreen } from './PlayerScreen';
import { PreMatch } from './PreMatch';
import { SearchPalette } from './SearchPalette';
import { SquadScreen } from './SquadScreen';
import { TacticsScreen } from './TacticsScreen';
import { TransfersScreen } from './TransfersScreen';
import { FinancesScreen } from './FinancesScreen';
import { BoardScreen, FiredScreen } from './BoardScreen';

const NAV: { id: GameScreen | null; label: string; icon: IconName; soon?: string }[] = [
  { id: 'dashboard', label: 'Inicio', icon: 'home' },
  { id: 'inbox', label: 'Bandeja', icon: 'inbox' },
  { id: 'squad', label: 'Plantilla', icon: 'squad' },
  { id: 'tactics', label: 'Tácticas', icon: 'tactics' },
  { id: null, label: 'Entrenamiento', icon: 'training', soon: 'Fase 7' },
  { id: 'transfers', label: 'Fichajes', icon: 'transfers' },
  { id: 'finances', label: 'Finanzas', icon: 'finance' },
  { id: 'competitions', label: 'Competiciones', icon: 'trophy' },
  { id: 'club', label: 'Club', icon: 'club' },
  { id: 'board', label: 'Directiva', icon: 'target' },
];

/** Botón Continuar: avanza hasta el siguiente evento y lleva a la pantalla adecuada. */
export function useContinue() {
  const { setBusy, setDashboard, go, setStatus } = useGame();
  return useCallback(async () => {
    const st = useGame.getState();
    const d = st.dashboard;
    if (st.busy || !d) return;
    if (d.pendingMatch) { go(st.nav.screen === 'live' ? 'live' : 'prematch', { fixtureId: d.pendingMatch.id }); return; }
    if (d.board.fired) return;
    if (d.blocking) { go('inbox', { messageId: null }); return; }
    setBusy(true);
    setStatus(null);
    try {
      const { result, dashboard } = await game('continue');
      setDashboard(dashboard);
      setStatus(t(`stop.${result.stop}`));
      if (result.stop === 'userMatch' && result.fixtureId) go('prematch', { fixtureId: result.fixtureId });
      else if (result.stop === 'blocking') go('inbox', { messageId: null });
      else if (result.messageIds.length > 0 && result.stop !== 'limit') go('inbox', { messageId: result.messageIds[0] ?? null });
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [setBusy, setDashboard, go, setStatus]);
}

export function GameShell() {
  const { dashboard, nav, go, goBack, back, busy, status, setDashboard, setStatus, searchOpen, setSearchOpen } = useGame();
  const doContinue = useContinue();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void doContinue(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doContinue, setSearchOpen]);

  if (!dashboard) return null;
  const d = dashboard;
  const save = async () => {
    setStatus('Guardando…');
    try { await game('save'); setStatus('Partida guardada'); } catch (e) { setStatus((e as Error).message); }
  };
  const exportFile = async () => {
    const text = await game('exportSave');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `banquillo-${d.club.name.replace(/\s+/g, '_')}-${d.date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exit = async () => {
    if (!window.confirm('¿Volver al menú principal? Lo que no hayas guardado se perderá.')) return;
    await game('close');
    setDashboard(null);
  };
  const label = d.pendingMatch ? 'Ir al partido' : d.blocking ? 'Mensaje pendiente' : t('menu.continue');
  const initials = d.manager.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const current = ['player', 'prematch', 'match', 'live', 'postmatch'].includes(nav.screen) ? null : nav.screen;
  const screen: ReactNode = {
    dashboard: <Dashboard />, inbox: <InboxScreen />, squad: <SquadScreen />, tactics: <TacticsScreen />, competitions: <Competitions />,
    club: <ClubScreen />, player: <PlayerScreen />, prematch: <PreMatch />, match: <MatchReport />,
    live: <LiveMatchScreen />, postmatch: <PostMatchScreen />,
    transfers: <TransfersScreen />, finances: <FinancesScreen />, board: <BoardScreen />,
  }[nav.screen];

  return (
    <div className="flex min-h-screen flex-wrap">
      <nav aria-label="Secciones" className="flex min-w-[200px] max-w-[240px] flex-[1_1_220px] flex-col gap-1 border-r border-line bg-panel px-3.5 py-5">
        <div className="flex items-center gap-2.5 px-2.5 pb-5">
          <div className="h-[26px] w-[26px] rounded-[7px] bg-accent" aria-hidden="true" />
          <div className="font-display text-[17px] font-extrabold">Banquillo</div>
        </div>
        {NAV.map((n) => {
          const active = n.id === current;
          if (!n.id) {
            return (
              <div key={n.label} aria-disabled="true" title={`Disponible en la ${n.soon}`} className="flex h-10 items-center gap-3 rounded-[9px] px-3 text-sm text-faint">
                <Icon name={n.icon} size={18} /><span className="flex-1">{n.label}</span><span className="text-[10px] uppercase tracking-wide">{n.soon}</span>
              </div>
            );
          }
          return (
            <button key={n.label} type="button" onClick={() => go(n.id!, n.id === 'club' ? { clubId: d.club.id } : {})} aria-current={active ? 'page' : undefined}
              className={cx('flex h-10 items-center gap-3 rounded-[9px] px-3 text-left text-sm', active ? 'bg-accent-bg font-semibold text-[#E9E2FF]' : 'text-[#B7B1C6] hover:bg-card2 hover:text-text')}>
              <Icon name={n.icon} size={18} />
              <span className="flex-1">{n.label}</span>
              {n.id === 'inbox' && d.unread > 0 && <span className="rounded-full bg-accent px-[7px] py-px text-[11px] font-semibold text-white">{d.unread}</span>}
            </button>
          );
        })}
        <div className="mt-auto flex items-center gap-2.5 border-t border-line px-2.5 pt-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2A2340] text-xs font-semibold text-accent-text">{initials}</div>
          <div className="min-w-0"><div className="truncate font-semibold">{d.manager}</div><div className="truncate text-xs text-muted">{d.club.name}</div></div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-[999_1_560px] flex-col">
        <header className="flex flex-wrap items-center gap-3.5 border-b border-line px-7 py-4">
          {back.length > 0 && (
            <button type="button" onClick={goBack} aria-label="Volver" title="Volver" className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line2 text-soft hover:bg-card2"><Icon name="chevronLeft" /></button>
          )}
          <button type="button" onClick={() => setSearchOpen(true)} className="flex h-10 max-w-[460px] flex-[1_1_280px] items-center gap-2.5 rounded-[10px] border border-[#2A2536] bg-card px-3 text-left text-muted hover:border-line2">
            <Icon name="search" /><span className="flex-1">Buscar jugadores, clubes o pantallas</span>
            <span className="rounded-[5px] border border-[#3A3448] px-1.5 text-[11px]">Ctrl K</span>
          </button>
          <div className="flex-1" />
          <span className="text-xs text-muted" role="status" aria-live="polite">{busy ? 'Avanzando…' : status}</span>
          <div className="text-right leading-tight">
            <div className="font-semibold first-letter:uppercase">{fmtDateLong(d.date)}</div>
            <div className="text-xs text-muted">Temporada {d.season}</div>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void save()} aria-label="Guardar partida" title="Guardar partida" className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line2 text-soft hover:bg-card2"><Icon name="save" /></button>
            <button type="button" onClick={() => void exportFile()} aria-label="Exportar partida a archivo" title="Exportar partida a archivo" className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line2 text-soft hover:bg-card2"><Icon name="download" /></button>
            <button type="button" onClick={() => void exit()} aria-label="Menú principal" title="Menú principal" className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-line2 text-soft hover:bg-card2"><Icon name="logout" /></button>
          </div>
          <button type="button" onClick={() => void doContinue()} disabled={busy} title="Ctrl+Intro"
            className="flex h-11 items-center gap-2.5 rounded-[10px] bg-accent px-5 font-display text-[15px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60">
            {busy ? 'Avanzando…' : label}<Icon name="arrowRight" strokeWidth={2.2} />
          </button>
        </header>
        <main className="min-w-0 flex-1 px-7 pb-10 pt-6">{d.board.fired ? <FiredScreen /> : screen}</main>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
