/**
 * Componentes base del diseño de Banquillo (oscuro + acento morado).
 * Regla de color: verde = bien, ámbar = atención, rojo = mal, gris = neutro;
 * morado = acción, selección y escala de atributos.
 */
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- botones
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-accent',
  secondary: 'bg-card text-text border border-line2 hover:bg-card2',
  ghost: 'bg-transparent text-soft border border-line2 hover:bg-card2 hover:text-text',
  soft: 'bg-accent-bg text-accent-text border border-accent-line hover:bg-raise',
  danger: 'bg-transparent text-bad-text border border-bad-bg hover:bg-bad-bg',
};

export function Button({ variant = 'secondary', icon, size = 'md', children, className, ...rest }: { variant?: BtnVariant; icon?: IconName; size?: 'sm' | 'md' | 'lg' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sz = size === 'sm' ? 'h-8 px-3 text-xs gap-1.5 rounded-lg' : size === 'lg' ? 'h-11 px-5 text-[15px] gap-2.5 rounded-[10px] font-display font-semibold' : 'h-9 px-3.5 text-[13px] gap-2 rounded-[9px]';
  return (
    <button type="button" {...rest} className={cx('inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45', sz, BTN[variant], className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx('inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-line2 text-soft hover:bg-card2 hover:text-text disabled:opacity-40', className)}>
      <Icon name={icon} />
    </button>
  );
}

// ---------------------------------------------------------------- tarjetas
export function Card({ title, icon, actions, children, className, raised, padded = true, id }: {
  title?: ReactNode; icon?: IconName; actions?: ReactNode; children: ReactNode; className?: string; raised?: boolean; padded?: boolean; id?: string;
}) {
  return (
    <section aria-label={typeof title === 'string' ? title : undefined} id={id} className={cx('rounded-2xl border', raised ? 'border-accent-line bg-[#1B1626]' : 'border-line bg-card', padded && 'p-5', className)}>
      {(title || actions) && (
        <header className={cx('mb-3 flex items-center gap-2', !padded && 'px-5 pt-4')}>
          {icon && <Icon name={icon} className="text-accent-soft" />}
          {title && <h2 className="flex-1 font-display text-[15px] font-bold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="text-[13px] text-muted">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}

// ---------------------------------------------------------------- selección
export interface TabItem<T extends string> { id: T; label: string; icon?: IconName }

export function Tabs<T extends string>({ items, value, onChange, label, right }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string; right?: ReactNode }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex flex-wrap items-end gap-1 border-b border-line">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.id)}
            className={cx('-mb-px flex h-10 items-center gap-2 border-b-2 px-3.5 text-sm', on ? 'border-accent font-semibold text-text' : 'border-transparent text-muted hover:text-soft')}>
            {it.icon && <Icon name={it.icon} />}{it.label}
          </button>
        );
      })}
      {right && <div className="mb-1.5 ml-auto flex gap-2">{right}</div>}
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(it.id)}
            className={cx('flex h-[34px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium', on ? 'border-accent bg-accent text-white' : 'border-line2 text-soft hover:bg-card2')}>
            {it.icon && <Icon name={it.icon} size={15} />}{it.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label, strong, columns }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; strong?: boolean; columns?: number;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('grid gap-1', strong && 'rounded-xl bg-[#110F18] p-1')} style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx('min-h-8 rounded-lg px-1 text-xs', strong ? 'h-10' : 'border',
              on ? (strong ? 'bg-accent font-semibold text-white' : 'border-accent bg-[#2E2545] font-semibold text-text') : (strong ? 'text-soft hover:bg-card2' : 'border-line text-muted hover:bg-card2'))}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cx('flex h-9 cursor-pointer items-center gap-2 rounded-[9px] border px-3 text-[13px]', checked ? 'border-[#4C3D73] bg-accent-bg text-[#E9E2FF]' : 'border-line text-soft hover:bg-card2')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-accent" />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- indicadores
export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'accent';

/** Tono semántico para porcentajes (condición, ritmo, moral...). */
export function toneFor(pct: number, good = 85, warn = 70): Tone {
  return pct >= good ? 'good' : pct >= warn ? 'warn' : 'bad';
}

