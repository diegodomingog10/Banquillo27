import { useEffect, useState } from 'react';
import type { MatchView } from '../../engine/views';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDateLong } from '../format';
import { Badge, Card, cx, Empty, ratingClass } from '../kit';
import { ClubLink, PlayerLink } from './shared';

const SHOWN = new Set(['goal', 'yellow', 'secondYellow', 'red', 'substitution', 'injury', 'penaltyMissed']);
const STATS: [string, string][] = [['possession', 'Posesión %'], ['shots', 'Tiros'], ['shotsOnTarget', 'A puerta'], ['xg', 'xG'], ['passes', 'Pases'], ['corners', 'Córners'], ['fouls', 'Faltas'], ['offsides', 'Fueras de juego'], ['yellow', 'Amarillas'], ['red', 'Rojas']];
const EVENT_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = { goal: 'good', yellow: 'warn', secondYellow: 'bad', red: 'bad', injury: 'bad', substitution: 'neutral', penaltyMissed: 'neutral' };

export function MatchReport() {
  const { nav, dashboard } = useGame();
  const [m, setM] = useState<MatchView | null>(null);
  useEffect(() => { if (nav.fixtureId) void game('match', { id: nav.fixtureId }).then(setM); }, [nav.fixtureId]);
  if (!m) return <p className="text-sm text-muted">Cargando…</p>;
  const f = m.fixture;
  const events = m.events.filter((e) => SHOWN.has(e.type) && e.period <= 4);
  const minute = (e: MatchView['events'][number]) => `${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'`;
  const userSide = f.homeId === dashboard?.club.id ? 'home' : f.awayId === dashboard?.club.id ? 'away' : null;
  return (
    <div className="flex max-w-6xl flex-col gap-[18px]">
      <Card className="!p-7 text-center">
        <div className="text-xs uppercase tracking-[0.08em] text-muted first-letter:uppercase">{f.competitionName} · {f.roundLabel} · {fmtDateLong(f.date)}{m.attendance ? ` · ${m.attendance.toLocaleString('es')} espectadores` : ''}</div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-5">
          <ClubLink id={f.homeId} name={f.homeName} className="justify-self-end font-display text-2xl font-bold" />
          <div className="num rounded-xl bg-card2 px-5 py-2 font-display text-3xl font-extrabold">{f.homeGoals} - {f.awayGoals}</div>
          <ClubLink id={f.awayId} name={f.awayName} className="justify-self-start font-display text-2xl font-bold" />
        </div>
        {f.extra && <div className="mt-1 text-[13px] text-muted">{f.extra}</div>}
        <div className="mt-3 flex justify-center gap-2">
          {f.outcome && <Badge tone={f.outcome === 'W' ? 'good' : f.outcome === 'L' ? 'bad' : 'neutral'}>{f.outcome === 'W' ? 'Victoria' : f.outcome === 'L' ? 'Derrota' : 'Empate'}</Badge>}
          {m.motm && <Badge tone="accent">Hombre del partido: {m.motm}</Badge>}
        </div>
      </Card>
      <div className="grid gap-[18px] lg:grid-cols-2">
        <Card title="Momentos del partido" icon="history">
          {events.length === 0 ? <Empty>Sin incidencias destacadas.</Empty> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {events.map((e, i) => {
                const home = e.teamId === f.homeId;
                return (
                  <li key={i} className={cx('flex items-center gap-2', !home && 'flex-row-reverse text-right')}>
                    <span className="num w-12 shrink-0 text-xs text-muted">{minute(e)}</span>
                    <Badge tone={EVENT_TONE[e.type] ?? 'neutral'}>{t(`matchEvent.${e.type}`)}</Badge>
                    <span className="min-w-0">
                      {e.playerId && <PlayerLink id={e.playerId} name={e.playerName ?? ''} />}
                      {e.type === 'substitution' && e.otherPlayerId && <span className="text-muted"> por {e.otherName}</span>}
                      {e.type === 'goal' && e.otherPlayerId && <span className="text-muted"> (asist. {e.otherName})</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        {m.stats && (
          <Card title="Estadísticas" icon="chart">
            <div className="mb-2 flex justify-between text-xs text-muted"><span>{f.homeName}</span><span>{f.awayName}</span></div>
            <table className="w-full text-[13px]"><tbody>
              {STATS.filter(([k]) => m.stats!.home[k] !== undefined).map(([k, label]) => {
                const h = Number(m.stats!.home[k]);
                const a = Number(m.stats!.away[k]);
                const pct = h + a > 0 ? (h / (h + a)) * 100 : 50;
                return (
                  <tr key={k}>
                    <td className="num w-14 py-1.5 text-right font-semibold">{k === 'xg' ? h.toFixed(2) : h}</td>
                    <td className="px-3"><div className="text-center text-xs text-muted">{label}</div>
                      <div className="flex h-1.5 overflow-hidden rounded bg-[#3A3448]"><div className={userSide === 'away' ? 'bg-[#5C566C]' : 'bg-accent-soft'} style={{ width: `${pct}%` }} /><div className={userSide === 'away' ? 'flex-1 bg-accent-soft' : 'flex-1'} /></div></td>
                    <td className="num w-14 font-semibold">{k === 'xg' ? a.toFixed(2) : a}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </Card>
        )}
      </div>
      {m.ratings.length > 0 && (
        <div className="grid gap-[18px] lg:grid-cols-2">
          {(['home', 'away'] as const).map((side) => (
            <Card key={side} title={`Notas · ${side === 'home' ? f.homeName : f.awayName}`} icon="star">
              <table className="w-full text-[13px]"><tbody>
                {m.ratings.filter((r) => r.side === side).sort((a, b) => Number(b.started) - Number(a.started)).map((r) => (
                  <tr key={r.playerId} className="border-t border-[#221E2C]">
                    <td className="w-12 py-1.5"><Badge tone="accent">{t(`pos.${r.position}`)}</Badge></td>
                    <td><PlayerLink id={r.playerId} name={r.name} />{!r.started && <span className="ml-1.5 text-xs text-faint">suplente</span>}</td>
                    <td className={cx('num text-right font-bold', ratingClass(r.rating))}>{r.rating.toFixed(1).replace('.', ',')}</td>
                  </tr>
                ))}
              </tbody></table>
            </Card>
          ))}
        </div>
      )}
      {!m.full && <p className="text-xs text-muted">De los partidos de otros equipos solo se guarda el resumen.</p>}
    </div>
  );
}
