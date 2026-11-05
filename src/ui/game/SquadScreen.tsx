import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { VISIBLE_ATTRS, type VisibleAttr } from '../../data/attributes';
import type { PlayerProfile, SquadTableRow } from '../../engine/profileViews';
import type { SquadView } from '../../engine/manager';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtMonthYear, fmtRating } from '../format';
import { Icon, type IconName } from '../icons';
import { attrClass, Badge, Bar, Button, Card, Chips, cx, Dialog, Dots, IconButton, money, PageHeader, ratingClass, Tabs } from '../kit';
import { PlayerLink } from './shared';

interface Col {
  id: string;
  label: string;
  short?: string;
  align?: 'right';
  sort: (r: SquadTableRow) => number | string;
  cell: (r: SquadTableRow) => ReactNode;
}

const attrCol = (a: VisibleAttr): Col => ({
  id: a, label: t(`attr.${a}`), short: t(`attr.${a}`).slice(0, 4), align: 'right',
  sort: (r) => r.attributes[a], cell: (r) => <span className={cx('font-semibold', attrClass(r.attributes[a]))}>{r.attributes[a]}</span>,
});

const COLS: Col[] = [
  { id: 'position', label: 'Pos', sort: (r) => r.group + r.position, cell: (r) => <Badge tone="accent">{t(`pos.${r.position}`)}</Badge> },
  { id: 'age', label: 'Edad', align: 'right', sort: (r) => r.age, cell: (r) => r.age },
  { id: 'nationality', label: 'Nac', sort: (r) => r.nationality, cell: (r) => <span className="text-muted">{r.nationality}</span> },
  { id: 'ca', label: 'Nivel', sort: (r) => r.ca, cell: (r) => <Dots value={r.caStars} label={`Nivel ${r.caStars} de 5`} /> },
  { id: 'pa', label: 'Potencial', sort: (r) => r.paStars, cell: (r) => <Dots value={r.paStars} variant="potential" label={`Potencial ${r.paStars} de 5`} /> },
  { id: 'condition', label: 'Condición', sort: (r) => r.condition, cell: (r) => <span className="inline-flex items-center gap-2"><Bar value={r.condition} label="Condición" /><span className="text-xs text-muted">{r.condition}%</span></span> },
  { id: 'sharpness', label: 'Ritmo', sort: (r) => r.sharpness, cell: (r) => <Bar value={r.sharpness} label="Ritmo de partido" /> },
  { id: 'morale', label: 'Moral', sort: (r) => r.morale, cell: (r) => <Bar value={r.morale} tone={r.morale >= 70 ? 'good' : r.morale >= 45 ? 'warn' : 'bad'} width={40} label="Moral" /> },
  { id: 'value', label: 'Valor', align: 'right', sort: (r) => r.value, cell: (r) => money(r.value) },
  { id: 'wage', label: 'Salario', align: 'right', sort: (r) => r.wage, cell: (r) => <span className="text-soft">{money(r.wage)}</span> },
  { id: 'contract', label: 'Contrato', sort: (r) => r.contractExpires ?? '', cell: (r) => <span className="text-soft">{r.contractExpires ? fmtMonthYear(r.contractExpires) : '—'}</span> },
  { id: 'apps', label: 'PJ', align: 'right', sort: (r) => r.apps, cell: (r) => r.apps },
  { id: 'starts', label: 'Titular', align: 'right', sort: (r) => r.starts, cell: (r) => r.starts },
  { id: 'minutes', label: 'Min', align: 'right', sort: (r) => r.minutes, cell: (r) => r.minutes },
  { id: 'goals', label: 'Goles', align: 'right', sort: (r) => r.goals, cell: (r) => r.goals },
  { id: 'assists', label: 'Asist.', align: 'right', sort: (r) => r.assists, cell: (r) => r.assists },
  { id: 'yellow', label: 'TA', align: 'right', sort: (r) => r.yellow, cell: (r) => r.yellow },
  { id: 'red', label: 'TR', align: 'right', sort: (r) => r.red, cell: (r) => r.red },
  { id: 'rating', label: 'Nota', align: 'right', sort: (r) => r.rating, cell: (r) => <span className={cx('font-semibold', ratingClass(r.rating))}>{fmtRating(r.rating)}</span> },
  { id: 'personality', label: 'Personalidad', sort: (r) => r.personality, cell: (r) => <span className="text-soft">{r.personality}</span> },
  ...VISIBLE_ATTRS.map(attrCol),
];
const COL_BY_ID = new Map(COLS.map((c) => [c.id, c]));