const BAR: Record<Tone, string> = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', neutral: 'bg-muted', accent: 'bg-accent-soft' };

export function Bar({ value, tone, width = 56, label }: { value: number; tone?: Tone; width?: number | string; label?: string }) {
  const t = tone ?? toneFor(value);
  return (
    <span className="inline-block h-[5px] rounded-full bg-[#2A2536] align-middle" style={{ width }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label}>
      <span className={cx('block h-[5px] rounded-full', BAR[t])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

const BADGE: Record<Tone | 'orange', string> = {
  good: 'bg-good-bg text-[#86EFAC]', warn: 'bg-warn-bg text-warn', bad: 'bg-bad-bg text-bad-text', neutral: 'bg-line2 text-soft',
  accent: 'bg-accent-bg text-[#DDD6FE]', orange: 'bg-orange-bg text-orange',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone | 'orange'; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold', BADGE[tone], className)}>{children}</span>;
}

/** Puntos de nivel (0,5-5). Rellenos = nivel actual; tenues = potencial. */
export function Dots({ value, variant = 'filled', label }: { value: number; variant?: 'filled' | 'potential'; label?: string }) {
  return (
    <span className="inline-flex gap-[3px] align-middle" role="img" aria-label={label ?? `${value} de 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        const on = variant === 'filled' ? '#A78BFA' : '#5B4890';
        return (
          <span key={i} className="inline-block h-[9px] w-[9px] rounded-full"
            style={{ background: fill >= 1 ? on : fill > 0 ? `linear-gradient(90deg, ${on} 50%, #2A2536 50%)` : '#2A2536' }} />
        );
      })}
    </span>
  );
}

export function FormBadge({ o, size = 28 }: { o: 'W' | 'D' | 'L' | string | null; size?: number }) {
  const label = o === 'W' ? 'V' : o === 'D' ? 'E' : o === 'L' ? 'D' : '·';
  const cls = o === 'W' ? 'bg-good-strong text-white' : o === 'D' ? 'bg-[#3A3448] text-text' : o === 'L' ? 'bg-bad-strong text-white' : 'bg-line text-faint';
  const name = o === 'W' ? 'victoria' : o === 'D' ? 'empate' : o === 'L' ? 'derrota' : 'sin jugar';
  return <span className={cx('inline-flex items-center justify-center rounded-lg text-xs font-bold', cls)} style={{ width: size, height: size }} title={name} aria-label={name}>{label}</span>;
}

export function Crest({ color, size = 40 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-[11px] bg-[#1C1827]" style={{ width: size, height: size, border: `2px solid ${color}` }} aria-hidden="true" />;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('font-display text-xl font-bold', tone === 'good' && 'text-good-text', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Color de un atributo 1-20 (escala morada; muy bajo en rojo). */
export function attrClass(v: number): string {
  return v >= 16 ? 'text-accent-text' : v >= 11 ? 'text-text' : v >= 6 ? 'text-[#8E88A0]' : 'text-bad';
}
export function attrBarColor(v: number): string {
  return v >= 16 ? '#A78BFA' : v >= 11 ? '#B7B1C6' : v >= 6 ? '#5C566C' : '#F87171';
}

/** Nota de partido: verde alta, ámbar baja. */
export function ratingClass(r: number | null | undefined): string {
  if (!r) return 'text-muted';
  return r >= 7.2 ? 'text-good-text' : r < 6.4 ? 'text-warn' : 'text-text';
}

export const money = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} M€` : v >= 1e3 ? `${Math.round(v / 1e3)} k€` : `${Math.round(v)} €`;

// ---------------------------------------------------------------- diálogo
export function Dialog({ open, onClose, title, children, width = 640 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-label={title}
      className="m-auto max-h-[85vh] w-[calc(100%-32px)] overflow-auto rounded-2xl border border-line2 bg-card p-0 text-text backdrop:bg-black/70" style={{ maxWidth: width }}>
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="flex-1 font-display text-base font-bold">{title}</h2>
        <IconButton icon="close" label="Cerrar" onClick={onClose} className="border-0" />
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[13px] text-muted">{children}</p>;
}
