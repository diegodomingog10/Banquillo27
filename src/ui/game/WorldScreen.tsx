import { useEffect, useState } from 'react';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDate } from '../format';
import { Icon } from '../icons';
import { Badge, Card, cx, Empty, PageHeader, Stat, Tabs } from '../kit';
import { ClubLink, PlayerLink } from './shared';

type World = Awaited<ReturnType<typeof game<'world'>>>;
type Career = Awaited<ReturnType<typeof game<'career'>>>;
type Tab = 'rankings' | 'managers' | 'national' | 'career';

export function WorldScreen() {
  const { dashboard } = useGame();
  const [tab, setTab] = useState<Tab>('rankings');
  const [w, setW] = useState<World | null>(null);
  const [c, setC] = useState<Career | null>(null);
  useEffect(() => { void game('world').then(setW); void game('career').then(setC); }, [dashboard?.date]);
  if (!w || !c) return <p className="text-sm text-muted">Cargando…</p>;
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Mundo" subtitle="Clubes, ligas, entrenadores, selecciones y tu carrera" />
      <Tabs label="Secciones del mundo" value={tab} onChange={setTab} items={[
        { id: 'rankings', label: 'Rankings', icon: 'trophy' }, { id: 'managers', label: 'Entrenadores', icon: 'club' },
        { id: 'national', label: 'Selecciones', icon: 'globe' }, { id: 'career', label: 'Mi carrera', icon: 'history' },
      ]} />
      {tab === 'rankings' && (
        <div className="grid gap-[18px] xl:grid-cols-2">
          <Card title="Clubes por reputación" icon="star">
            <ol className="flex flex-col gap-1 text-[13px]">{w.clubs.map((x) => (
              <li key={x.id} className={cx('flex items-center gap-2', x.mine && 'font-semibold text-accent-text')}>
                <span className="num w-6 text-muted">{x.rank}</span><span className="min-w-0 flex-1 truncate"><ClubLink id={x.id} name={x.name} /> <span className="text-xs text-muted">· {x.league}</span></span><span className="num">{x.reputation.toLocaleString('es')}</span>
              </li>
            ))}</ol>
          </Card>
          <div className="flex flex-col gap-[18px]">
            <Card title="Ligas por nivel" icon="chart">
              <ol className="flex flex-col gap-1 text-[13px]">{w.leagues.map((l, i) => (
                <li key={l.id} className="flex items-center gap-2"><span className="num w-6 text-muted">{i + 1}</span><span className="flex-1 truncate">{l.name}</span>
                  <span className="h-1.5 w-24 rounded bg-[#2A2536]"><span className="block h-1.5 rounded bg-accent-soft" style={{ width: `${Math.min(100, (l.strength / 170) * 100)}%` }} /></span><span className="num w-8 text-right">{l.strength}</span></li>
              ))}</ol>
              <p className="mt-2 text-xs text-muted">Nivel: media del once titular de sus equipos.</p>
            </Card>
            <Card title="Palmarés reciente" icon="trophy">
              {w.champions.length === 0 ? <Empty>Aún no ha terminado ninguna temporada.</Empty> : (
                <ul className="flex flex-col gap-1 text-[13px]">{w.champions.map((x, i) => <li key={i} className="flex gap-2"><span className="w-16 text-muted">{x.season}</span><span className="flex-1 truncate">{x.competition}</span><b>{x.champion}</b></li>)}</ul>
              )}
            </Card>
          </div>
        </div>
      )}
      {tab === 'managers' && (
        <Card title="Cambios de entrenador" icon="club">
          {w.managers.length === 0 ? <Empty>Ningún club ha cambiado de entrenador todavía.</Empty> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">{w.managers.map((m, i) => (
              <li key={i} className="flex flex-wrap gap-2"><span className="w-16 text-muted">{fmtDate(m.date)}</span><b className="min-w-[160px]">{m.club}</b><span className="text-bad-text">− {m.out}</span><span className="text-good-text">+ {m.in}</span></li>
            ))}</ul>
          )}
        </Card>
      )}
      {tab === 'national' && (
        <div className="grid gap-[18px] xl:grid-cols-2">
          <Card title="Más internacionales" icon="globe">
            {w.caps.length === 0 ? <Empty>Las selecciones convocan en los parones internacionales.</Empty> : (
              <table className="w-full text-[13px]"><thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-1.5 font-medium">Jugador</th><th className="font-medium">Selección</th><th className="text-right font-medium">Partidos</th><th className="text-right font-medium">Goles</th></tr></thead>
                <tbody>{w.caps.map((x) => x && <tr key={x.id} className="border-t border-line"><td className="py-1"><PlayerLink id={x.id} name={x.name} /> <span className="text-xs text-muted">· {x.club}</span></td><td>{x.nation}</td><td className="num text-right">{x.caps}</td><td className="num text-right">{x.goals}</td></tr>)}</tbody></table>
            )}
          </Card>
          <Card title="Últimos amistosos" icon="ball">
            {w.internationals.length === 0 ? <Empty>Todavía no se han jugado.</Empty> : (
              <ul className="flex flex-col gap-1 text-[13px]">{w.internationals.map((r, i) => <li key={i} className="flex gap-2"><span className="w-16 text-muted">{fmtDate(r.date)}</span><span className="flex-1 text-right">{r.home}</span><b className="num w-12 text-center">{r.hg}-{r.ag}</b><span className="flex-1">{r.away}</span></li>)}</ul>
            )}
          </Card>
        </div>
      )}
      {tab === 'career' && (
        <div className="flex flex-col gap-[18px]">
          <Card className="grid grid-cols-2 gap-5 sm:grid-cols-5">
            <Stat label="Entrenador" value={<span className="text-base">{c.manager}</span>} />
            <Stat label="Partidos" value={c.totals.m} />
            <Stat label="Victorias" value={`${c.totals.w} (${c.totals.winPct} %)`} tone="good" />
            <Stat label="Empates / derrotas" value={`${c.totals.d} / ${c.totals.l}`} />
            <Stat label="Títulos" value={c.trophies.length} />
          </Card>
          <div className="grid gap-[18px] xl:grid-cols-2">
            <Card title="Clubes" icon="club">
              <ul className="flex flex-col gap-2 text-[13px]">{c.clubs.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2"><b className="flex-1"><ClubLink id={s.clubId} name={s.name} /></b><span className="text-muted">{fmtDate(s.from)} – {s.to ? fmtDate(s.to) : 'actualidad'}</span><Badge tone="neutral">{s.matches} PJ · {s.wins}V {s.draws}E {s.losses}D · {s.winPct} %</Badge></li>
              ))}</ul>
            </Card>
            <Card title="Palmarés" icon="trophy">
              {c.trophies.length === 0 ? <Empty>Todavía sin títulos. ¡A por el primero!</Empty> : (
                <ul className="flex flex-col gap-1.5 text-[13px]">{c.trophies.map((x, i) => <li key={i} className="flex items-center gap-2"><Icon name="trophy" size={14} className="text-warn" /><span className="w-16 text-muted">{x.season}</span><b>{x.name}</b></li>)}</ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