type ViewId = 'general' | 'technical' | 'mental' | 'physical' | 'contracts' | 'stats' | string;
const PRESETS: { id: ViewId; label: string; icon: IconName; columns: string[] }[] = [
  { id: 'general', label: 'General', icon: 'list', columns: ['position', 'age', 'ca', 'pa', 'condition', 'sharpness', 'morale', 'value', 'rating'] },
  { id: 'technical', label: 'Técnica', icon: 'ball', columns: ['position', 'crossing', 'dribbling', 'finishing', 'firstTouch', 'passing', 'technique', 'longShots', 'heading', 'tackling', 'marking'] },
  { id: 'mental', label: 'Mental', icon: 'bulb', columns: ['position', 'anticipation', 'composure', 'concentration', 'decisions', 'determination', 'flair', 'offTheBall', 'positioning', 'teamwork', 'vision', 'workRate', 'leadership'] },
  { id: 'physical', label: 'Física', icon: 'bolt', columns: ['position', 'condition', 'acceleration', 'agility', 'balance', 'jumping', 'naturalFitness', 'pace', 'stamina', 'strength'] },
  { id: 'contracts', label: 'Contratos', icon: 'doc', columns: ['position', 'age', 'value', 'wage', 'contract', 'personality'] },
  { id: 'stats', label: 'Estadísticas', icon: 'chart', columns: ['position', 'apps', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red', 'rating'] },
];

type Group = 'all' | 'gk' | 'def' | 'mid' | 'att';
const GROUP_FILTER: Record<Group, (r: SquadTableRow) => boolean> = {
  all: () => true,
  gk: (r) => r.group === 'GK',
  def: (r) => r.group === 'CB' || r.group === 'FB',
  mid: (r) => r.group === 'DM' || r.group === 'CM',
  att: (r) => r.group === 'WIDE' || r.group === 'AM' || r.group === 'ST',
};

export function SquadScreen() {
  const { dashboard } = useGame();
  const [rows, setRows] = useState<SquadTableRow[]>([]);
  const [custom, setCustom] = useState<SquadView[]>([]);
  const [view, setView] = useState<ViewId>('general');
  const [columns, setColumns] = useState<string[]>(PRESETS[0]!.columns);
  const [group, setGroup] = useState<Group>('all');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: 'value', dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [compare, setCompare] = useState<[string, string] | null>(null);

  const load = () => { void game('squadTable').then(setRows); void game('ui').then((u) => setCustom(u.squadViews)); };
  useEffect(load, [dashboard?.date]);

  const pickView = (id: ViewId) => {
    setView(id);
    const v = PRESETS.find((p) => p.id === id) ?? custom.find((c) => c.id === id);
    if (v) setColumns(v.columns);
  };
  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const col = sort.id === 'name' ? null : COL_BY_ID.get(sort.id);
    return rows
      .filter(GROUP_FILTER[group])
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = col ? col.sort(a) : a.name;
        const vb = col ? col.sort(b) : b.name;
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
      });
  }, [rows, group, filter, sort]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = list.length > 0 && list.every((r) => selected.has(r.id));
  const saveView = async () => {
    const name = window.prompt('Nombre de la vista', 'Mi vista');
    if (!name) return;
    const v: SquadView = { id: `v${Date.now().toString(36)}`, name, columns };
    const ui = await game('saveSquadView', { view: v });
    setCustom(ui.squadViews);
    setView(v.id);
  };
  const sel = [...selected];
  const wageBill = rows.reduce((a, r) => a + r.wage, 0);
  const avgAge = rows.length ? rows.reduce((a, r) => a + r.age, 0) / rows.length : 0;
  const tabs = [...PRESETS.map((p) => ({ id: p.id, label: p.label, icon: p.icon })), ...custom.map((c) => ({ id: c.id, label: c.name, icon: 'star' as IconName }))];
  const customView = custom.find((c) => c.id === view);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Plantilla" subtitle={`${rows.length} jugadores · edad media ${avgAge.toFixed(1).replace('.', ',')} · masa salarial ${money(wageBill)}/sem`} />
      <Tabs label="Vistas" items={tabs} value={view} onChange={pickView}
        right={<>
          {customView && <IconButton icon="trash" label={`Borrar vista ${customView.name}`} onClick={() => void game('deleteSquadView', { id: customView.id }).then((u) => { setCustom(u.squadViews); pickView('general'); })} />}
          <Button variant="ghost" icon="save" onClick={() => void saveView()}>Guardar vista</Button>
        </>} />
      <div className="flex flex-wrap items-center gap-2">
        <Chips label="Filtrar por línea" value={group} onChange={setGroup} items={[
          { id: 'all', label: 'Todos', icon: 'grid' }, { id: 'gk', label: 'Porteros', icon: 'glove' }, { id: 'def', label: 'Defensas', icon: 'shield' },
          { id: 'mid', label: 'Medios', icon: 'cross' }, { id: 'att', label: 'Delanteros', icon: 'target' },
        ]} />
        <div className="flex-1" />
        <label className="flex h-9 items-center gap-2 rounded-[9px] border border-[#2A2536] bg-card px-2.5 text-muted">
          <Icon name="search" size={15} /><span className="sr-only">Filtrar jugadores</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar" className="w-36 bg-transparent text-text outline-none placeholder:text-faint" />
        </label>
        <div className="relative">
          <Button variant="ghost" icon="columns" onClick={() => setColsOpen(!colsOpen)} aria-expanded={colsOpen}>Columnas</Button>
          {colsOpen && (
            <div className="absolute right-0 z-20 mt-1 max-h-96 w-64 overflow-auto rounded-xl border border-line2 bg-card2 p-2 shadow-2xl">
              {COLS.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-line">
                  <input type="checkbox" className="accent-accent" checked={columns.includes(c.id)} onChange={(e) => setColumns(e.target.checked ? [...columns, c.id] : columns.filter((x) => x !== c.id))} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-line bg-card">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="w-7 py-3 pl-4 pr-2"><input type="checkbox" aria-label="Seleccionar todos" className="h-4 w-4 accent-accent" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(list.map((r) => r.id)))} /></th>
              {[{ id: 'name', label: 'Jugador' } as Pick<Col, 'id' | 'label' | 'align'>, ...columns.map((id) => COL_BY_ID.get(id)).filter((c): c is Col => !!c)].map((c) => (
                <th key={c.id} className={cx('px-2 py-3 font-medium', c.align === 'right' && 'text-right')} aria-sort={sort.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => setSort({ id: c.id, dir: sort.id === c.id ? ((-sort.dir) as 1 | -1) : -1 })} className={cx('inline-flex items-center gap-1 hover:text-text', sort.id === c.id && 'text-accent-text')}>
                    {c.label}{sort.id === c.id && <Icon name={sort.dir === 1 ? 'chevronUp' : 'chevronDown'} size={12} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={cx('border-t border-[#221E2C]', selected.has(r.id) && 'bg-[#1F1930]')}>
                <td className="py-2 pl-4 pr-2"><input type="checkbox" aria-label={`Seleccionar ${r.name}`} className="h-4 w-4 accent-accent" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    {r.inLineup && <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" title="Once titular" />}
                    <PlayerLink id={r.id} name={r.name} className="font-semibold" />
                    {r.shortlisted && <Icon name="star" size={13} className="text-warn" />}
                  </div>
                  <div className="text-xs text-muted">
                    {r.injury ? <span className="text-bad-text">{r.injury.type} · {r.injury.days} d</span> : r.suspended ? <span className="text-warn">Sancionado · {r.suspended} partido(s)</span> : r.positions.map((p) => t(`pos.${p}`)).join(' · ')}
                  </div>
                </td>
                {columns.map((id) => { const c = COL_BY_ID.get(id); return c ? <td key={id} className={cx('num px-2 py-2 text-[13px]', c.align === 'right' && 'text-right')}>{c.cell(r)}</td> : null; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel.length > 0 && (
        <div role="region" aria-label="Acciones en bloque" className="sticky bottom-4 flex flex-wrap items-center gap-2 self-center rounded-[14px] border border-accent-line bg-raise py-2 pl-4 pr-2 shadow-2xl">
          <span className="mr-2 font-semibold">{sel.length} seleccionado{sel.length === 1 ? '' : 's'}</span>
          <Button variant="soft" icon="compare" disabled={sel.length !== 2} title={sel.length !== 2 ? 'Selecciona exactamente dos jugadores' : undefined} onClick={() => setCompare([sel[0]!, sel[1]!])}>Comparar</Button>
          <Button variant="soft" icon="transfers" disabled title="Disponible con el mercado (Fase 6)">Ofrecer a clubes</Button>
          <Button variant="soft" icon="loan" disabled title="Disponible con el mercado (Fase 6)">Ceder</Button>
          <Button variant="soft" icon="star" onClick={() => void Promise.all(sel.map((id) => game('toggleShortlist', { id }))).then(load)}>Lista de seguimiento</Button>
          <IconButton icon="close" label="Quitar selección" className="border-0" onClick={() => setSelected(new Set())} />
        </div>
      )}
      <CompareDialog ids={compare} onClose={() => setCompare(null)} />
    </div>
  );
}

const COMPARE_GROUPS: [string, VisibleAttr[]][] = [
  ['Técnicos', ['crossing', 'dribbling', 'finishing', 'firstTouch', 'heading', 'longShots', 'marking', 'passing', 'tackling', 'technique']],
  ['Mentales', ['anticipation', 'composure', 'concentration', 'decisions', 'determination', 'flair', 'offTheBall', 'positioning', 'teamwork', 'vision', 'workRate']],
  ['Físicos', ['acceleration', 'agility', 'balance', 'jumping', 'pace', 'stamina', 'strength']],
];

export function CompareDialog({ ids, onClose }: { ids: [string, string] | null; onClose: () => void }) {
  const [pair, setPair] = useState<[PlayerProfile, PlayerProfile] | null>(null);
  useEffect(() => {
    if (!ids) { setPair(null); return; }
    void Promise.all(ids.map((id) => game('player', { id }))).then(([a, b]) => a && b && setPair([a, b]));
  }, [ids?.[0], ids?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={!!ids} onClose={onClose} title="Comparar jugadores" width={760}>
      {pair ? (
        <div>
          <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-center">
            <div><div className="font-display text-lg font-bold">{pair[0].name}</div><div className="text-xs text-muted">{t(`pos.${pair[0].mainPosition}`)} · {pair[0].age} años · {money(pair[0].value)}</div></div>
            <span className="text-faint">vs</span>
            <div><div className="font-display text-lg font-bold">{pair[1].name}</div><div className="text-xs text-muted">{t(`pos.${pair[1].mainPosition}`)} · {pair[1].age} años · {money(pair[1].value)}</div></div>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {COMPARE_GROUPS.map(([title, attrs]) => (
              <div key={title}>
                <div className="mb-2 text-xs uppercase tracking-[0.08em] text-muted">{title}</div>
                {attrs.map((a) => {
                  const x = pair[0].attributes[a];
                  const y = pair[1].attributes[a];
                  return (
                    <div key={a} className="grid grid-cols-[28px_1fr_28px] items-center gap-2 py-0.5 text-[13px]">
                      <span className={cx('num text-right font-bold', x > y ? 'text-good-text' : 'text-muted')}>{x}</span>
                      <span className="truncate text-center text-soft">{t(`attr.${a}`)}</span>
                      <span className={cx('num font-bold', y > x ? 'text-good-text' : 'text-muted')}>{y}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">En verde, el mejor de los dos en cada atributo.</p>
        </div>
      ) : <p className="text-sm text-muted">Cargando…</p>}
    </Dialog>
  );
}

