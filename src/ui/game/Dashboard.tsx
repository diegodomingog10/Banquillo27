import { useState, type ReactNode } from 'react';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDate, fmtShort } from '../format';
import { Icon, type IconName } from '../icons';
import { KitShirt } from '../pitch';
import { Badge, Bar, Button, Card, Crest, cx, Empty, FormBadge, money, Stat, type Tone } from '../kit';
import { LeagueTable } from './shared';

const TILE_META: Record<string, { title: string; icon: IconName; wide?: boolean }> = {
  nextMatch: { title: 'Próximo partido', icon: 'calendar', wide: true },
  table: { title: 'Clasificación', icon: 'trophy' },
  form: { title: 'Forma reciente', icon: 'pulse' },
  objectives: { title: 'Objetivos de la directiva', icon: 'target' },
  absences: { title: 'Bajas', icon: 'medical' },
  finances: { title: 'Finanzas', icon: 'finance' },
  news: { title: 'Noticias', icon: 'news' },
};

function greeting(manager: string): string {
  return `Hola, ${manager.split(' ')[0]}`;
}

export function Dashboard() {
  const { dashboard: d, go, setDashboard } = useGame();
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  if (!d) return null;

  const tiles = d.tiles.length ? d.tiles : Object.keys(TILE_META).map((id) => ({ id, visible: true }));
  const persist = async (next: typeof tiles) => {
    setDashboard({ ...d, tiles: next });
    await game('setDashboardLayout', { tiles: next as never });
  };
  const move = (id: string, delta: number) => {
    const i = tiles.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= tiles.length) return;
    const next = tiles.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    void persist(next);
  };
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = tiles.filter((x) => x.id !== dragId);
    const k = next.findIndex((x) => x.id === targetId);
    next.splice(k, 0, tiles.find((x) => x.id === dragId)!);
    setDragId(null);
    void persist(next);
  };

  const rows = d.league?.rows ?? [];
  const pos = d.league?.position ?? 1;
  const around = rows.filter((r) => Math.abs(r.position - pos) <= 2 || r.position === 1).slice(0, 7);
  const next = d.pendingMatch ?? d.next[0];
  const nextHome = next ? next.homeId === d.club.id : true;
  const oppRow = next ? rows.find((r) => r.clubId === (nextHome ? next.awayId : next.homeId)) : undefined;
  const myRow = rows.find((r) => r.clubId === d.club.id);

  const body: Record<string, ReactNode> = {
    nextMatch: next ? (
      <div className="flex flex-col gap-4">
        <div className="text-xs uppercase tracking-[0.08em] text-muted">{d.pendingMatch ? 'Hoy' : fmtDate(next.date)} · {next.competitionName} · {next.roundLabel}</div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="flex flex-col items-end gap-1.5 text-right">
            {d.nextKits ? <KitShirt kit={d.nextKits.home} size={52} title={`Equipación de ${next.homeName}`} /> : <Crest color={d.club.primary} size={48} />}
            <div className="font-display text-xl font-bold">{next.homeName}</div>
            <div className="text-[13px] text-muted">{nextHome ? `${myRow?.position ?? '—'}.º · ${myRow?.points ?? 0} pts` : `${oppRow?.position ?? '—'}.º · ${oppRow?.points ?? 0} pts`}</div>
          </div>
          <div className="font-display text-xl font-extrabold text-faint">vs</div>
          <div className="flex flex-col gap-1.5">
            {d.nextKits ? <KitShirt kit={d.nextKits.away} size={52} title={`Equipación de ${next.awayName}`} /> : <Crest color={d.club.primary} size={48} />}
            <div className="font-display text-xl font-bold">{next.awayName}</div>
            <div className="text-[13px] text-muted">{nextHome ? `${oppRow?.position ?? '—'}.º · ${oppRow?.points ?? 0} pts` : `${myRow?.position ?? '—'}.º · ${myRow?.points ?? 0} pts`}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-muted">{nextHome ? 'En casa' : 'Fuera de casa'}</span>
          <div className="flex-1" />
          <Button variant="soft" icon="tactics" onClick={() => go('tactics')}>Preparar táctica</Button>
          {d.pendingMatch && <Button variant="primary" icon="eye" onClick={() => go('prematch', { fixtureId: d.pendingMatch!.id })}>Ir a la previa</Button>}
        </div>
      </div>
    ) : <Empty>No hay partidos programados.</Empty>,
    table: d.league ? (
      <>
        <LeagueTable rows={around} highlight={d.club.id} compact />
        <button type="button" onClick={() => go('competitions')} className="mt-3 text-[13px] text-accent-text hover:underline">Ver clasificación completa</button>
      </>
    ) : <Empty>Sin liga.</Empty>,
    form: (
      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5">{d.form.length ? d.form.map((o, i) => <FormBadge key={i} o={o} />) : <Empty>Aún no se ha jugado.</Empty>}</div>
        <ul className="flex flex-col">
          {d.last.slice(0, 4).map((f) => {
            const home = f.homeId === d.club.id;
            return (
              <li key={f.id}>
                <button type="button" onClick={() => go('match', { fixtureId: f.id })} className="flex w-full items-center gap-2.5 border-t border-[#221E2C] py-2 text-left text-[13px] hover:text-accent-text">
                  <span className="w-12 text-xs text-muted">{fmtShort(f.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{home ? 'vs' : 'en'} {home ? f.awayName : f.homeName}</span>
                  <span className="num font-semibold">{f.homeGoals}-{f.awayGoals}</span>
                  <FormBadge o={f.outcome} size={22} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    ),
    objectives: (
      <div className="flex flex-col gap-3.5">
        {d.objectiveStatus.map((o) => (
          <div key={o.label}>
            <div className="mb-1.5 flex justify-between gap-3 text-[13px]"><span>{o.label}</span><span className="text-muted">{o.state}</span></div>
            <Bar value={o.progress} tone={o.tone as Tone} width="100%" label={o.label} />
          </div>
        ))}
      </div>
    ),
    absences: (
      <div className="flex flex-col gap-2.5 text-[13px]">
        {d.injured.length === 0 && d.suspended.length === 0 && <Empty>Plantilla al completo.</Empty>}
        {d.injured.map((p) => <div key={p.id} className="flex items-center gap-2.5"><Badge tone="bad">Lesión</Badge><button type="button" className="flex-1 text-left hover:underline" onClick={() => go('player', { playerId: p.id })}>{p.name}</button><span className="text-muted">{p.days} días</span></div>)}
        {d.suspended.map((p) => <div key={p.id} className="flex items-center gap-2.5"><Badge tone="warn">Sanción</Badge><button type="button" className="flex-1 text-left hover:underline" onClick={() => go('player', { playerId: p.id })}>{p.name}</button><span className="text-muted">{p.games} partido(s)</span></div>)}
      </div>
    ),
    finances: (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-6"><Stat label="Saldo" value={money(d.finances.balance)} tone={d.finances.balance < 0 ? 'bad' : undefined} /><Stat label="Fichajes" value={money(d.finances.transferBudget)} /></div>
        <div className="text-xs text-muted">Masa salarial {money(d.finances.wageBill)} / {money(d.finances.wageBudget)} por semana</div>
        <Bar value={d.finances.wageBudget ? (d.finances.wageBill / d.finances.wageBudget) * 100 : 100}
          tone={d.finances.wageBill <= d.finances.wageBudget * 0.85 ? 'good' : d.finances.wageBill <= d.finances.wageBudget ? 'warn' : 'bad'} width="100%" label="Masa salarial" />
      </div>
    ),
    news: d.news.length ? <ul className="flex flex-col gap-1.5 text-[13px]">{d.news.slice(0, 6).map((n, i) => <li key={i}><span className="mr-2 text-xs text-faint">{fmtDate(n.date)}</span>{n.text}</li>)}</ul> : <Empty>Sin noticias por ahora.</Empty>,
  };

  const shown = editing ? tiles : tiles.filter((x) => x.visible);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-[26px] font-bold tracking-tight">{greeting(d.manager)}</h1>
        <span className="text-muted">{d.pendingMatch ? 'Hoy hay partido.' : d.next[0] ? `Próximo partido: ${fmtDate(d.next[0].date)}.` : ''} {d.unread > 0 && `Tienes ${d.unread} mensaje${d.unread === 1 ? '' : 's'} sin leer.`}</span>
        <div className="flex-1" />
        <Button variant={editing ? 'primary' : 'ghost'} icon={editing ? 'check' : 'sliders'} onClick={() => setEditing(!editing)}>{editing ? 'Listo' : 'Personalizar panel'}</Button>
      </div>
      {editing && <p className="-mt-2 text-[13px] text-muted">Arrastra los mosaicos para reordenarlos (o usa las flechas) y oculta los que no quieras ver.</p>}
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {shown.map((tile, i) => {
          const meta = TILE_META[tile.id];
          if (!meta) return null;
          return (
            <div key={tile.id} className={cx(meta.wide && 'md:col-span-2', editing && !tile.visible && 'opacity-50', dragId === tile.id && 'opacity-40')}
              draggable={editing} onDragStart={(e) => { e.dataTransfer.setData('text/plain', tile.id); setDragId(tile.id); }} onDragEnd={() => setDragId(null)} onDragOver={(e) => editing && e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(tile.id); }}>
              <Card title={meta.title} icon={meta.icon} className={cx('h-full', editing && 'cursor-grab border-dashed border-accent-line')}
                actions={editing && (
                  <div className="flex items-center gap-1">
                    <button type="button" aria-label={`Subir ${meta.title}`} disabled={i === 0} onClick={() => move(tile.id, -1)} className="rounded p-1 text-muted hover:text-text disabled:opacity-30"><Icon name="chevronUp" /></button>
                    <button type="button" aria-label={`Bajar ${meta.title}`} disabled={i === shown.length - 1} onClick={() => move(tile.id, 1)} className="rounded p-1 text-muted hover:text-text disabled:opacity-30"><Icon name="chevronDown" /></button>
                    <button type="button" aria-label={tile.visible ? `Ocultar ${meta.title}` : `Mostrar ${meta.title}`} onClick={() => void persist(tiles.map((x) => (x.id === tile.id ? { ...x, visible: !x.visible } : x)))} className="rounded p-1 text-muted hover:text-text"><Icon name={tile.visible ? 'eye' : 'eyeOff'} /></button>
                    <Icon name="grip" className="text-faint" />
                  </div>
                )}>
                {body[tile.id]}
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
