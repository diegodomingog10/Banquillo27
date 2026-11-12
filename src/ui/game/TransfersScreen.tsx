import { useCallback, useEffect, useState } from 'react';
import type { MarketFilter } from '../../engine/market';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDate } from '../format';
import { Icon } from '../icons';
import { Badge, Button, Card, cx, Dots, Empty, money, PageHeader, Stat, Tabs } from '../kit';
import { ContractDialog, IncomingDialog, type DealInfo } from './market';
import { ClubLink, PlayerLink } from './shared';

type Tr = Awaited<ReturnType<typeof game<'transfers'>>>;
type Market = Awaited<ReturnType<typeof game<'market'>>>;
type Scouting = Awaited<ReturnType<typeof game<'scouting'>>>;
type Tab = 'search' | 'reports' | 'shortlist' | 'deals' | 'scouts' | 'listed' | 'history';

const GROUPS = [
  { value: '', label: 'Todas' }, { value: 'GK', label: 'Porteros' }, { value: 'CB', label: 'Centrales' }, { value: 'FB', label: 'Laterales' },
  { value: 'DM', label: 'Pivotes' }, { value: 'CM', label: 'Centrocampistas' }, { value: 'WIDE', label: 'Bandas' }, { value: 'AM', label: 'Mediapuntas' }, { value: 'ST', label: 'Delanteros' },
];
const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'accent' }> = {
  pendingClub: { label: 'Esperando respuesta', tone: 'neutral' }, countered: { label: 'Contraoferta', tone: 'warn' }, pendingUser: { label: 'Te toca responder', tone: 'accent' },
  negotiating: { label: 'Negociando contrato', tone: 'accent' }, agreed: { label: 'Acordado', tone: 'good' }, completed: { label: 'Cerrado', tone: 'good' },
  rejected: { label: 'Rechazada', tone: 'bad' }, collapsed: { label: 'Sin acuerdo', tone: 'bad' }, withdrawn: { label: 'Retirada', tone: 'neutral' },
};

const sel = 'h-9 rounded-lg border border-line2 bg-card2 px-2.5 text-[13px] text-text';

export function TransfersScreen() {
  const { dashboard } = useGame();
  const [tab, setTab] = useState<Tab>('search');
  const [tr, setTr] = useState<Tr | null>(null);
  const load = useCallback(() => void game('transfers').then(setTr), []);
  useEffect(load, [load, dashboard?.date]);
  if (!tr) return <p className="text-sm text-muted">Cargando…</p>;
  const room = tr.wageBudget - tr.wageBill;
  const pendingCount = tr.deals.filter((d) => d.status === 'pendingUser' || d.status === 'countered' || d.status === 'negotiating').length;
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Fichajes" subtitle={tr.window.open ? `Mercado abierto hasta el ${fmtDate(tr.window.deadline!)}` : `Mercado cerrado · abre el ${fmtDate(tr.window.next)}`} />
      <Card className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Presupuesto de fichajes" value={money(tr.budget)} />
        <Stat label="Margen salarial" value={`${money(Math.max(0, room))}/sem`} tone={room < 0 ? 'bad' : undefined} hint={`${money(tr.wageBill)} de ${money(tr.wageBudget)}`} />
        <Stat label="Mercado" value={tr.window.open ? 'Abierto' : 'Cerrado'} tone={tr.window.open ? 'good' : undefined} hint={tr.window.open ? 'Los fichajes son oficiales al cerrar el acuerdo' : 'Puedes negociar; serán oficiales al abrir'} />
        <Stat label="Operaciones en curso" value={pendingCount} hint={tr.embargo ? 'Sanción: no puedes fichar' : undefined} tone={tr.embargo ? 'bad' : undefined} />
      </Card>
      <DeadlineCard onChange={() => { load(); setTab((x) => x); }} onOffers={() => setTab('deals')} />
      <Tabs label="Secciones de fichajes" value={tab} onChange={setTab} items={[
        { id: 'search', label: 'Buscar', icon: 'search' }, { id: 'reports', label: 'Informes', icon: 'docCheck' }, { id: 'shortlist', label: 'Seguimiento', icon: 'star' },
        { id: 'deals', label: `Operaciones${pendingCount ? ` (${pendingCount})` : ''}`, icon: 'transfers' }, { id: 'scouts', label: 'Ojeadores', icon: 'eye' },
        { id: 'listed', label: 'En venta y cesiones', icon: 'loan' }, { id: 'history', label: 'Historial', icon: 'history' },
      ]} />
      {tab === 'search' && <MarketSearch scope="all" />}
      {tab === 'reports' && <MarketSearch scope="reported" />}
      {tab === 'shortlist' && <MarketSearch scope="shortlist" />}
      {tab === 'deals' && <Deals tr={tr} reload={load} />}
      {tab === 'scouts' && <Scouts />}
      {tab === 'listed' && <Listed tr={tr} />}
      {tab === 'history' && <History tr={tr} />}
    </div>
  );
}

