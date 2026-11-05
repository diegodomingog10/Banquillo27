import { useEffect, useMemo, useState } from 'react';
import type { Message } from '../../data/schema';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDate } from '../format';
import { Icon, type IconName } from '../icons';
import { Badge, Button, Card, Chips, cx } from '../kit';

type Filter = 'all' | 'unread' | 'board' | 'match' | 'competition' | 'injury' | 'player' | 'transfer';
const TYPE_ICON: Partial<Record<Message['type'], IconName>> = {
  board: 'target', match: 'ball', competition: 'trophy', injury: 'medical', player: 'squad', transfer: 'transfers', contract: 'doc', news: 'news', finance: 'finance',
};
const TYPE_LABEL: Partial<Record<Message['type'], string>> = {
  board: 'Directiva', match: 'Partidos', competition: 'Competiciones', injury: 'Lesiones', player: 'Jugadores', transfer: 'Mercado', contract: 'Contratos', news: 'Noticias',
};
const PRIORITY: Record<Message['priority'], string> = { urgent: 'bg-bad', high: 'bg-warn', normal: 'bg-accent-soft', low: 'bg-faint' };

export function InboxScreen() {
  const { nav, go, setDashboard, dashboard } = useGame();
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const refresh = () => game('inbox').then(setMessages);
  useEffect(() => { void refresh(); }, [dashboard?.date, dashboard?.unread]);

  const list = useMemo(() => messages.filter((m) => filter === 'all' || (filter === 'unread' ? !m.read : m.type === filter)), [messages, filter]);
  const selected = messages.find((m) => m.id === nav.messageId) ?? list.find((m) => m.blocking && !m.resolvedActionId) ?? list[0];

  useEffect(() => {
    if (selected && !selected.read && !selected.blocking) {
      void game('markRead', { id: selected.id }).then(() => {
        setMessages((ms) => ms.map((m) => (m.id === selected.id ? { ...m, read: true } : m)));
        void game('dashboard').then(setDashboard);
      });
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (m: Message, actionId: string | null) => { setDashboard(await game('resolveMessage', { id: m.id, actionId })); await refresh(); };
  const unread = messages.filter((m) => !m.read).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[22px] font-bold tracking-tight">Bandeja de entrada</h1>
        <span className="text-[13px] text-muted">{unread} sin leer</span>
      </div>
      <Chips label="Filtrar mensajes" value={filter} onChange={setFilter} items={[
        { id: 'all', label: 'Todos', icon: 'grid' }, { id: 'unread', label: 'Sin leer', icon: 'inbox' }, { id: 'board', label: 'Directiva', icon: 'target' },
        { id: 'match', label: 'Partidos', icon: 'ball' }, { id: 'competition', label: 'Competiciones', icon: 'trophy' }, { id: 'injury', label: 'Lesiones', icon: 'medical' },
        { id: 'player', label: 'Jugadores', icon: 'squad' }, { id: 'transfer', label: 'Mercado', icon: 'transfers' },
      ]} />
      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        <Card padded={false} className="overflow-hidden">
          <ul className="max-h-[68vh] overflow-auto" aria-label="Mensajes">
            {list.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => go('inbox', { messageId: m.id })} aria-current={m.id === selected?.id ? 'true' : undefined}
                  className={cx('flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left', m.id === selected?.id ? 'bg-accent-bg' : 'hover:bg-card2')}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card2 text-accent-text"><Icon name={TYPE_ICON[m.type] ?? 'inbox'} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate', m.read ? 'text-soft' : 'font-semibold text-text')}>{m.subject}</span>
                    <span className="block truncate text-xs text-muted">{fmtDate(m.date)} · {m.sender}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={cx('h-2 w-2 rounded-full', PRIORITY[m.priority])} title={`Prioridad ${m.priority}`} />
                    {m.blocking && !m.resolvedActionId && <Badge tone="warn">Pendiente</Badge>}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="p-4 text-[13px] text-muted">No hay mensajes.</li>}
          </ul>
        </Card>
        {selected && (
          <Card>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted"><Icon name={TYPE_ICON[selected.type] ?? 'inbox'} size={14} />{TYPE_LABEL[selected.type] ?? selected.type} · {fmtDate(selected.date)} · {selected.sender}</div>
            <h2 className="mb-3 font-display text-xl font-bold">{selected.subject}</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-soft">{selected.body}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {selected.related.matchId && <Button icon="ball" onClick={() => go('match', { fixtureId: selected.related.matchId })}>Ver partido</Button>}
              {selected.related.playerId && <Button icon="squad" onClick={() => go('player', { playerId: selected.related.playerId })}>Ver jugador</Button>}
              {selected.related.competitionId && <Button icon="trophy" onClick={() => go('competitions')}>Ver competición</Button>}
              {selected.blocking && !selected.resolvedActionId && (selected.actions.length ? selected.actions : [{ id: 'ok', kind: 'accept' as const, labelKey: 'common.understood', payload: {} }]).map((a) => (
                <Button key={a.id} variant="primary" icon="check" onClick={() => void act(selected, a.id)}>{t(a.labelKey)}</Button>
              ))}
              {!selected.blocking && !selected.resolvedActionId && selected.actions.map((a) => (
                <Button key={a.id} variant={a.kind === 'accept' ? 'primary' : 'secondary'} icon={a.kind === 'accept' ? 'check' : a.kind === 'reject' ? 'close' : 'transfers'}
                  onClick={() => a.kind === 'negotiate' && selected.related.playerId ? go('player', { playerId: selected.related.playerId }) : void act(selected, a.id)}>{t(a.labelKey)}</Button>
              ))}
              {selected.resolvedActionId && <Badge tone="good">Respondido</Badge>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
