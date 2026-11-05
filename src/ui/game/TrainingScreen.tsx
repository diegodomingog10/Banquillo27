import { useEffect, useState } from 'react';
import { POSITIONS, type Position } from '../../data/positions';
import type { IndividualFocus, Intensity, TrainingArea, TrainingPlan } from '../../engine/training';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDate } from '../format';
import { Icon } from '../icons';
import { Badge, Bar, Button, Card, cx, Dots, Empty, PageHeader, Segmented, Stat, Tabs, toneFor } from '../kit';
import { PlayerLink } from './shared';

type Tr = Awaited<ReturnType<typeof game<'training'>>>;
type Tab = 'plan' | 'individual' | 'medical' | 'youth' | 'staff';

const sel = 'h-8 rounded-lg border border-line2 bg-card2 px-2 text-[13px] text-text';
const qStars = (q: number) => Math.max(0.5, Math.min(5, Math.round(q / 2) / 2));

export function TrainingScreen() {
  const { dashboard } = useGame();
  const [tab, setTab] = useState<Tab>('plan');
  const [tr, setTr] = useState<Tr | null>(null);
  useEffect(() => { void game('training').then(setTr); }, [dashboard?.date]);
  if (!tr) return <p className="text-sm text-muted">Cargando…</p>;
  const injured = tr.rows.filter((r) => r.injury).length;
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Entrenamiento" subtitle={`Intensidad ${tr.intensityLabel.toLowerCase()} · ${injured ? `${injured} lesionado${injured === 1 ? '' : 's'}` : 'sin lesionados'}`} />
      <Tabs label="Secciones de entrenamiento" value={tab} onChange={setTab} items={[
        { id: 'plan', label: 'Plan semanal', icon: 'calendar' }, { id: 'individual', label: 'Individual', icon: 'squad' },
        { id: 'medical', label: `Centro médico${injured ? ` (${injured})` : ''}`, icon: 'medical' }, { id: 'youth', label: 'Cantera', icon: 'star' },
        { id: 'staff', label: 'Cuerpo técnico', icon: 'club' },
      ]} />
      {tab === 'plan' && <PlanTab tr={tr} onSaved={setTr} />}
      {tab === 'individual' && <IndividualTab tr={tr} onSaved={setTr} />}
      {tab === 'medical' && <MedicalTab tr={tr} />}
      {tab === 'youth' && <YouthTab tr={tr} />}
      {tab === 'staff' && <StaffTab tr={tr} />}
    </div>
  );
}

