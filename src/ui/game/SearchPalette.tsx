import { useEffect, useRef, useState } from 'react';
import { game } from '../../store/gameClient';
import { useGame, type GameScreen } from '../../store/gameStore';
import { Icon, type IconName } from '../icons';
import { cx } from '../kit';

type Result = Awaited<ReturnType<typeof game<'search'>>>;
interface Item { key: string; label: string; detail: string; icon: IconName; run: () => void }

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { go, dashboard } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => { void game('search', { q }).then(setRes); }, 120);
    return () => clearTimeout(id);
  }, [q, open]);

  const close = () => onClose();
  const items: Item[] = [
    ...(res?.screens ?? []).map((s) => ({ key: `s${s.id}`, label: s.label, detail: 'Pantalla', icon: 'grid' as IconName, run: () => go(s.id as GameScreen, s.id === 'club' ? { clubId: dashboard?.club.id ?? null } : {}) })),
    ...(res?.players ?? []).map((p) => ({ key: `p${p.id}`, label: p.name, detail: p.detail, icon: 'squad' as IconName, run: () => go('player', { playerId: p.id }) })),
    ...(res?.clubs ?? []).map((c) => ({ key: `c${c.id}`, label: c.name, detail: c.detail, icon: 'club' as IconName, run: () => go('club', { clubId: c.id }) })),
  ];
  const pick = (it: Item | undefined) => { if (!it) return; it.run(); close(); };

  return (
    <dialog ref={ref} onClose={close} onCancel={close} aria-label="Buscador"
      className="mx-auto mt-[12vh] w-[calc(100%-32px)] max-w-[620px] rounded-2xl border border-line2 bg-card p-0 text-text backdrop:bg-black/70">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Icon name="search" className="text-muted" />
        <label htmlFor="global-search" className="sr-only">Buscar</label>
        <input id="global-search" ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Jugadores, clubes o pantallas…" autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); pick(items[sel]); }
          }}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint focus-visible:outline-none" />
        <span className="rounded-[5px] border border-[#3A3448] px-1.5 text-[11px] text-muted">Esc</span>
      </div>
      <ul role="listbox" aria-label="Resultados" className="max-h-[50vh] overflow-auto p-2">
        {items.map((it, i) => (
          <li key={it.key}>
            <button type="button" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => pick(it)}
              className={cx('flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left', i === sel ? 'bg-accent-bg' : 'hover:bg-card2')}>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-card2 text-accent-text"><Icon name={it.icon} /></span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.label}</span><span className="block truncate text-xs text-muted">{it.detail}</span></span>
              {i === sel && <Icon name="arrowRight" className="text-accent-soft" />}
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{q.length < 2 ? 'Escribe al menos dos letras' : 'Sin resultados'}</li>}
      </ul>
    </dialog>
  );
}