type Dl = NonNullable<Awaited<ReturnType<typeof game<'deadline'>>>>;

/** Día de cierre: el día avanza por horas y las operaciones aparecen en directo. */
function DeadlineCard({ onChange, onOffers }: { onChange: () => void; onOffers: () => void }) {
  const { dashboard, setDashboard } = useGame();
  const [dl, setDl] = useState<Dl | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void game('deadline').then(setDl); }, [dashboard?.date]);
  if (!dl) return null;
  const step = async () => {
    setBusy(true);
    try { const r = await game('deadlineStep'); setDl(r.view); setDashboard(r.dashboard); onChange(); } finally { setBusy(false); }
  };
  const pct = Math.round(((dl.hour - 9) / (dl.end - 9)) * 100);
  return (
    <Card title="Día de cierre del mercado" icon="bolt" actions={<span className="num font-display text-xl font-bold">{String(Math.min(dl.hour, 24)).padStart(2, '0')}:00</span>}>
      <div className="mb-3 h-1.5 rounded bg-[#2A2536]"><div className="h-1.5 rounded bg-accent" style={{ width: `${pct}%` }} /></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="arrowRight" disabled={busy || dl.done} onClick={() => void step()}>{dl.done ? 'Mercado cerrado a medianoche' : 'Avanzar dos horas'}</Button>
        {dl.pending > 0 && <Button onClick={onOffers}>Tienes {dl.pending} oferta{dl.pending === 1 ? '' : 's'} pendiente{dl.pending === 1 ? '' : 's'}</Button>}
        <span className="text-xs text-muted">Las operaciones se cierran hasta las 23:00. Si pulsas Continuar, el resto del día se resuelve solo.</span>
      </div>
      <ul className="mt-3 flex max-h-52 flex-col gap-1 overflow-auto text-[13px]" aria-live="polite">
        {dl.feed.length === 0 ? <li className="text-muted">Todo tranquilo por ahora…</li> : dl.feed.map((f, i) => <li key={i} className="flex gap-3"><span className="num w-12 shrink-0 text-muted">{String(f.hour).padStart(2, '0')}:00</span><span>{f.text}</span></li>)}
      </ul>
    </Card>
  );
}

