import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { DualLineChart } from '../charts';
import { fmtDate } from '../format';
import { Badge, Card, cx, Empty, PageHeader, Stat, Tabs } from '../kit';
import { ClubLink, PlayerLink } from './shared';

type Team = Awaited<ReturnType<typeof game<'teamData'>>>;
type Players = Awaited<ReturnType<typeof game<'playersData'>>>;
type Tab = 'team' | 'league' | 'players' | 'leaders';

const num = (v: number) => v.toFixed(2).replace('.', ',');
const XG_FOR = '#8B5CF6';
const XG_AGAINST = '#C9772E';

export function DataHubScreen() {
  const { dashboard } = useGame();
  const [tab, setTab] = useState<Tab>('team');
  const [team, setTeam] = useState<Team | null>(null);
  const [players, setPlayers] = useState<Players | null>(null);
  useEffect(() => { void game('teamData').then(setTeam); void game('playersData').then(setPlayers); }, [dashboard?.date]);
  if (!team || !players) return <p className="text-sm text-muted">Cargando…</p>;
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Data Hub" subtitle={team.league ? `${team.league} · temporada ${dashboard?.season ?? ''}` : 'Estadísticas'} />
      <Tabs label="Secciones del Data Hub" value={tab} onChange={setTab} items={[
        { id: 'team', label: 'Mi equipo', icon: 'chart' }, { id: 'league', label: 'Liga', icon: 'trophy' },
        { id: 'players', label: 'Mis jugadores', icon: 'squad' }, { id: 'leaders', label: 'Líderes', icon: 'star' },
      ]} />
      {tab === 'team' && <TeamTab team={team} />}
      {tab === 'league' && <LeagueTab team={team} />}
      {tab === 'players' && <PlayersTab players={players} />}
      {tab === 'leaders' && <LeadersTab players={players} />}
    </div>
  );
}

