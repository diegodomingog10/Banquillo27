import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Badge, Card, Empty } from '../kit';
import { FixtureRow, LeagueTable, PlayerLink } from './shared';

type CompList = Awaited<ReturnType<typeof game<'competitions'>>>;
type CompView = NonNullable<Awaited<ReturnType<typeof game<'competition'>>>>;

export function Competitions() {
  const { dashboard, go } = useGame();
  const [list, setList] = useState<CompList>([]);
  const [id, setId] = useState('');
  const [view, setView] = useState<CompView | null>(null);
  const [round, setRound] = useState('');
  useEffect(() => { void game('competitions').then((l) => { setList(l); setId((cur) => cur || l[0]?.id || ''); }); }, []);
  useEffect(() => {
    if (!id) return;
    void game('competition', { id }).then((v) => {
      setView(v);
      if (v) {
        const next = v.rounds.find((r) => r.fixtures.some((f) => !f.played)) ?? v.rounds[v.rounds.length - 1];
        setRound((cur) => (v.rounds.some((r) => r.key === cur) ? cur : next?.key ?? ''));
      }
    });
  }, [id, dashboard?.date]);
  const [awards, setAwards] = useState<Awaited<ReturnType<typeof game<'awards'>>>>([]);
  useEffect(() => { void game('awards').then(setAwards); }, [dashboard?.season]);
  const aw = awards.filter((x) => x.competitionId === id);
  const r = view?.rounds.find((x) => x.key === round);
  const idx = view?.rounds.findIndex((x) => x.key === round) ?? -1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-bold tracking-tight">Competiciones</h1>
        <select aria-label="Competición" value={id} onChange={(e) => { setId(e.target.value); setRound(''); }} className="h-9 rounded-[9px] border border-line2 bg-card px-2.5 text-[13px] font-semibold">
          {list.map((c) => <option key={c.id} value={c.id}>{c.mine ? '★ ' : ''}{c.name}</option>)}
        </select>
        {view?.champion && <Badge tone="good">Campeón: {view.champion}</Badge>}
      </div>
      <div className="grid gap-[18px] xl:grid-cols-[1.2fr_1fr]">
        {view && view.table.length > 0 && <Card title="Clasificación" icon="trophy"><LeagueTable rows={view.table} highlight={dashboard?.club.id} /></Card>}
        <Card title="Calendario y resultados" icon="calendar" actions={
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Ronda anterior" disabled={idx <= 0} onClick={() => setRound(view!.rounds[idx - 1]!.key)} className="rounded-md p-1 text-muted hover:text-text disabled:opacity-30">‹</button>
            <select aria-label="Ronda" value={round} onChange={(e) => setRound(e.target.value)} className="h-8 rounded-lg border border-line2 bg-card2 px-2 text-xs">
              {view?.rounds.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <button type="button" aria-label="Ronda siguiente" disabled={!view || idx >= view.rounds.length - 1} onClick={() => setRound(view!.rounds[idx + 1]!.key)} className="rounded-md p-1 text-muted hover:text-text disabled:opacity-30">›</button>
          </div>
        }>
          {r ? <table className="w-full text-[13px]"><tbody>{r.fixtures.map((f) => <FixtureRow key={f.id} f={f} highlight={dashboard?.club.id} onOpen={(fid) => go('match', { fixtureId: fid })} />)}</tbody></table>
            : <Empty>Sin partidos todavía (las rondas de copa aparecen tras su sorteo).</Empty>}
        </Card>
      </div>
      {view?.continental && (
        <>
          {view.continental.groups.some((g) => g.table.length) ? (
            <Card title="Fase de grupos" icon="grid" actions={!view.continental.drawn ? <span className="text-xs text-muted">Sorteo el {view.continental.drawDate}</span> : undefined}>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {view.continental.groups.map((g) => (
                  <div key={g.name}>
                    <div className="mb-1 text-xs uppercase tracking-[0.08em] text-muted">Grupo {g.name}</div>
                    <table className="w-full text-[13px]"><tbody>{g.table.map((r, i) => (
                      <tr key={r.clubId} className={`border-t border-line ${r.clubId === dashboard?.club.id ? 'font-semibold text-accent-text' : ''}`}>
                        <td className={`w-6 py-1 num ${i < 2 ? 'text-good-text' : 'text-muted'}`}>{r.position}</td><td className="truncate">{r.clubName}</td>
                        <td className="num w-8 text-right text-muted">{r.played}</td><td className="num w-10 text-right text-muted">{r.gd > 0 ? `+${r.gd}` : r.gd}</td><td className="num w-8 text-right font-semibold">{r.points}</td>
                      </tr>
                    ))}</tbody></table>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Los dos primeros de cada grupo pasan a las eliminatorias.</p>
            </Card>
          ) : <Card title="Fase de grupos" icon="grid"><Empty>El sorteo de grupos será el {view.continental.drawDate}.</Empty></Card>}
          <Card title="Eliminatorias" icon="trophy">
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, view.continental.rounds.length)}, minmax(180px, 1fr))` }}>
              {view.continental.rounds.map((r) => (
                <div key={r.key}>
                  <div className="mb-1.5 text-xs uppercase tracking-[0.08em] text-muted">{r.label}</div>
                  {!r.drawn ? <p className="text-xs text-faint">Por sortear · {r.dates.join(' y ')}</p> : (
                    <ul className="flex flex-col gap-1.5">{r.ties.map((x, i) => (
                      <li key={i} className="rounded-lg border border-line bg-card2 px-2.5 py-1.5 text-[12px]">
                        <div className={`flex justify-between ${x.winnerId === x.a ? 'font-semibold text-text' : 'text-soft'}`}><span className="truncate">{x.aName}</span><span className="num">{x.agg?.[0] ?? ''}</span></div>
                        <div className={`flex justify-between ${x.winnerId === x.b ? 'font-semibold text-text' : 'text-soft'}`}><span className="truncate">{x.bName}</span><span className="num">{x.agg?.[1] ?? ''}</span></div>
                        {x.pens && <div className="text-[10px] text-muted">Penaltis {x.pens.home}-{x.pens.away}</div>}
                      </li>
                    ))}</ul>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Eliminatorias a ida y vuelta (cuenta el global; si hay empate, prórroga y penaltis en la vuelta). Final a partido único en campo neutral.</p>
          </Card>
        </>
      )}
      {aw.length > 0 && (
        <Card title={`Premios · temporada ${aw[0]!.season}`} icon="star" actions={aw.length > 1 ? <span className="text-xs text-muted">Anteriores: {aw.slice(1, 4).map((x) => `${x.season} ${x.playerOfSeason?.name ?? ''}`).join(' · ')}</span> : undefined}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([['Mejor jugador', aw[0]!.playerOfSeason], ['Máximo goleador', aw[0]!.topScorer], ['Mejor joven', aw[0]!.young], ['Mejor portero', aw[0]!.goalkeeper]] as const).map(([label, w]) => (
              <div key={label} className="rounded-xl border border-line bg-card2 px-4 py-3 text-[13px]">
                <div className="text-xs uppercase tracking-[0.08em] text-muted">{label}</div>
                {w && w.id ? <><div className="mt-1 font-semibold"><PlayerLink id={w.id} name={w.name ?? ''} /></div><div className="text-xs text-muted">{w.club}{'goals' in w ? ` · ${w.goals} goles` : ''}</div></> : <div className="mt-1 text-muted">—</div>}
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs uppercase tracking-[0.08em] text-muted">Once ideal</div>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[13px]">{aw[0]!.team.map((p) => p && <span key={p.id} className="rounded-lg border border-line2 px-2 py-1"><Badge tone="accent">{t(`pos.${p.position}`)}</Badge> <PlayerLink id={p.id} name={p.name} /></span>)}</div>
        </Card>
      )}
    </div>
  );
}