function MarketSearch({ scope }: { scope: 'all' | 'shortlist' | 'reported' }) {
  const reported = scope === 'reported';
  const [f, setF] = useState<MarketFilter>({ scope, sort: reported ? 'recommendation' : 'ability', group: null });
  const [m, setM] = useState<Market | null>(null);
  useEffect(() => { const id = setTimeout(() => void game('market', { filter: f }).then(setM), 150); return () => clearTimeout(id); }, [f]);
  const set = (patch: Partial<MarketFilter>) => setF((x) => ({ ...x, ...patch }));
  return (
    <Card padded>
      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-muted">Nombre<input className={cx(sel, 'w-44')} value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="Buscar…" /></label>
        {scope === 'all' && <label className="flex flex-col gap-1 text-xs text-muted">Ámbito
          <select className={sel} value={f.scope} onChange={(e) => set({ scope: e.target.value as MarketFilter['scope'] })}>
            <option value="all">Todo el mundo</option><option value="known">Conocidos por los ojeadores</option><option value="league">Mi liga</option><option value="free">Agentes libres</option>
          </select></label>}
        {reported && <label className="flex flex-col gap-1 text-xs text-muted">Recomendación
          <select className={sel} value={f.minRec ?? ''} onChange={(e) => set({ minRec: (e.target.value || null) as MarketFilter['minRec'] })}>
            <option value="">Todas</option><option value="A">Solo A (fichaje recomendado)</option><option value="B">A y B</option><option value="C">A, B y C</option>
          </select></label>}
        <label className="flex flex-col gap-1 text-xs text-muted">Posición
          <select className={sel} value={f.group ?? ''} onChange={(e) => set({ group: e.target.value || null })}>{GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Edad máx.<input type="number" min={15} max={45} className={cx(sel, 'w-20')} value={f.maxAge ?? ''} onChange={(e) => set({ maxAge: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Valor máx. (M€)<input type="number" min={0} step={0.5} className={cx(sel, 'w-24')} value={f.maxValue ? f.maxValue / 1e6 : ''} onChange={(e) => set({ maxValue: e.target.value ? Number(e.target.value) * 1e6 : null })} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Ordenar
          <select className={sel} value={f.sort} onChange={(e) => set({ sort: e.target.value as MarketFilter['sort'] })}>
            {reported && <><option value="recommendation">Recomendación</option><option value="recent">Informe más reciente</option></>}
            <option value="ability">Nivel estimado</option><option value="potential">Potencial estimado</option><option value="value">Valor</option><option value="age">Edad</option>
          </select></label>
        <span className="ml-auto text-xs text-muted">{m ? `${m.total.toLocaleString('es')} jugadores${m.total > m.rows.length ? ` · se muestran ${m.rows.length}` : ''}` : ''}</span>
      </div>
      {reported && m && m.pending.length > 0 && (
        <p className="mb-3 rounded-lg bg-card2 px-3 py-2 text-[13px] text-soft">
          <Icon name="history" size={13} className="mr-1.5 inline text-muted" />Informes en camino: {m.pending.map((x, i) => <span key={x.id}>{i > 0 && ' · '}<PlayerLink id={x.id} name={x.name} /> <span className="text-muted">({x.by}, {fmtDate(x.due)})</span></span>)}
        </p>
      )}
      {!m ? <p className="text-sm text-muted">Buscando…</p> : m.rows.length === 0 ? <Empty>{scope === 'shortlist' ? 'No sigues a ningún jugador. Pulsa «Seguir» en su ficha.' : reported ? 'Tus ojeadores aún no tienen informes. Asígnales una liga o un país en «Ojeadores», o pide un informe desde la ficha de un jugador.' : 'Ningún jugador cumple los filtros.'}</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted">
              <th className="py-2 font-medium">Pos.</th><th className="font-medium">Jugador</th><th className="font-medium">Edad</th><th className="font-medium">Club</th>
              <th className="font-medium">Nivel</th><th className="font-medium">Potencial</th><th className="text-right font-medium">Valor</th><th className="pl-5 font-medium">Contrato</th><th className="font-medium">Ojeo</th>
              {reported && <th className="font-medium">Informe</th>}
            </tr></thead>
            <tbody>{m.rows.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-card2">
                <td className="py-1.5"><Badge tone="accent">{t(`pos.${r.position}`)}</Badge></td>
                <td><PlayerLink id={r.id} name={r.name} />{r.shortlisted && <Icon name="star" size={12} className="ml-1 inline text-warn" />}</td>
                <td className="num">{r.age}</td>
                <td>{r.clubId ? <ClubLink id={r.clubId} name={r.club} /> : <span className="text-muted">Libre</span>}{r.loan && <span className="text-muted"> (cedido)</span>}</td>
                <td title={r.ca[0] !== r.ca[1] ? `Entre ${r.ca[0]} y ${r.ca[1]} estrellas` : undefined}><Dots value={r.caMid} /></td>
                <td title={r.pa[0] !== r.pa[1] ? `Entre ${r.pa[0]} y ${r.pa[1]} estrellas` : undefined}><Dots value={r.paMid} variant="potential" /></td>
                <td className="num text-right">{money(r.value)}</td>
                <td className="pl-5 text-muted">{r.expires ? fmtDate(r.expires) : '—'}</td>
                <td><span className="flex items-center gap-2"><span className="h-1 w-10 rounded bg-[#2A2536]"><span className="block h-1 rounded bg-accent-soft" style={{ width: `${r.knowledge}%` }} /></span>{r.rec && <Badge tone={r.rec === 'A' ? 'good' : r.rec === 'B' ? 'accent' : 'neutral'}>{r.rec}</Badge>}{!reported && r.reportDate && <span title={`Informe del ${fmtDate(r.reportDate)}${r.reportBy ? ` (${r.reportBy})` : ''}`}><Icon name="docCheck" size={13} className="text-accent-text" /></span>}</span></td>
                {reported && <td className="text-muted">{r.reportDate ? fmtDate(r.reportDate) : '—'}{r.reportBy && <span className="block text-[11px]">{r.reportBy}</span>}</td>}
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Nivel y potencial son estimaciones de tus ojeadores respecto a tu plantilla: cuanto menos se conoce al jugador, mayor es el margen de error. Ojeo: A = fichaje recomendado, B = buen refuerzo, C = rotación, D = no mejora lo que tienes. <Icon name="docCheck" size={11} className="inline text-accent-text" /> = hay informe de tus ojeadores.</p>
        </div>
      )}
    </Card>
  );
}

function Deals({ tr, reload }: { tr: Tr; reload: () => void }) {
  const { setDashboard } = useGame();
  const [contract, setContract] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<DealInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); reload(); setDashboard(await game('dashboard')); } catch (e) { setErr((e as Error).message); } };
  return (
    <Card padded>
      {err && <p role="alert" className="mb-3 text-[13px] text-bad-text">{err}</p>}
      {tr.deals.length === 0 ? <Empty>No hay operaciones en curso. Busca jugadores y haz una oferta desde su ficha.</Empty> : (
        <ul className="flex flex-col divide-y divide-line">
          {tr.deals.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
              <Icon name={d.incoming ? 'arrowRight' : d.kind === 'renewal' ? 'docCheck' : d.kind === 'loan' ? 'loan' : 'transfers'} className={d.incoming ? 'text-warn' : 'text-accent-text'} />
              <div className="min-w-[220px] flex-1">
                <div>{d.player ? <PlayerLink id={d.player.id} name={d.player.name} /> : '—'} <span className="text-muted">· {d.incoming ? `oferta de ${d.buyer}` : d.kind === 'renewal' ? 'renovación' : `${d.seller}${d.kind === 'loan' ? ' (cesión)' : ''}`}</span></div>
                <div className="text-xs text-muted">{d.log.at(-1)?.text ?? ''}{d.terms.fee > 0 ? ` · ${money(d.terms.fee)}` : ''}</div>
              </div>
              <Badge tone={STATUS[d.status]?.tone ?? 'neutral'}>{STATUS[d.status]?.label ?? d.status}</Badge>
              {d.status === 'negotiating' && <Button size="sm" variant="primary" onClick={() => setContract(d.id)}>Negociar</Button>}
              {d.status === 'countered' && d.counter && <Button size="sm" variant="primary" onClick={() => void act(async () => { const x = await game('acceptCounter', { dealId: d.id }); if (x.status === 'negotiating') setContract(x.id); })}>Aceptar ({d.counter.loan ? `${d.counter.loan.wageShare} %` : money(d.counter.fee)})</Button>}
              {d.status === 'pendingUser' && <Button size="sm" variant="primary" onClick={() => setIncoming(d)}>Responder</Button>}
              {['pendingClub', 'countered', 'negotiating'].includes(d.status) && <Button size="sm" variant="ghost" onClick={() => void act(() => game('withdrawDeal', { dealId: d.id }))}>Retirar</Button>}
            </li>
          ))}
        </ul>
      )}
      <ContractDialog dealId={contract} onClose={() => { setContract(null); reload(); }} onDone={reload} />
      <IncomingDialog deal={incoming} onClose={() => setIncoming(null)} onDone={reload} />
    </Card>
  );
}