function TeamTab({ team }: { team: Team }) {
  const s = team.summary;
  const m = team.matches;
  return (
    <div className="flex flex-col gap-[18px]">
      <Card className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="xG a favor / partido" value={s ? num(s.xgForPer) : '—'} hint={s ? `liga ${num(s.leagueXgPer)}` : undefined} />
        <Stat label="xG en contra / partido" value={s ? num(s.xgAgainstPer) : '—'} />
        <Stat label="Tiros / partido" value={s ? num(s.shotsPer) : '—'} hint={s ? `liga ${num(s.leagueShotsPer)}` : undefined} />
        <Stat label="Posesión media" value={s ? `${s.possession} %` : '—'} />
        <Stat label="Goles − xG" value={s ? (s.goalsMinusXg > 0 ? `+${num(s.goalsMinusXg)}` : num(s.goalsMinusXg)) : '—'} hint="acierto de cara a puerta" tone={s ? (s.goalsMinusXg >= 0 ? 'good' : 'warn') : undefined} />
        <Stat label="Puesto por diferencia de xG" value={s ? `${s.rankXg}.º` : '—'} />
      </Card>
      <Card title="xG por partido" icon="chart">
        <DualLineChart label="xG a favor y en contra por partido" format={num}
          series={[{ label: 'xG a favor', color: XG_FOR }, { label: 'xG en contra', color: XG_AGAINST }]}
          points={m.map((x) => ({ x: `${Number(x.date.slice(8))}/${Number(x.date.slice(5, 7))}`, a: x.xgFor, b: x.xgAgainst }))} />
      </Card>
      <Card title="Partido a partido" icon="list">
        {m.length === 0 ? <Empty>Aún no se ha jugado ningún partido.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">
            <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-2 font-medium">Fecha</th><th className="font-medium">Rival</th><th className="font-medium">Comp.</th><th className="font-medium">Resultado</th><th className="text-right font-medium">xG</th><th className="text-right font-medium">Tiros</th><th className="text-right font-medium">Posesión</th></tr></thead>
            <tbody>{m.slice().reverse().map((x) => (
              <tr key={x.id} className="border-t border-line">
                <td className="py-1.5 text-muted">{fmtDate(x.date)}</td><td>{x.home ? '' : '@ '}{x.opponent}</td><td className="text-muted">{x.competition}</td>
                <td className={cx('num font-semibold', x.gf > x.ga ? 'text-good-text' : x.gf < x.ga ? 'text-bad-text' : 'text-text')}>{x.gf}-{x.ga}</td>
                <td className="num text-right">{num(x.xgFor)} - {num(x.xgAgainst)}</td><td className="num text-right">{x.shotsFor} - {x.shotsAgainst}</td><td className="num text-right">{x.possession} %</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

function LeagueTab({ team }: { team: Team }) {
  const { dashboard } = useGame();
  return (
    <Card title="Estadísticas de los equipos" icon="trophy" actions={<span className="text-xs text-muted">Ordenado por diferencia de xG</span>}>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-[13px]">
        <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted">
          <th className="py-2 font-medium">Equipo</th><th className="text-right font-medium">PJ</th><th className="text-right font-medium">GF</th><th className="text-right font-medium">GC</th>
          <th className="text-right font-medium">xG</th><th className="text-right font-medium">xG en contra</th><th className="text-right font-medium">Dif. xG</th><th className="text-right font-medium">Goles − xG</th><th className="text-right font-medium">Tiros/p</th><th className="text-right font-medium">Posesión</th>
        </tr></thead>
        <tbody>{team.leagueRows.map((r) => (
          <tr key={r.clubId} className={cx('border-t border-line', r.clubId === dashboard?.club.id && 'bg-accent-bg/40 font-semibold')}>
            <td className="py-1.5"><ClubLink id={r.clubId} name={r.name} /></td><td className="num text-right">{r.played}</td><td className="num text-right">{r.gf}</td><td className="num text-right">{r.ga}</td>
            <td className="num text-right">{num(r.xgFor)}</td><td className="num text-right">{num(r.xgAgainst)}</td>
            <td className={cx('num text-right', r.xgDiff >= 0 ? 'text-good-text' : 'text-bad-text')}>{r.xgDiff > 0 ? '+' : ''}{num(r.xgDiff)}</td>
            <td className="num text-right text-soft">{r.goalsMinusXg > 0 ? '+' : ''}{num(r.goalsMinusXg)}</td><td className="num text-right">{num(r.shotsPer)}</td><td className="num text-right">{r.possession} %</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="mt-2 text-xs text-muted">Solo partidos de liga. Goles − xG positivo: el equipo marca más de lo que generan sus ocasiones.</p>
    </Card>
  );
}

function PctBar({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center gap-1.5" title={`Percentil ${v} frente a su posición en la liga`}>
      <span className="h-1.5 w-12 rounded bg-[#2A2536]"><span className="block h-1.5 rounded bg-accent-soft" style={{ width: `${Math.max(4, v)}%` }} /></span>
      <span className="num w-6 text-right text-xs text-muted">{v}</span>
    </span>
  );
}

function PlayersTab({ players }: { players: Players }) {
  return (
    <Card title="Mis jugadores · por 90 minutos" icon="squad" actions={<span className="text-xs text-muted">Barra: percentil frente a su posición en la liga (mín. 450')</span>}>
      {players.mine.length === 0 ? <Empty>Sin minutos todavía.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-[13px]">
          <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-2 font-medium">Pos.</th><th className="font-medium">Jugador</th><th className="text-right font-medium">Min.</th><th className="text-right font-medium">Nota</th>
            {players.metrics.map((m) => <th key={m.id} className="pl-3 font-medium">{m.label}/90</th>)}</tr></thead>
          <tbody>{players.mine.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="py-1.5"><Badge tone="accent">{t(`pos.${r.position}`)}</Badge></td><td><PlayerLink id={r.id} name={r.name} /></td>
              <td className="num text-right">{r.minutes}</td><td className="num text-right">{num(r.rating)}</td>
              {r.metrics.map((m) => <td key={m.id} className="pl-3"><span className="flex items-center gap-2"><span className="num w-9">{num(m.per90)}</span><PctBar v={m.pct} /></span></td>)}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function LeadersTab({ players }: { players: Players }) {
  const boards: [string, keyof Players['leaders'], (v: number) => string][] = [
    ['Goles', 'goals', String], ['Asistencias', 'assists', String], ['xG', 'xg', num], ['Nota media', 'rating', num], ['Mejor del partido', 'motm', String], ['Porterías a cero', 'cleanSheets', String],
  ];
  return (
    <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      {boards.map(([title, key, f]) => (
        <Card key={key} title={title} icon="star">
          {players.leaders[key].length === 0 ? <Empty>Sin datos.</Empty> : (
            <ol className="flex flex-col gap-1 text-[13px]">{players.leaders[key].map((r, i) => (
              <li key={r.id} className={cx('flex items-center gap-2', r.mine && 'font-semibold text-accent-text')}>
                <span className="num w-5 text-muted">{i + 1}</span><span className="min-w-0 flex-1 truncate"><PlayerLink id={r.id} name={r.name} /> <span className="text-xs text-muted">· {r.club}</span></span><span className="num font-semibold">{f(r.value)}</span>
              </li>
            ))}</ol>
          )}
        </Card>
      ))}
    </div>
  );
}