function PlanTab({ tr, onSaved }: { tr: Tr; onSaved: (t: Tr) => void }) {
  const [plan, setPlan] = useState<TrainingPlan>(tr.plan);
  const [msg, setMsg] = useState<string | null>(null);
  const total = Object.values(plan.focus).reduce((a, b) => a + b, 0) || 1;
  const dirty = JSON.stringify(plan) !== JSON.stringify(tr.plan);
  const save = async () => { try { onSaved(await game('setTrainingPlan', { plan })); setMsg('Plan guardado.'); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
      <Card title="Reparto del trabajo" icon="sliders">
        <div className="mb-4 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs text-muted">Plantillas:</span>{tr.presets.map((p) => <Button key={p.id} size="sm" variant="ghost" onClick={() => setPlan(structuredClone(p.plan))}>{p.label}</Button>)}</div>
        <ul className="flex flex-col gap-4">
          {tr.areas.map((a) => (
            <li key={a.id} className="text-[13px]">
              <div className="mb-1 flex items-center gap-3">
                <span className="flex-1 font-medium">{a.label}</span>
                <span className="text-xs text-muted" title={`Calidad de los entrenadores: ${a.quality.toFixed(1)}/20`}>Entrenadores</span><Dots value={qStars(a.quality)} />
                <span className="num w-10 text-right font-semibold">{Math.round((plan.focus[a.id as TrainingArea] / total) * 100)} %</span>
              </div>
              <input type="range" min={0} max={60} step={5} value={plan.focus[a.id as TrainingArea]} aria-label={`Peso del área ${a.label}`}
                onChange={(e) => setPlan({ ...plan, focus: { ...plan.focus, [a.id]: Number(e.target.value) } })} className="w-full accent-[#8B5CF6]" />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">El área con más peso hace progresar más sus atributos. El trabajo táctico también acelera la familiaridad con el sistema.</p>
      </Card>
      <Card title="Carga de trabajo" icon="gauge">
        <Segmented label="Intensidad" strong value={plan.intensity} onChange={(v) => setPlan({ ...plan, intensity: v as Intensity })}
          options={[{ value: 'low', label: 'Suave' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Intensa' }]} />
        <ul className="mt-4 flex flex-col gap-2 text-[13px] text-soft">
          <li className="flex gap-2"><Icon name="pulse" size={15} className="mt-0.5 text-muted" />Progresión: {plan.intensity === 'high' ? '+15 %' : plan.intensity === 'low' ? '−15 %' : 'normal'}</li>
          <li className="flex gap-2"><Icon name="heart" size={15} className="mt-0.5 text-muted" />Recuperación física: {plan.intensity === 'high' ? 'más lenta (−18 %)' : plan.intensity === 'low' ? 'más rápida (+18 %)' : 'normal'}</li>
          <li className="flex gap-2"><Icon name="medical" size={15} className="mt-0.5 text-muted" />Riesgo de lesión en los entrenamientos: {plan.intensity === 'high' ? 'el doble' : plan.intensity === 'low' ? 'la mitad' : 'normal'}</li>
        </ul>
        <div className="mt-5 grid grid-cols-3 gap-4">
          <Stat label="Instalaciones" value={`${tr.facilities.training}/20`} />
          <Stat label="Cuerpo médico" value={<Dots value={qStars(tr.quality.medical)} />} />
          <Stat label="Preparación mental" value={<Dots value={qStars(tr.quality.mental)} />} />
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          {msg && <span role="status" className="text-[13px] text-soft">{msg}</span>}
          <Button variant="primary" icon="save" disabled={!dirty} onClick={() => void save()}>Guardar plan</Button>
        </div>
      </Card>
      {tr.advice.length > 0 && (
        <Card title="Consejos del cuerpo técnico" icon="bulb">
          <ul className="flex flex-col gap-2 text-[13px]">{tr.advice.map((a) => (
            <li key={a.playerId} className="flex items-start gap-2.5">
              <Badge tone={a.kind === 'rest' ? 'warn' : a.kind === 'risk' ? 'bad' : 'accent'}>{a.kind === 'rest' ? 'Descanso' : a.kind === 'risk' ? 'Riesgo' : 'Minutos'}</Badge>
              <span><PlayerLink id={a.playerId} name={a.name} />: <span className="text-soft">{a.text}</span></span>
            </li>
          ))}</ul>
        </Card>
      )}
    </div>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v === null || v === 0) return <span className="text-muted">—</span>;
  return <span className={cx('num font-semibold', v > 0 ? 'text-good-text' : 'text-bad-text')}>{v > 0 ? `+${v}` : v}</span>;
}

function IndividualTab({ tr, onSaved }: { tr: Tr; onSaved: (t: Tr) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const set = async (playerId: string, focus: IndividualFocus, position: Position | null) => {
    setErr(null);
    try { onSaved(await game('setIndividualTraining', { playerId, focus, position })); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Card padded>
      {err && <p role="alert" className="mb-2 text-[13px] text-bad-text">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted">
            <th className="py-2 font-medium">Pos.</th><th className="font-medium">Jugador</th><th className="font-medium">Edad</th><th className="font-medium">Nivel</th><th className="font-medium">Potencial</th>
            <th className="font-medium" title="Variación de nivel esta temporada">Temporada</th><th className="font-medium" title="Atributos que han subido / bajado en las últimas semanas">Últ. semanas</th>
            <th className="font-medium">Foco individual</th><th className="font-medium">Posición nueva</th><th className="font-medium">Condición</th>
          </tr></thead>
          <tbody>{tr.rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="py-1.5"><Badge tone="accent">{t(`pos.${r.position}`)}</Badge></td>
              <td><PlayerLink id={r.id} name={r.name} />{r.injury && <Icon name="medical" size={12} className="ml-1 inline text-bad-text" />}</td>
              <td className="num">{r.age}</td>
              <td><Dots value={r.caStars} /></td><td><Dots value={r.paStars} variant="potential" /></td>
              <td><Delta v={r.seasonDelta} /></td>
              <td className="num">{r.up ? <span className="text-good-text">▲{r.up}</span> : null} {r.down ? <span className="text-bad-text">▼{r.down}</span> : null}{!r.up && !r.down ? <span className="text-muted">—</span> : null}</td>
              <td><select className={sel} value={r.focus} aria-label={`Foco de ${r.name}`} onChange={(e) => void set(r.id, e.target.value as IndividualFocus, r.learning as Position | null)}>
                {tr.focusOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></td>
              <td><select className={sel} value={r.learning ?? ''} aria-label={`Posición nueva de ${r.name}`} onChange={(e) => void set(r.id, r.focus as IndividualFocus, (e.target.value || null) as Position | null)}>
                <option value="">Ninguna</option>{POSITIONS.filter((p) => p !== r.position).map((p) => <option key={p} value={p}>{t(`pos.${p}`)}</option>)}</select>
                {r.learning && <span className="ml-1.5 text-xs text-muted">{r.learningLevel}/20</span>}</td>
              <td><span className="flex items-center gap-2"><Bar value={r.condition} width={44} label={`Condición de ${r.name}`} /><span className="num">{r.condition}%</span></span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">El foco individual acelera un grupo de atributos (a costa de un poco del resto). Aprender una posición lleva meses y depende de la versatilidad del jugador.</p>
    </Card>
  );
}

function MedicalTab({ tr }: { tr: Tr }) {
  const injured = tr.rows.filter((r) => r.injury);
  const risky = tr.rows.filter((r) => !r.injury && r.risk !== 'low').sort((a, b) => (a.risk === 'high' ? -1 : 1) - (b.risk === 'high' ? -1 : 1));
  return (
    <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
      <Card title="Lesionados" icon="medical">
        {injured.length === 0 ? <Empty>No hay lesionados.</Empty> : (
          <ul className="flex flex-col gap-3 text-[13px]">{injured.map((r) => (
            <li key={r.id}>
              <div className="flex items-center gap-2"><PlayerLink id={r.id} name={r.name} /><span className="text-muted">· {r.injury!.type}</span><span className="ml-auto num">{r.injury!.days} días</span></div>
              <div className="mt-1"><Bar value={Math.round((1 - r.injury!.days / Math.max(1, r.injury!.total)) * 100)} tone="good" width="100%" label={`Recuperación de ${r.name}`} /></div>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="Riesgo de lesión" icon="alert">
        {risky.length === 0 ? <Empty>Nadie con riesgo elevado con la carga actual.</Empty> : (
          <ul className="flex flex-col gap-1.5 text-[13px]">{risky.map((r) => (
            <li key={r.id} className="flex items-center gap-3"><span className="flex-1"><PlayerLink id={r.id} name={r.name} /></span><span className="num text-muted">{r.condition}%</span><Badge tone={r.risk === 'high' ? 'bad' : 'warn'}>{r.risk === 'high' ? 'Alto' : 'Medio'}</Badge></li>
          ))}</ul>
        )}
        <p className="mt-3 text-xs text-muted">El riesgo sube con la carga de entrenamiento, el cansancio y la propensión a lesionarse de cada jugador. Fisios y médicos lo reducen y acortan las bajas.</p>
      </Card>
      <Card title="Lesiones en los entrenamientos" icon="history">
        {tr.injuryLog.length === 0 ? <Empty>Ninguna esta temporada.</Empty> : (
          <ul className="flex flex-col gap-1.5 text-[13px]">{tr.injuryLog.map((l, i) => (
            <li key={i} className="flex gap-3"><span className="w-16 shrink-0 text-xs text-muted">{fmtDate(l.date)}</span><span><PlayerLink id={l.playerId} name={l.name} /> <span className="text-muted">· {l.text}</span></span></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function YouthTab({ tr }: { tr: Tr }) {
  return (
    <Card title="Jugadores de la cantera (hasta 19 años)" icon="star" actions={tr.lastIntake ? <span className="text-xs text-muted">Última hornada: {fmtDate(tr.lastIntake.date)}</span> : undefined}>
      {tr.youth.length === 0 ? <Empty>No hay juveniles en la plantilla. Cada verano llega una nueva hornada.</Empty> : (
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-2 font-medium">Pos.</th><th className="font-medium">Jugador</th><th className="font-medium">Edad</th><th className="font-medium">Nivel</th><th className="font-medium">Potencial</th><th className="font-medium">Temporada</th><th className="font-medium">Personalidad</th></tr></thead>
          <tbody>{tr.youth.map((y) => (
            <tr key={y.id} className="border-t border-line">
              <td className="py-1.5"><Badge tone="accent">{t(`pos.${y.position}`)}</Badge></td>
              <td><PlayerLink id={y.id} name={y.name} />{y.isNew && <Badge tone="good" className="ml-1.5">Nuevo</Badge>}</td>
              <td className="num">{y.age}</td><td><Dots value={y.caStars} /></td><td><Dots value={y.paStars} variant="potential" /></td>
              <td><Delta v={y.seasonDelta} /></td><td className="text-soft">{y.personality}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-muted">La calidad de cada hornada depende de las instalaciones de la cantera ({tr.facilities.youth}/20), la captación ({tr.facilities.youthRecruitment}/20) y la formación ({tr.facilities.juniorCoaching}/20). Los jóvenes progresan más si juegan y con buenos entrenadores de cantera.</p>
    </Card>
  );
}

function StaffTab({ tr }: { tr: Tr }) {
  return (
    <Card title="Cuerpo técnico" icon="club">
      <ul className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {tr.staff.map((s) => (
          <li key={s.id} className="rounded-xl border border-line bg-card2 px-4 py-3 text-[13px]">
            <div className="flex items-baseline gap-2"><b>{s.name}</b><span className="text-xs text-muted">{s.age} años</span></div>
            <div className="mb-2 text-xs text-muted">{s.role}</div>
            <ul className="flex flex-col gap-1">{s.key.map((k) => (
              <li key={k.label} className="flex items-center gap-2"><span className="flex-1 text-soft">{k.label}</span><Bar value={k.value * 5} tone={toneFor(k.value * 5, 70, 45)} width={60} label={k.label} /><span className="num w-6 text-right font-semibold">{k.value}</span></li>
            ))}</ul>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">La calidad de cada área de entrenamiento sale de los dos mejores entrenadores en ella. Contratar y despedir personal llegará con la IA de clubes (Fase 8).</p>
    </Card>
  );
}
