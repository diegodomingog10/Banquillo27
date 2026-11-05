import { useEffect, useState } from 'react';
import type { BoardRequestKind } from '../../engine/board';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { LineChart } from '../charts';
import { fmtDate } from '../format';
import { Icon, type IconName } from '../icons';
import { Badge, Bar, Button, Card, Empty, PageHeader } from '../kit';

type BoardData = Awaited<ReturnType<typeof game<'board'>>>;

const REQ: Record<BoardRequestKind, { label: string; icon: IconName; hint: string }> = {
  transferBudget: { label: 'Más presupuesto de fichajes', icon: 'transfers', hint: 'Necesita confianza y cuentas saneadas.' },
  wageBudget: { label: 'Más presupuesto salarial', icon: 'finance', hint: 'Sube el límite semanal de salarios.' },
  training: { label: 'Mejorar las instalaciones de entrenamiento', icon: 'training', hint: 'Obras de unos seis meses.' },
  youth: { label: 'Mejorar las instalaciones de la cantera', icon: 'squad', hint: 'Obras de unos seis meses.' },
};
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function BoardScreen() {
  const { dashboard } = useGame();
  const [b, setB] = useState<BoardData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void game('board').then(setB); }, [dashboard?.date]);
  if (!b) return <p className="text-sm text-muted">Cargando…</p>;
  const tone = b.confidence >= 60 ? 'good' : b.confidence >= 35 ? 'warn' : 'bad';
  const ask = async (kind: BoardRequestKind) => {
    try { const r = await game('boardRequest', { kind }); setB(r.view); setMsg(r.text); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Directiva" subtitle={b.club.name} />
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card title="Confianza" icon="gauge" actions={<Badge tone={tone}>{b.verdict}</Badge>}>
          <div className="mb-3 flex items-center gap-4">
            <span className={`font-display text-4xl font-extrabold ${tone === 'good' ? 'text-good-text' : tone === 'warn' ? 'text-warn' : 'text-bad-text'}`}>{b.confidence}</span>
            <div className="flex-1"><Bar value={b.confidence} tone={tone} width="100%" label="Confianza de la directiva" /></div>
          </div>
          <LineChart label="Confianza a principio de mes" height={140} zero={false} domain={[0, 100]} format={(v) => String(Math.round(v))}
            points={b.history.map((h) => ({ x: `${MONTHS[Number(h.date.slice(5, 7)) - 1]} ${h.date.slice(2, 4)}`, y: h.value }))} />
          {b.confidence < 30 && <p className="mt-2 flex items-center gap-2 text-[13px] text-bad-text"><Icon name="alert" size={15} />Si la confianza sigue cayendo, la directiva te destituirá.</p>}
        </Card>
        <Card title="Objetivos de la temporada" icon="target">
          <ul className="flex flex-col gap-2.5 text-[13px]">
            {b.objectives.map((o, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="flex-1 first-letter:uppercase">{o.label}{o.competition ? <span className="text-muted"> · {o.competition}</span> : null}</span>
                <Badge tone={o.importance === 'critical' ? 'bad' : o.importance === 'high' ? 'warn' : 'neutral'}>{o.importance === 'critical' ? 'Imprescindible' : o.importance === 'high' ? 'Importante' : o.importance === 'medium' ? 'Deseable' : 'Secundario'}</Badge>
                {o.progress && <Badge tone={o.progress === 'behind' ? 'bad' : 'good'}>{o.progress === 'ahead' ? 'Por encima' : o.progress === 'onTrack' ? 'En camino' : 'Por debajo'}</Badge>}
              </li>
            ))}
          </ul>
          {b.demand && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-warn-bg bg-[#221C10] px-3 py-2.5 text-[13px]">
              <Icon name="flag" className="mt-0.5 text-warn" size={15} />
              <span><b>Petición de la directiva:</b> {b.demand.text} antes del {fmtDate(b.demand.deadline)}.</span>
            </div>
          )}
        </Card>
        <Card title="Qué ha influido" icon="history">
          {b.factors.length ? (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {b.factors.map((f, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-xs text-muted">{fmtDate(f.date)}</span>
                  <span className="flex-1 text-soft">{f.text}</span>
                  <span className={`num font-semibold ${f.delta >= 0 ? 'text-good-text' : 'text-bad-text'}`}>{f.delta > 0 ? '+' : ''}{f.delta.toFixed(1).replace('.', ',')}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>Aún no hay valoraciones: llegarán con los primeros partidos.</Empty>}
        </Card>
        <Card title="Peticiones a la directiva" icon="doc">
          <ul className="flex flex-col gap-3">
            {b.requests.map((r) => (
              <li key={r.kind} className="flex flex-wrap items-center gap-3 text-[13px]">
                <Icon name={REQ[r.kind].icon} className="text-accent-text" />
                <div className="min-w-0 flex-1">
                  <div>{REQ[r.kind].label}</div>
                  <div className="text-xs text-muted">{r.last ? r.last.text : REQ[r.kind].hint}</div>
                </div>
                <Button size="sm" disabled={r.wait > 0} onClick={() => void ask(r.kind)}>{r.wait > 0 ? `En ${r.wait} días` : 'Pedir'}</Button>
              </li>
            ))}
          </ul>
          {b.projects.length > 0 && <p className="mt-3 text-xs text-muted">Obras en marcha: {b.projects.map((p) => `${p.kind === 'training' ? 'entrenamiento' : 'cantera'} (hasta ${fmtDate(p.done)})`).join(', ')}.</p>}
          {msg && <p role="status" className="mt-3 rounded-lg border border-line2 bg-card2 px-3 py-2 text-[13px] text-soft">{msg}</p>}
        </Card>
      </div>
    </div>
  );
}

/** Pantalla tras el despido: elegir una de las ofertas de trabajo. */
export function FiredScreen() {
  const { setDashboard, go } = useGame();
  const [b, setB] = useState<BoardData | null>(null);
  useEffect(() => { void game('board').then(setB); }, []);
  if (!b) return null;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[18px] py-6">
      <Card className="!p-7 text-center">
        <Icon name="logout" size={28} className="mx-auto text-bad-text" />
        <h1 className="mt-3 font-display text-2xl font-extrabold">Destituido de {b.club.name}</h1>
        <p className="mt-2 text-soft">La directiva ha perdido la confianza en el proyecto. Estos clubes te ofrecen su banquillo:</p>
      </Card>
      {b.offers.length ? b.offers.map((o) => (
        <Card key={o.id} className="flex flex-wrap items-center gap-4">
          <div className="flex-1"><div className="font-display text-lg font-bold">{o.name}</div><div className="text-[13px] text-muted">{o.league} · reputación {o.reputation.toLocaleString('es')}</div></div>
          <Button variant="primary" icon="check" onClick={() => void game('acceptJob', { clubId: o.id }).then((d) => { setDashboard(d); go('dashboard'); })}>Aceptar el puesto</Button>
        </Card>
      )) : <Card><Empty>Nadie te ofrece trabajo ahora mismo. Puedes volver al menú y empezar una partida nueva.</Empty></Card>}
    </div>
  );
}