function Scouts() {
  const [s, setS] = useState<Scouting | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void game('scouting').then(setS); }, []);
  if (!s) return <p className="text-sm text-muted">Cargando…</p>;
  const assign = async (scoutId: string, value: string, group: string, maxAge: string) => {
    setErr(null);
    try {
      const [kind, id] = value.split(':') as ['nation' | 'competition', string];
      setS(await game('assignScout', { scoutId, target: value ? { kind, id } : null, focus: { group: group || null, maxAge: maxAge ? Number(maxAge) : null } }));
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
      <Card title="Ojeadores" icon="eye">
        {err && <p role="alert" className="mb-2 text-[13px] text-bad-text">{err}</p>}
        {s.scouts.length === 0 ? <Empty>No tienes ojeadores en el cuerpo técnico.</Empty> : (
          <ul className="flex flex-col gap-4">
            {s.scouts.map((sc) => <ScoutRow key={sc.id} sc={sc} targets={s.targets} onAssign={assign} />)}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Cada semana, el ojeador observa varios jugadores de su zona. Conocer el país (zona) le hace más preciso. Cada cuatro semanas envía un informe con los más interesantes.</p>
      </Card>
      <Card title="Recomendados por los ojeadores" icon="star">
        {s.recommended.length === 0 ? <Empty>Todavía no hay recomendaciones. Asigna ojeadores a ligas o países.</Empty> : (
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {s.recommended.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <Badge tone={r.rec === 'A' ? 'good' : 'accent'}>{r.rec}</Badge><Badge tone="neutral">{t(`pos.${r.position}`)}</Badge>
                <span className="flex-1"><PlayerLink id={r.id} name={r.name} /></span><span className="text-muted">{r.club}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ScoutRow({ sc, targets, onAssign }: { sc: Scouting['scouts'][number]; targets: Scouting['targets']; onAssign: (id: string, v: string, g: string, age: string) => void }) {
  const cur = sc.assignment ? `${sc.assignment.target.kind}:${sc.assignment.target.id}` : '';
  const [v, setV] = useState(cur);
  const [g, setG] = useState(sc.assignment?.focus.group ?? '');
  const [age, setAge] = useState(sc.assignment?.focus.maxAge ? String(sc.assignment.focus.maxAge) : '');
  return (
    <li className="flex flex-col gap-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <b>{sc.name}</b><span className="text-muted">{sc.role === 'chiefScout' ? 'Jefe de ojeadores' : sc.role === 'directorOfFootball' ? 'Director deportivo' : 'Ojeador'}</span>
        <span className="ml-auto text-xs text-muted">Juzgar nivel {sc.ability} · potencial {sc.potential}</span>
      </div>
      <div className="text-xs text-muted">Conoce: {sc.regions.join(', ')}{sc.assignment ? ` · en ${sc.assignment.name} desde el ${fmtDate(sc.assignment.since)} (${sc.assignment.seen} observados)` : ' · sin misión'}{sc.requests.length ? ` · informes: ${sc.requests.map((r) => r.name).join(', ')}` : ''}</div>
      <div className="flex flex-wrap gap-2">
        <select className={sel} value={v} onChange={(e) => setV(e.target.value)} aria-label={`Destino de ${sc.name}`}>
          <option value="">Sin misión</option>
          <optgroup label="Ligas">{targets.competitions.map((c) => <option key={c.id} value={`competition:${c.id}`}>{c.name}</option>)}</optgroup>
          <optgroup label="Países">{targets.nations.map((n) => <option key={n.id} value={`nation:${n.id}`}>{n.name}</option>)}</optgroup>
        </select>
        <select className={sel} value={g} onChange={(e) => setG(e.target.value)} aria-label="Posición a buscar">{GROUPS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
        <input type="number" min={15} max={40} placeholder="Edad máx." className={cx(sel, 'w-28')} value={age} onChange={(e) => setAge(e.target.value)} aria-label="Edad máxima" />
        <Button size="sm" variant="primary" disabled={!v && !sc.assignment} onClick={() => onAssign(sc.id, v, g, age)}>{v ? 'Asignar' : 'Retirar'}</Button>
      </div>
    </li>
  );
}

function Listed({ tr }: { tr: Tr }) {
  return (
    <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
      <Card title="Jugadores ofrecidos" icon="transfers">
        {tr.listed.length === 0 ? <Empty>No has ofrecido a nadie. Hazlo desde la ficha del jugador («Ofrecer a otros clubes»).</Empty> : (
          <ul className="flex flex-col gap-1.5 text-[13px]">{tr.listed.map((l) => (
            <li key={l.id} className="flex items-center gap-3"><span className="flex-1"><PlayerLink id={l.id} name={l.name} /></span><Badge tone={l.loan ? 'orange' : 'accent'}>{l.loan ? 'Cedible' : `En venta · ${money(l.asking ?? l.value)}`}</Badge></li>
          ))}</ul>
        )}
      </Card>
      <Card title="Cesiones" icon="loan">
        {tr.loans.length === 0 ? <Empty>No hay cesiones en vigor.</Empty> : (
          <ul className="flex flex-col gap-1.5 text-[13px]">{tr.loans.map((l) => (
            <li key={l.playerId} className="flex flex-wrap items-center gap-3">
              <span className="flex-1"><PlayerLink id={l.playerId} name={l.name} /> <span className="text-muted">· {l.in ? `de ${l.owner}` : `en ${l.borrower}`}</span></span>
              <span className="text-xs text-muted">hasta {fmtDate(l.until)}{l.buyOption ? ` · opción ${money(l.buyOption)}` : ''}</span>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function History({ tr }: { tr: Tr }) {
  const Rows = ({ rows }: { rows: Tr['history'] }) => rows.length === 0 ? <Empty>Sin movimientos todavía.</Empty> : (
    <ul className="flex flex-col gap-1.5 text-[13px]">{rows.map((h, i) => (
      <li key={`${h.playerId}${i}`} className="flex flex-wrap items-center gap-3">
        <span className="w-14 shrink-0 text-xs text-muted">{fmtDate(h.date)}</span>
        <span className="flex-1"><PlayerLink id={h.playerId} name={h.name} /> <span className="text-muted">{h.from} → {h.to}</span></span>
        <span className="num font-semibold">{h.loan ? 'Cesión' : h.fee ? money(h.fee) : 'Libre'}</span>
      </li>
    ))}</ul>
  );
  return (
    <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
      <Card title="Mi club" icon="club"><Rows rows={tr.history} /></Card>
      <Card title="Últimos movimientos del mercado" icon="news"><Rows rows={tr.latest} /></Card>
    </div>
  );
}
