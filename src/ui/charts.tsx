/**
 * Gráficas pequeñas y sobrias: línea de una serie con cruz y tooltip al pasar el ratón,
 * y barras horizontales para desgloses. Texto siempre en tinta del tema, no en el color
 * de la serie.
 */
import { useEffect, useId, useRef, useState } from 'react';

export function LineChart({ points, height = 180, format, label, zero = true, color = '#A78BFA', domain }: {
  points: { x: string; y: number }[];
  height?: number;
  format: (v: number) => string;
  label: string;
  zero?: boolean;
  color?: string;
  /** Escala fija [mín, máx] (p. ej. 0-100). */
  domain?: [number, number];
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(240, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) return <div ref={box}><p className="py-6 text-center text-[13px] text-muted">Aún no hay datos suficientes.</p></div>;
  const H = height, padL = 64, padR = 12, padT = 12, padB = 26;
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (zero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.06; max += span * 0.06;
  if (domain) [min, max] = domain;
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const h = hover !== null ? points[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className="relative" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - padL) / (W - padL - padR)) * (points.length - 1)))));
        }}>
        <title id={`${id}-t`}>{`${label}: de ${format(points[0]!.y)} a ${format(points.at(-1)!.y)}`}</title>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#2A2536" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#8E88A0">{format(v)}</text>
          </g>
        ))}
        {zero && min < 0 && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#4A4458" strokeWidth={1} />}
        {points.map((p, i) => i % labelEvery === 0 || i === points.length - 1 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#8E88A0">{p.x}</text> : null)}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#6E6880" strokeDasharray="3 3" />
          <circle cx={x(hover)} cy={y(h.y)} r={4.5} fill={color} stroke="#16131D" strokeWidth={2} />
        </>}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded-lg border border-line2 bg-raise px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}>
          <div className="text-muted">{h.x}</div><div className="num font-semibold text-text">{format(h.y)}</div>
        </div>
      )}
    </div>
  );
}

/** Desglose en barras horizontales (una serie; el importe va en tinta, no en color). */
export function BreakdownBars({ rows, format, color = '#8B5CF6' }: { rows: { label: string; value: number; previous?: number | null }[]; format: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.previous ?? 0)));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-[13px]" title={r.previous != null ? `Temporada anterior: ${format(r.previous)}` : undefined}>
          <div className="mb-1 flex justify-between"><span className="text-soft">{r.label}</span><span className="num font-semibold">{format(r.value)}</span></div>
          <div className="relative h-1.5 rounded bg-[#2A2536]">
            <div className="h-1.5 rounded" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
            {r.previous != null && r.previous > 0 && <div className="absolute top-[-3px] h-3 w-0.5 rounded bg-soft" style={{ left: `${(r.previous / max) * 100}%` }} aria-hidden="true" />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Dos series en la misma escala (p. ej. xG a favor y en contra), con leyenda y tooltip conjunto. */
export function DualLineChart({ points, series, height = 200, format, label }: {
  points: { x: string; a: number; b: number }[];
  series: [{ label: string; color: string }, { label: string; color: string }];
  height?: number;
  format: (v: number) => string;
  label: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(260, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const legend = (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-soft">
      {series.map((s) => <span key={s.label} className="flex items-center gap-1.5"><span className="h-1 w-5 rounded" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
  if (points.length < 2) return <div ref={box}>{legend}<p className="py-6 text-center text-[13px] text-muted">Aún no hay partidos suficientes.</p></div>;
  const H = height, padL = 40, padR = 24, padT = 10, padB = 24;
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b])) * 1.1;
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const path = (k: 'a' | 'b') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const ticks = [0, max / 3, (2 * max) / 3, max];
  const every = Math.max(1, Math.ceil(points.length / 7));
  const h = hover !== null ? points[hover] : null;
  return (
    <div ref={box} className="relative">
      {legend}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - padL) / (W - padL - padR)) * (points.length - 1)))));
        }}>
        <title id={`${id}-t`}>{label}</title>
        {ticks.map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#2A2536" /><text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#8E88A0">{format(v)}</text></g>)}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#8E88A0">{p.x}</text> : null))}
        <path d={path('b')} fill="none" stroke={series[1].color} strokeWidth={2} strokeLinejoin="round" />
        <path d={path('a')} fill="none" stroke={series[0].color} strokeWidth={2} strokeLinejoin="round" />
        {h && hover !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#6E6880" strokeDasharray="3 3" />
          <circle cx={x(hover)} cy={y(h.b)} r={4} fill={series[1].color} stroke="#16131D" strokeWidth={2} />
          <circle cx={x(hover)} cy={y(h.a)} r={4} fill={series[0].color} stroke="#16131D" strokeWidth={2} />
        </>}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-6 rounded-lg border border-line2 bg-raise px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})` }}>
          <div className="text-muted">{h.x}</div>
          <div className="num text-text">{series[0].label}: <b>{format(h.a)}</b></div>
          <div className="num text-text">{series[1].label}: <b>{format(h.b)}</b></div>
        </div>
      )}
    </div>
  );
}
