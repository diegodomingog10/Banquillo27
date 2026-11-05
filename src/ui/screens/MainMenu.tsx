import { useEffect, useState } from 'react';
import type { SaveMeta } from '../../store/saves';
import { game } from '../../store/gameClient';
import { useGame, type Screen } from '../../store/gameStore';
import { fmtDate } from '../format';
import { Icon, type IconName } from '../icons';
import { Badge, Button, Crest, IconButton } from '../kit';

const ITEMS: { id: Screen; label: string; hint: string; icon: IconName }[] = [
  { id: 'newGame', label: 'Nueva partida', hint: 'Elige país, liga, club y tu perfil de entrenador', icon: 'plus' },
  { id: 'import', label: 'Importar base de datos', hint: 'Tus datos reales en CSV o JSON', icon: 'download' },
  { id: 'generate', label: 'Generar mundo ficticio', hint: '8 naciones, 320 clubes, con semilla', icon: 'globe' },
  { id: 'options', label: 'Opciones', hint: 'Tamaño de letra y guardado automático', icon: 'settings' },
];

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

export function MainMenu() {
  const { setScreen, setDashboard, go } = useGame();
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => game('listSaves').then(setSaves).catch((e: Error) => setError(e.message));
  useEffect(() => { void refresh(); }, []);

  const open = async (fn: () => Promise<unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const d = await fn();
      if (d && typeof d === 'object' && 'club' in d) {
        go('dashboard');
        setDashboard(d as never);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const latest = saves?.[0];

  return (
    <div className="flex min-h-screen flex-wrap">
      <section className="flex max-w-[620px] flex-[1_1_460px] flex-col gap-10 px-8 py-16 sm:px-16">
        <div className="flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-[11px] bg-accent" aria-hidden="true" />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Banquillo</h1>
            <div className="text-muted">Simulador de entrenador de fútbol</div>
          </div>
        </div>

        {latest && (
          <button type="button" onClick={() => void open(() => game('load', { id: latest.id }), 'latest')}
            className="flex items-center gap-4 rounded-2xl border border-accent-line bg-card p-5 text-left hover:bg-card2">
            <Crest color="#8B5CF6" size={48} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs uppercase tracking-[0.08em] text-muted">Continuar partida</span>
              <span className="mt-0.5 block truncate font-display text-[19px] font-bold">{latest.clubName} · {latest.name.split('·')[1]?.trim() ?? latest.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted">{fmtDate(latest.date)} · temporada {latest.season} · guardada {ago(latest.savedAt)}</span>
            </span>
            <span className="flex h-11 items-center rounded-[10px] bg-accent px-5 font-display text-[15px] font-semibold text-white">{busy === 'latest' ? 'Cargando…' : 'Jugar'}</span>
          </button>
        )}

        <nav aria-label="Menú principal" className="flex flex-col gap-1.5">
          {ITEMS.map((it) => (
            <button key={it.id} type="button" onClick={() => setScreen(it.id)} className="flex items-center gap-4 rounded-xl px-4 py-3.5 text-left hover:bg-card">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-card2 text-accent-text"><Icon name={it.icon} size={18} /></span>
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">{it.label}</span>
                <span className="block text-[13px] text-muted">{it.hint}</span>
              </span>
              <Icon name="chevronRight" className="text-faint" />
            </button>
          ))}
        </nav>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <div className="mt-auto text-xs text-faint">Versión 0.4 · Fase 4 · datos de ejemplo ficticios</div>
      </section>

      <section aria-label="Partidas guardadas" className="flex min-w-0 flex-[999_1_480px] flex-col gap-5 border-l border-line bg-panel px-8 py-16 sm:px-14">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 font-display text-lg font-bold">Partidas guardadas</h2>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[9px] border border-line2 px-3.5 text-[13px] font-medium text-soft hover:bg-card2">
            <Icon name="upload" size={15} /> Importar archivo
            <input type="file" accept=".json" className="sr-only" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void open(async () => game('importSave', { text: await f.text() }), 'import');
            }} />
          </label>
        </div>
        {saves === null && <p className="text-sm text-muted">Cargando…</p>}
        {saves?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line2 p-8 text-center text-muted">
            Todavía no hay partidas guardadas.
            <div className="mt-3"><Button variant="primary" icon="plus" onClick={() => setScreen('newGame')}>Nueva partida</Button></div>
          </div>
        )}
        <ul className="flex flex-col gap-2.5">
          {saves?.map((s) => (
            <li key={s.id} className="flex items-center gap-3.5 rounded-2xl border border-line bg-card px-4 py-3.5">
              <Crest color={s.auto ? '#8B5CF6' : '#4C6A80'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate font-semibold">{s.clubName}</span>{s.auto && <Badge tone="accent">auto</Badge>}</div>
                <div className="truncate text-[13px] text-muted">{fmtDate(s.date)} · {s.name}</div>
              </div>
              <div className="text-right text-xs text-faint">{ago(s.savedAt)}<br />{(s.sizeBytes / 1e6).toFixed(0)} MB</div>
              <Button variant="soft" size="sm" disabled={!!busy} onClick={() => void open(() => game('load', { id: s.id }), s.id)}>{busy === s.id ? 'Cargando…' : 'Cargar'}</Button>
              <IconButton icon="trash" label={`Borrar ${s.name}`} onClick={() => { if (window.confirm('¿Borrar esta partida guardada?')) void game('deleteSave', { id: s.id }).then(refresh); }} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
