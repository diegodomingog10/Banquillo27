import { useEffect, useMemo, useState } from 'react';
import { GROUP_OF_POSITION } from '../../data/positions';
import { ROLE_BY_ID } from '../../data/roles';
import type { TacticsView } from '../../engine/profileViews';
import { FORMATIONS, FORMATION_IDS, type IndividualInstructions, type Mentality, type TeamInstructions, type TeamTactic } from '../../engine/tactics';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Icon } from '../icons';
import { Badge, Bar, Button, Card, cx, Dialog, Dots, Segmented, Tabs, toneFor, Toggle } from '../kit';
import { FixtureRow } from './shared';

type Phase = 'inPossession' | 'outOfPossession' | 'transition';
const MENTALITIES = ['Muy def.', 'Defensiva', 'Precavida', 'Equilibrada', 'Positiva', 'Ofensiva', 'Muy of.'];
const MENTALITY_HINT = ['bloque muy bajo, casi sin riesgo', 'línea baja y pocas subidas', 'prudente con balón', 'sin sesgo', 'más riesgo con balón', 'mucha gente en ataque y línea alta', 'todo al ataque: cuidado con la espalda'];
const STEPS: Record<string, string[]> = {
  tempo: ['Muy lento', 'Lento', 'Normal', 'Rápido', 'Muy rápido'],
  width: ['Muy estrecha', 'Estrecha', 'Normal', 'Amplia', 'Muy amplia'],
  passingStyle: ['Muy corto', 'Corto', 'Mixto', 'Directo', 'Muy directo'],
  defensiveLine: ['Muy baja', 'Baja', 'Normal', 'Alta', 'Muy alta'],
  pressLine: ['Bloque bajo', 'Medio-bajo', 'Medio', 'Alta', 'Muy alta'],
  pressIntensity: ['Mínima', 'Baja', 'Normal', 'Alta', 'Máxima'],
};
const STEP_LABEL: Record<string, string> = {
  tempo: 'Ritmo', width: 'Anchura', passingStyle: 'Estilo de pase', defensiveLine: 'Línea defensiva', pressLine: 'Línea de presión', pressIntensity: 'Intensidad de presión',
};
const INDIVIDUAL: [keyof IndividualInstructions, string][] = [
  ['dribbleMore', 'Regatear más'], ['shootMore', 'Tirar más'], ['crossFromByline', 'Centrar desde la línea de fondo'],
  ['attackDefensiveLine', 'Atacar la espalda de la defensa'], ['arriveLate', 'Llegar tarde al área'], ['moreDirectPasses', 'Pases más directos'],
];

/** Reubica a los titulares al cambiar de formación, por afinidad de posición. */
function remap(prev: TeamTactic, next: TeamTactic, starting: string[]): string[] {
  const left = starting.map((id, i) => ({ id, pos: prev.slots[i]?.position })).filter((x) => x.id);
  return next.slots.map((slot) => {
    let k = left.findIndex((x) => x.pos === slot.position);
    if (k < 0) k = left.findIndex((x) => x.pos && GROUP_OF_POSITION[x.pos] === GROUP_OF_POSITION[slot.position]);
    if (k < 0) k = left.findIndex((x) => (x.pos === 'GK') === (slot.position === 'GK'));
    if (k < 0) return '';
    return left.splice(k, 1)[0]!.id;
  });
}

