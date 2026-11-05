import { useEffect, useState } from 'react';
import { FootballPitch, pitchPos } from '../pitch';
import { ATTRIBUTE_GROUPS, type AttrKey } from '../../data/attributes';
import type { PlayerProfile, SquadTableRow } from '../../engine/profileViews';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtMonthYear, fmtRating } from '../format';
import { Icon } from '../icons';
import { attrBarColor, attrClass, Badge, Bar, Button, Card, cx, Dialog, Dots, money, ratingClass, Stat, toneFor } from '../kit';
import { ClubLink } from './shared';
import { CompareDialog } from './SquadScreen';

const PITCH: Record<string, [number, number]> = {
  GK: [8, 50], LB: [26, 14], CB: [22, 50], RB: [26, 86], LWB: [40, 10], RWB: [40, 90], DM: [38, 50],
  LM: [56, 14], CM: [52, 50], RM: [56, 86], LW: [76, 16], AM: [70, 50], RW: [76, 84], ST: [88, 50],
};

function Radar({ values, average, label }: { values: { label: string; value: number }[]; average: { label: string; value: number }[]; label: string }) {
  const cx0 = 140, cy0 = 125, R = 92, n = values.length;
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx0 + Math.cos(a) * R * f, cy0 + Math.sin(a) * R * f] as const;
  };
  const poly = (arr: { value: number }[]) => arr.map((v, i) => pt(i, Math.min(1, v.value / 20)).map((x) => x.toFixed(1)).join(',')).join(' ');
  const best = values.slice().sort((a, b) => b.value - a.value).slice(0, 2).map((v) => v.label.toLowerCase());
  const worst = values.slice().sort((a, b) => a.value - b.value).slice(0, 2).map((v) => v.label.toLowerCase());
  return (
    <svg viewBox="0 0 280 250" width="100%" role="img" aria-label={`${label}. Destaca en ${best.join(' y ')}; flojo en ${worst.join(' y ')}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={values.map((_, i) => pt(i, f).join(',')).join(' ')} fill="none" stroke="#2A2536" />)}
      {values.map((v, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.18);
        return (
          <g key={v.label}>
            <line x1={cx0} y1={cy0} x2={x} y2={y} stroke="#2A2536" />
            <text x={lx} y={ly + 4} fill="#A39DB3" fontSize="11" textAnchor="middle">{v.label}</text>
          </g>
        );
      })}
      <polygon points={poly(average)} fill="none" stroke="#6E6880" strokeWidth="1.5" strokeDasharray="4 3" />
      <polygon points={poly(values)} fill="#8B5CF6" fillOpacity="0.28" stroke="#A78BFA" strokeWidth="2" />
    </svg>
  );
}

export function PlayerScreen() {
  const { nav, go, dashboard } = useGame();
  const [p, setP] = useState<PlayerProfile | null>(null);
  const [squad, setSquad] = useState<SquadTableRow[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const id = nav.playerId;
  const load = () => { if (id) void game('player', { id }).then(setP); };
  useEffect(load, [id, dashboard?.date]);
  useEffect(() => { void game('squadTable').then(setSquad); }, []);
  if (!p) return <p className="text-sm text-muted">Cargando…</p>;

  const idx = squad.findIndex((r) => r.id === p.id);
  const prev = idx > 0 ? squad[idx - 1] : undefined;
  const next = idx >= 0 && idx < squad.length - 1 ? squad[idx + 1] : undefined;
  const est = new Set(p.estimated);
  const isGk = p.mainPosition === 'GK';
  const groups: [string, readonly AttrKey[]][] = isGk
    ? [['Portero', ATTRIBUTE_GROUPS.goalkeeping], ['Mentales', ATTRIBUTE_GROUPS.mental], ['Físicos', ATTRIBUTE_GROUPS.physical]]
    : [['Técnicos', ATTRIBUTE_GROUPS.technical], ['Mentales', ATTRIBUTE_GROUPS.mental], ['Físicos', ATTRIBUTE_GROUPS.physical]];
  const s = p.status;
  const riskTone = s.injuryRisk === 'low' ? 'good' : s.injuryRisk === 'medium' ? 'warn' : 'bad';
  const footLabel = p.foot === 'left' ? 'zurdo' : p.foot === 'right' ? 'diestro' : 'ambidiestro';

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
        {p.club && <><ClubLink id={p.club.id} name={p.club.name} className="text-accent-text" /><span>/</span></>}
        <span>{p.name}</span>
        <div className="flex-1" />
        {p.isUser && <>
          <button type="button" aria-label="Jugador anterior" disabled={!prev} onClick={() => prev && go('player', { playerId: prev.id })} className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-line2 text-soft hover:bg-card2 disabled:opacity-30"><Icon name="chevronLeft" /></button>
          <button type="button" aria-label="Jugador siguiente" disabled={!next} onClick={() => next && go('player', { playerId: next.id })} className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-line2 text-soft hover:bg-card2 disabled:opacity-30"><Icon name="chevronRight" /></button>
        </>}
      </div>

      <Card className="flex flex-wrap items-center gap-6 !p-6">
        <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[20px] bg-accent-bg font-display text-[26px] font-extrabold text-accent-text">{p.initials}</div>
        <div className="min-w-[240px] flex-[1_1_260px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[28px] font-extrabold tracking-tight">{p.name}</h1>
            <Badge tone="accent">{p.positions.filter((x) => x.rating >= 15).map((x) => t(`pos.${x.position}`)).join(' · ')}</Badge>
          </div>
          <div className="mt-1 text-muted">{p.age} años · {p.nationalities.join(' / ')} · {p.heightCm} cm · {footLabel}{p.club ? ` · ${p.club.name}` : ' · Agente libre'}</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <span className="rounded-full border border-line2 px-2.5 py-0.5 text-xs text-soft">{p.personality}</span>
            {p.report.bestRole && <span className="rounded-full border border-line2 px-2.5 py-0.5 text-xs text-soft">{p.report.bestRole}</span>}
            {p.loan && <Badge tone="orange">Cedido</Badge>}
            {s.injury && <Badge tone="bad">{s.injury.type} · {s.injury.days} días</Badge>}
            {s.suspended > 0 && <Badge tone="warn">Sancionado {s.suspended}</Badge>}
          </div>
        </div>
        <div className="grid flex-[1_1_460px] grid-cols-2 gap-5 sm:grid-cols-5">
          <Stat label="Nivel" value={<Dots value={p.caStars} />} hint="actual" />
          <Stat label="Potencial" value={<Dots value={p.paStars} variant="potential" />} hint="estimado" />
          <Stat label="Valor" value={money(p.value)} />
          <Stat label="Salario" value={p.wage ? money(p.wage) : '—'} hint={p.contractExpires ? `hasta ${fmtMonthYear(p.contractExpires)}` : 'sin contrato'} />
          <Stat label="Nota media" value={<span className={ratingClass(p.avgRating)}>{fmtRating(p.avgRating)}</span>} hint={`${p.apps} partidos · ${p.goals} goles`} />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {p.isUser ? <>
          <Button variant="primary" icon="docCheck" disabled title="Disponible con contratos y mercado (Fase 6)">Renovar contrato</Button>
          <Button icon="transfers" disabled title="Disponible con el mercado (Fase 6)">Ofrecer a otros clubes</Button>
          <Button icon="loan" disabled title="Disponible con el mercado (Fase 6)">Ceder</Button>
        </> : <Button variant="primary" icon="transfers" disabled title="Disponible con el mercado (Fase 6)">Hacer una oferta</Button>}
        <Button icon="search" onClick={() => setReportOpen(true)}>Pedir informe</Button>
        <Button icon="star" variant={p.shortlisted ? 'soft' : 'secondary'} onClick={() => void game('toggleShortlist', { id: p.id }).then(load)}>{p.shortlisted ? 'En seguimiento' : 'Seguir'}</Button>
        <div className="flex-1" />
        <Button variant="soft" icon="compare" onClick={() => setPickOpen(true)}>Comparar con…</Button>
      </div>

      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card title="Atributos" icon="sliders" className="lg:col-span-2" actions={
          <div className="hidden flex-wrap gap-3 text-xs text-muted sm:flex">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent-soft" />16-20</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-text" />11-15</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-faint" />6-10</span>
            {est.size > 0 && <span>* estimado</span>}
          </div>
        }>
          <div className="grid gap-7 md:grid-cols-3">
            {groups.map(([title, attrs]) => (
              <div key={title}>
                <div className="mb-2 text-xs uppercase tracking-[0.08em] text-muted">{title}</div>
                {attrs.map((a) => {
                  const v = p.attributes[a];
                  return (
                    <div key={a} className="flex items-center gap-2.5 py-1 text-[13px]">
                      <span className="flex-1 text-soft">{t(`attr.${a}`)}</span>
                      <span className="h-1 w-[54px] rounded-sm bg-[#2A2536]"><span className="block h-1 rounded-sm" style={{ width: `${v * 5}%`, background: attrBarColor(v) }} /></span>
                      <span className={cx('num w-7 text-right font-bold', attrClass(v))}>{v}{est.has(a) && '*'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-[18px]">
          <Card title="Perfil" icon="radar">
            <Radar values={p.radar} average={p.radarAverage.values} label={`Gráfico radar de ${p.name}`} />
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-[3px] w-3.5 bg-accent-soft" />{p.lastName}</span>
              <span className="flex items-center gap-1.5"><span className="w-3.5 border-t-2 border-dashed border-faint" />{p.radarAverage.label}</span>
            </div>
          </Card>
          <Card title="Posiciones" icon="pin">
            <FootballPitch className="!rounded-xl" label={`Posiciones: ${p.positions.map((x) => `${t(`posLong.${x.position}`)} ${x.rating}`).join(', ')}`}>
              {p.positions.filter((x) => x.rating >= 8).map((x) => {
                const [px, py] = PITCH[x.position] ?? [50, 50];
                const { left, top } = pitchPos(px / 100, py / 100);
                const nat = x.rating >= 18;
                return (
                  <span key={x.position} className={cx('absolute flex h-[26px] min-w-[34px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-1.5 text-[11px] font-bold', nat ? 'bg-accent text-white' : x.rating >= 13 ? 'bg-[#2E2545] text-[#DDD6FE] shadow' : 'bg-black/55 text-white/80')}
                    style={{ left: `${left}%`, top: `${top}%` }} title={`${t(`posLong.${x.position}`)}: ${x.rating}/20`}>
                    {t(`pos.${x.position}`)}
                  </span>
                );
              })}
            </FootballPitch>
          </Card>
        </div>
      </div>

      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card title="Estado" icon="heart">
          <div className="flex flex-col gap-3">
            {[
              ['Condición física', `${s.condition} %`, s.condition, toneFor(s.condition)],
              ['Ritmo de partido', `${s.sharpness} %`, s.sharpness, toneFor(s.sharpness)],
              ['Moral', s.morale >= 80 ? 'Muy buena' : s.morale >= 65 ? 'Buena' : s.morale >= 45 ? 'Normal' : 'Baja', s.morale, s.morale >= 65 ? 'good' : s.morale >= 45 ? 'warn' : 'bad'],
              ['Riesgo de lesión', s.injuryRisk === 'low' ? 'Bajo' : s.injuryRisk === 'medium' ? 'Medio' : 'Alto', s.injuryRisk === 'low' ? 20 : s.injuryRisk === 'medium' ? 55 : 85, riskTone],
            ].map(([label, value, pct, tone]) => (
              <div key={label as string}>
                <div className="mb-1.5 flex justify-between text-[13px]"><span className="text-soft">{label}</span><span className="font-semibold">{value}</span></div>
                <Bar value={pct as number} tone={tone as never} width="100%" label={label as string} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Informe del cuerpo técnico" icon="doc">
          <p className="mb-2.5 leading-relaxed text-soft">{p.report.text}</p>
          <div className="flex flex-wrap gap-2">
            {p.report.strengths.length > 0 && <Badge tone="good">Puntos fuertes: {p.report.strengths.join(', ').toLowerCase()}</Badge>}
            {p.report.weaknesses.length > 0 && <Badge tone="bad">A mejorar: {p.report.weaknesses.join(', ').toLowerCase()}</Badge>}
          </div>
        </Card>
        <Card title="Historial" icon="history">
          {p.history.length === 0 ? <p className="text-[13px] text-muted">Sin partidos oficiales todavía.</p> : (
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Temporada</th><th className="font-medium">Club</th><th className="text-right font-medium">PJ</th><th className="text-right font-medium">Goles</th><th className="text-right font-medium">Nota</th></tr></thead>
              <tbody>{p.history.map((h) => (
                <tr key={`${h.season}${h.club}`} className="border-t border-[#221E2C]"><td className="py-1.5">{h.season}</td><td>{h.club}</td><td className="text-right">{h.apps}</td><td className="text-right">{h.goals}</td><td className={cx('text-right font-semibold', ratingClass(h.rating))}>{fmtRating(h.rating)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>

      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} title={`Informe sobre ${p.name}`}>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-6"><Stat label="Nivel actual" value={<Dots value={p.caStars} />} /><Stat label="Potencial" value={<Dots value={p.paStars} variant="potential" />} /><Stat label="Mejor rol" value={<span className="text-base">{p.report.bestRole ?? '—'}</span>} /></div>
          <p className="leading-relaxed text-soft">{p.report.text}</p>
          <p className="text-xs text-muted">Los ojeadores y los informes con margen de error llegan con el scouting (Fase 6). De tus jugadores, el cuerpo técnico conoce todos los datos.</p>
        </div>
      </Dialog>
      <Dialog open={pickOpen} onClose={() => setPickOpen(false)} title="Comparar con…" width={480}>
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-auto">
          {squad.filter((r) => r.id !== p.id).sort((a, b) => Number(b.group === squad[idx]?.group) - Number(a.group === squad[idx]?.group)).map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { setPickOpen(false); setCompare([p.id, r.id]); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-card2">
                <Badge tone="accent">{t(`pos.${r.position}`)}</Badge><span className="flex-1">{r.name}</span><Dots value={r.caStars} />
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
      <CompareDialog ids={compare} onClose={() => setCompare(null)} />
    </div>
  );
}