export function TacticsScreen() {
  const { dashboard, setStatus } = useGame();
  const [view, setView] = useState<TacticsView | null>(null);
  const [tactic, setTactic] = useState<TeamTactic | null>(null);
  const [starting, setStarting] = useState<string[]>([]);
  const [bench, setBench] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [slot, setSlot] = useState(0);
  const [phase, setPhase] = useState<Phase>('inPossession');
  const [drag, setDrag] = useState<DragState>(null);
  const [setPiecesOpen, setSetPiecesOpen] = useState(false);
  const [rivalOpen, setRivalOpen] = useState(false);

  const apply = (v: TacticsView) => {
    setView(v);
    setTactic(structuredClone(v.tactic));
    setStarting(v.lineup.starting.slice());
    setBench(v.lineup.bench.slice());
    setDirty(false);
  };
  useEffect(() => { void game('tactics').then(apply); }, []);

  const byId = useMemo(() => new Map((view?.players ?? []).map((p) => [p.id, p])), [view]);
  if (!view || !tactic) return <p className="text-sm text-muted">Cargando…</p>;

  const touch = () => setDirty(true);
  const setInst = <K extends keyof TeamInstructions>(k: K, v: TeamInstructions[K]) => { setTactic({ ...tactic, instructions: { ...tactic.instructions, [k]: v } }); touch(); };
  const setSlotField = (i: number, patch: Partial<TeamTactic['slots'][number]>) => { setTactic({ ...tactic, slots: tactic.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) }); touch(); };
  const changeFormation = (id: string) => {
    const f = FORMATIONS[id];
    if (!f) return;
    const next: TeamTactic = { ...tactic, formation: id, slots: f.slots.map((s) => ({ ...s, individual: {} })) };
    setStarting(remap(tactic, next, starting));
    setTactic(next);
    setSlot(0);
    touch();
  };

  /** Coloca al jugador `id` en el hueco `i` (intercambia o lo saca del banquillo). */
  const place = (id: string, i: number) => {
    const s = starting.slice();
    let b = bench.slice();
    const from = s.indexOf(id);
    const current = s[i] ?? '';
    if (from >= 0) {
      s[from] = current;
      s[i] = id;
    } else {
      s[i] = id;
      b = b.filter((x) => x !== id);
      if (current) b = [current, ...b].slice(0, 9);
    }
    setStarting(s);
    setBench(b);
    touch();
  };
  const toBench = (id: string) => {
    if (bench.includes(id)) return;
    const s = starting.map((x) => (x === id ? '' : x));
    setStarting(s);
    setBench([id, ...bench].slice(0, 9));
    touch();
  };
  const fromBench = (id: string) => { setBench(bench.filter((x) => x !== id)); touch(); };

  const save = async () => {
    await game('setTactic', { tactic });
    const v = await game('setLineup', { starting, bench });
    apply(v);
    setStatus('Táctica guardada');
  };
  const discard = () => apply(view);
  const resetLineup = async () => apply(await game('resetLineup'));

  const sel = tactic.slots[slot]!;
  const selPlayer = starting[slot] ? byId.get(starting[slot]!) : undefined;
  const roles = view.roles[sel.position] ?? [];
  const role = ROLE_BY_ID.get(sel.role);
  const fam = view.familiarity;
  const others = view.players.filter((p) => !starting.includes(p.id));
  const benchPlayers = bench.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const reserves = others.filter((p) => !bench.includes(p.id)).sort((a, b) => (b.fit[slot] ?? 0) - (a.fit[slot] ?? 0));
  const nextFixture = dashboard?.pendingMatch ?? dashboard?.next[0];
  const rivalId = nextFixture ? (nextFixture.homeId === dashboard?.club.id ? nextFixture.awayId : nextFixture.homeId) : null;
  const inst = tactic.instructions;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-bold tracking-tight">Tácticas</h1>
        <label className="flex items-center gap-2 text-[13px] text-muted">Formación
          <select value={tactic.formation} onChange={(e) => changeFormation(e.target.value)} className="h-9 rounded-[9px] border border-line2 bg-card px-2.5 font-semibold text-text">
            {FORMATION_IDS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2.5 text-[13px] text-muted" title="Los jugadores aprenden el sistema con los días y los partidos. Cambiar de formación la reduce bastante; cambiar instrucciones, un poco.">
          Familiaridad <Bar value={fam} tone={toneFor(fam)} width={120} label="Familiaridad táctica" /><span className="font-semibold text-text">{fam} %</span>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" icon="reset" onClick={() => void resetLineup()}>Once del asistente</Button>
        <Button variant="ghost" icon="flag" onClick={() => setSetPiecesOpen(true)}>Balón parado</Button>
        <Button variant="ghost" icon="eye" disabled={!rivalId} onClick={() => setRivalOpen(true)}>Análisis del rival</Button>
        <Button variant="primary" icon="save" disabled={!dirty} onClick={() => void save()}>Guardar táctica</Button>
      </div>
      {dirty && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warn-bg bg-[#221C10] px-4 py-2.5 text-[13px]">
          <Icon name="history" className="text-warn" /><span className="flex-1">Tienes cambios sin guardar.{tactic.formation !== view.tactic.formation && ' Cambiar de formación reducirá la familiaridad táctica.'}</span>
          <Button size="sm" onClick={discard}>Descartar</Button><Button size="sm" variant="primary" onClick={() => void save()}>Guardar</Button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-[18px]">
        <section aria-label="Campo" className="max-w-[520px] flex-[1_1_440px] rounded-2xl border border-line bg-card p-4">
          <div className="relative h-[620px] overflow-hidden rounded-xl border border-pitch-line bg-pitch">
            <div className="absolute inset-x-0 top-1/2 border-t border-pitch-line" />
            <div className="absolute left-1/2 top-1/2 h-[110px] w-[110px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-pitch-line" />
            <div className="absolute inset-x-1/4 top-0 h-[86px] border border-t-0 border-pitch-line" />
            <div className="absolute inset-x-1/4 bottom-0 h-[86px] border border-b-0 border-pitch-line" />
            {tactic.slots.map((s, i) => {
              const id = starting[i];
              const p = id ? byId.get(id) : undefined;
              const top = 94 - s.x * 88;
              const left = 8 + s.y * 84;
              const on = i === slot;
              const roleLabel = t(`role.${s.role}`);
              const fit = p ? p.fit[i] ?? 0 : 0;
              return (
                <button key={i} type="button" onClick={() => setSlot(i)}
                  draggable={!!p} onDragStart={(e) => { if (!p) return; e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; setDrag({ from: 'slot', id: p.id, slot: i }); }} onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = drag?.id ?? e.dataTransfer.getData('text/plain'); if (id) place(id, i); setDrag(null); }}
                  aria-pressed={on} aria-label={`${t(`posLong.${s.position}`)}: ${p ? p.name : 'vacío'}, ${roleLabel}`}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5" style={{ top: `${top}%`, left: `${left}%` }}>
                  <span className={cx('flex h-10 w-10 items-center justify-center rounded-full font-display text-xs font-bold',
                    !p ? 'border-2 border-dashed border-[#6D55B0] text-accent-text' : on ? 'bg-accent text-white shadow-[0_0_0_4px_#2E2545]' : 'border border-[#4C3D73] bg-accent-bg text-[#E9E2FF]',
                    p && fit < 2.5 && !on && 'border-warn')}>
                    {t(`pos.${s.position}`)}
                  </span>
                  <span className="max-w-[84px] truncate text-xs font-semibold text-text">{p ? p.shortName : '—'}</span>
                  <span className="max-w-[84px] truncate text-[11px] text-muted" title={`${roleLabel} · ${t(`duty.${s.duty}`)}`}>{roleLabel}</span>
                  <span className="text-[10px] text-faint">{t(`duty.${s.duty}`)}</span>
                  {p && p.condition < 75 && <span className="text-[10px] text-warn">{p.condition}%</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-xs text-muted">Arrastra jugadores entre posiciones o desde la lista. También puedes elegir una posición y pulsar «Poner» en un jugador.</p>
        </section>

        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-[18px]">
          <Card title="Mentalidad" icon="gauge" actions={<span className="text-[13px] text-muted">{MENTALITY_HINT[tactic.mentality - 1]}</span>}>
            <Segmented label="Mentalidad" strong value={tactic.mentality} onChange={(m) => { setTactic({ ...tactic, mentality: m as Mentality }); touch(); }}
              options={MENTALITIES.map((label, i) => ({ value: (i + 1) as Mentality, label }))} />
          </Card>

          <Card title="Instrucciones de equipo" icon="list">
            <Tabs label="Fases" value={phase} onChange={setPhase} items={[
              { id: 'inPossession', label: 'Con balón', icon: 'ball' }, { id: 'outOfPossession', label: 'Sin balón', icon: 'shield' }, { id: 'transition', label: 'Transiciones', icon: 'transfers' },
            ]} />
            <div className="flex flex-col gap-3.5">
              {(phase === 'inPossession' ? ['tempo', 'width', 'passingStyle'] : phase === 'outOfPossession' ? ['defensiveLine', 'pressLine', 'pressIntensity'] : []).map((k) => (
                <div key={k} className="grid items-center gap-3.5 sm:grid-cols-[150px_1fr]">
                  <span className="text-[13px] text-soft">{STEP_LABEL[k]}</span>
                  <Segmented label={STEP_LABEL[k]!} value={inst[k as keyof TeamInstructions] as number} onChange={(v) => setInst(k as 'tempo', v)}
                    options={STEPS[k]!.map((label, i) => ({ value: i + 1, label }))} />
                </div>
              ))}
              {phase === 'transition' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Toggle label="Buscar la contra al recuperar" checked={inst.counterAttack} onChange={(v) => setInst('counterAttack', v)} />
                    <Toggle label="Presión tras pérdida" checked={inst.counterPress} onChange={(v) => setInst('counterPress', v)} />
                    <Toggle label="Replegar tras pérdida" checked={inst.regroup} onChange={(v) => setInst('regroup', v)} />
                  </div>
                  <div className="grid items-center gap-3.5 sm:grid-cols-[150px_1fr]">
                    <span className="text-[13px] text-soft">Saque del portero</span>
                    <Segmented label="Saque del portero" value={inst.goalkeeperDistribution} onChange={(v) => setInst('goalkeeperDistribution', v)}
                      options={[{ value: 'short', label: 'Corto' }, { value: 'mixed', label: 'Mixto' }, { value: 'long', label: 'Largo' }]} />
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card raised title={<span>{t(`posLong.${sel.position}`)}{selPlayer ? ` · ${selPlayer.name}` : ''}</span>} icon="squad">
            <div className="flex flex-wrap gap-[18px]">
              <div className="flex-[1_1_220px]">
                <label htmlFor="role-select" className="mb-1.5 block text-xs text-muted">Rol</label>
                <select id="role-select" value={sel.role} onChange={(e) => {
                  const r = ROLE_BY_ID.get(e.target.value);
                  setSlotField(slot, { role: e.target.value, duty: r && !r.duties.includes(sel.duty as never) ? (r.duties[0] as typeof sel.duty) : sel.duty });
                }} className="h-[38px] w-full rounded-[9px] border border-accent-line bg-card px-2.5 text-[13px]">
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <div className="mt-2.5">
                  <Segmented label="Deber" value={sel.duty} onChange={(d) => setSlotField(slot, { duty: d })}
                    options={(role?.duties ?? ['support']).map((d) => ({ value: d as typeof sel.duty, label: t(`duty.${d}`) }))} />
                </div>
                {selPlayer && (
                  <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted">
                    <span className="flex items-center gap-2">Idoneidad para el rol <Dots value={selPlayer.roleFit[slot] ?? 0} /></span>
                    <span className="flex items-center gap-2">Dominio de la posición <Dots value={(selPlayer.positionRating[slot] ?? 1) / 4} /></span>
                  </div>
                )}
              </div>
              <div className="flex-[1_1_240px]">
                <div className="mb-2 text-xs text-muted">Instrucciones individuales</div>
                {INDIVIDUAL.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2.5 py-1.5 text-[13px] text-soft">
                    <input type="checkbox" className="h-4 w-4 accent-accent" checked={!!sel.individual[k]} onChange={(e) => setSlotField(slot, { individual: { ...sel.individual, [k]: e.target.checked } })} />{label}
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Card title={`Banquillo (${benchPlayers.length}/9)`} icon="squad">
            <ul onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (drag?.from === 'slot') toBench(drag.id); setDrag(null); }} className="flex min-h-12 flex-col gap-0.5 rounded-lg">
              {benchPlayers.map((p) => <PlayerRow key={p.id} p={p} where="bench" slot={slot} slotPos={sel.position} benchFull={bench.length >= 9} onDrag={setDrag} onPlace={place} onBench={toBench} onUnbench={fromBench} />)}
              {benchPlayers.length === 0 && <li className="py-2 text-[13px] text-muted">Arrastra aquí a los suplentes.</li>}
            </ul>
            <div className="mb-1 mt-4 text-xs uppercase tracking-[0.08em] text-muted">Resto de la plantilla · ordenado por idoneidad para {t(`pos.${sel.position}`)}</div>
            <ul className="flex flex-col gap-0.5">{reserves.map((p) => <PlayerRow key={p.id} p={p} where="reserve" slot={slot} slotPos={sel.position} benchFull={bench.length >= 9} onDrag={setDrag} onPlace={place} onBench={toBench} onUnbench={fromBench} />)}</ul>
          </Card>
        </div>
      </div>

      <SetPiecesDialog open={setPiecesOpen} onClose={() => setSetPiecesOpen(false)} tactic={tactic} starters={starting.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p)}
        onChange={(sp) => { setTactic({ ...tactic, setPieces: sp }); touch(); }} />
      <RivalDialog open={rivalOpen} onClose={() => setRivalOpen(false)} clubId={rivalId} />
    </div>
  );
}

type TPlayer = TacticsView['players'][number];
type DragState = { from: 'slot' | 'list'; id: string; slot?: number } | null;

function PlayerRow({ p, where, slot, slotPos, benchFull, onDrag, onPlace, onBench, onUnbench }: {
  p: TPlayer; where: 'bench' | 'reserve'; slot: number; slotPos: string; benchFull: boolean;
  onDrag: (d: DragState) => void; onPlace: (id: string, slot: number) => void; onBench: (id: string) => void; onUnbench: (id: string) => void;
}) {
  return (
    <li draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; onDrag({ from: 'list', id: p.id }); }} onDragEnd={() => onDrag(null)}
      className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-card2', !p.available && 'opacity-60')}>
      <Icon name="grip" className="cursor-grab text-faint" />
      <Badge tone="accent" className="w-9 justify-center">{t(`pos.${p.position}`)}</Badge>
      <span className="min-w-0 flex-1 truncate">{p.name}</span>
      {p.injury !== null && <Badge tone="bad">Lesión</Badge>}
      {p.suspended > 0 && <Badge tone="warn">Sanción</Badge>}
      <Bar value={p.condition} width={36} label={`Condición de ${p.name}`} />
      <Dots value={p.fit[slot] ?? 0} label={`Idoneidad para ${t(`pos.${slotPos}`)}: ${p.fit[slot]} de 5`} />
      <button type="button" onClick={() => onPlace(p.id, slot)} className="rounded-md px-2 py-0.5 text-xs text-accent-text hover:bg-accent-bg" aria-label={`Poner a ${p.name} en ${t(`posLong.${slotPos}`)}`}>Poner</button>
      {where === 'bench'
        ? <button type="button" onClick={() => onUnbench(p.id)} className="rounded-md p-1 text-muted hover:text-text" aria-label={`Quitar a ${p.name} del banquillo`}><Icon name="close" size={13} /></button>
        : <button type="button" disabled={benchFull} onClick={() => onBench(p.id)} className="rounded-md px-2 py-0.5 text-xs text-muted hover:text-text disabled:opacity-30" aria-label={`Llevar a ${p.name} al banquillo`}>Banquillo</button>}
    </li>
  );
}

function SetPiecesDialog({ open, onClose, tactic, starters, onChange }: {
  open: boolean; onClose: () => void; tactic: TeamTactic; starters: TacticsView['players']; onChange: (sp: TeamTactic['setPieces']) => void;
}) {
  const fields: [keyof TeamTactic['setPieces'], string][] = [['captain', 'Capitán'], ['penalties', 'Penaltis'], ['freeKicks', 'Faltas directas'], ['corners', 'Córners'], ['throwIns', 'Saques de banda largos']];
  return (
    <Dialog open={open} onClose={onClose} title="Balón parado" width={520}>
      <div className="flex flex-col gap-3">
        {fields.map(([k, label]) => (
          <label key={k} className="grid grid-cols-[170px_1fr] items-center gap-3 text-[13px]">
            <span className="text-soft">{label}</span>
            <select value={tactic.setPieces[k] ?? ''} onChange={(e) => onChange({ ...tactic.setPieces, [k]: e.target.value || null })} className="h-9 rounded-[9px] border border-line2 bg-card2 px-2.5">
              <option value="">Automático (el mejor disponible)</option>
              {starters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ))}
        <p className="text-xs text-muted">Si el lanzador elegido no está en el campo, lo hace el mejor de los que queden. Recuerda guardar la táctica.</p>
      </div>
    </Dialog>
  );
}

type Rival = NonNullable<Awaited<ReturnType<typeof game<'opponent'>>>>;
function RivalDialog({ open, onClose, clubId }: { open: boolean; onClose: () => void; clubId: string | null }) {
  const [a, setA] = useState<Rival | null>(null);
  useEffect(() => { if (open && clubId) void game('opponent', { clubId }).then(setA); }, [open, clubId]);
  return (
    <Dialog open={open} onClose={onClose} title={a ? `Análisis del rival · ${a.club.name}` : 'Análisis del rival'} width={720}>
      {!a ? <p className="text-sm text-muted">Cargando…</p> : (
        <div className="flex flex-col gap-5 text-[13px]">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><div className="text-xs text-muted">Formación habitual</div><div className="font-display text-lg font-bold">{a.formation}</div></div>
            <div><div className="text-xs text-muted">Posición</div><div className="font-display text-lg font-bold">{a.played && a.position ? `${a.position}.º` : '—'}</div></div>
            <div><div className="text-xs text-muted">Goles a favor / partido</div><div className="font-display text-lg font-bold">{a.played ? a.goalsFor.toFixed(2).replace('.', ',') : '—'}</div></div>
            <div><div className="text-xs text-muted">Goles en contra / partido</div><div className="font-display text-lg font-bold">{a.played ? a.goalsAgainst.toFixed(2).replace('.', ',') : '—'}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.strengths.map((s) => <Badge key={s} tone="bad">Peligro: {s}</Badge>)}
            {a.weaknesses.map((s) => <Badge key={s} tone="good">Punto débil: {s}</Badge>)}
          </div>
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.08em] text-muted">Jugadores clave</div>
            <ul className="grid gap-2 sm:grid-cols-2">{a.keyPlayers.map((p) => <li key={p.id} className="flex items-center gap-2.5 rounded-lg bg-card2 px-3 py-2"><Badge tone="accent">{t(`pos.${p.position}`)}</Badge><span className="flex-1">{p.name}</span><Dots value={p.stars} /></li>)}</ul>
          </div>
          {a.recent.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-[0.08em] text-muted">Últimos partidos</div>
              <table className="w-full"><tbody>{a.recent.map((f) => <FixtureRow key={f.id} f={f} highlight={a.club.id} />)}</tbody></table>
            </div>
          )}
          <p className="text-xs text-muted">«Peligro» son sus puntos fuertes (cuidado); «punto débil» es donde se les puede hacer daño.</p>
        </div>
      )}
    </Dialog>
  );
}
