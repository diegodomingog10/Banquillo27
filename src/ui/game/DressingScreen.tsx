import { useEffect, useState } from 'react';
import type { PlayerTalk, TeamTalk } from '../../engine/dressingRoom';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDate } from '../format';
import { Icon } from '../icons';
import { Badge, Bar, Button, Card, cx, Dialog, Empty, PageHeader, Stat } from '../kit';
import { PlayerLink } from './shared';

type Dv = Awaited<ReturnType<typeof game<'dressing'>>>;

const moraleTone = (m: number) => (m >= 65 ? 'good' : m >= 45 ? 'warn' : 'bad') as 'good' | 'warn' | 'bad';

export function DressingScreen() {
  const { dashboard } = useGame();
  const [d, setD] = useState<Dv | null>(null);
  const [msg, setMsg] = useState<{ result: string; text: string } | null>(null);
  const [talkTo, setTalkTo] = useState<{ id: string; name: string } | null>(null);
  const load = () => void game('dressing').then(setD);
  useEffect(load, [dashboard?.date]);
  if (!d) return <p className="text-sm text-muted">Cargando…</p>;
  const meet = async (talk: TeamTalk) => {
    try { const r = await game('teamMeeting', { talk }); setD(r.view); setMsg(r); } catch (e) { setMsg({ result: 'bad', text: (e as Error).message }); }
  };
  const unhappy = d.rows.filter((r) => r.concerns.length);
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Vestuario" subtitle="Moral, líderes, grupos y promesas" />
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card title="Ambiente" icon="heart">
          <div className="mb-3 flex items-center gap-4">
            <Stat label="Moral media" value={`${d.morale}`} tone={moraleTone(d.morale)} hint={d.label} />
            <div className="flex-1"><Bar value={d.morale} tone={moraleTone(d.morale)} width="100%" label="Moral media del equipo" /></div>
          </div>
          <div className="mb-1.5 text-xs uppercase tracking-[0.08em] text-muted">Líderes del vestuario</div>
          {d.leaders.length ? <ul className="flex flex-col gap-1 text-[13px]">{d.leaders.map((l) => <li key={l.id} className="flex items-center gap-2"><Icon name="star" size={13} className="text-warn" /><PlayerLink id={l.id} name={l.name} /><span className="ml-auto num text-muted">{l.morale}</span></li>)}</ul> : <Empty>Nadie ejerce de líder.</Empty>}
          <p className="mt-2 text-xs text-muted">Si un líder está descontento, su grupo lo nota.</p>
        </Card>
        <Card title="Reunión de equipo" icon="squad" actions={d.teamMeetingWait ? <span className="text-xs text-muted">Disponible en {d.teamMeetingWait} días</span> : undefined}>
          <div className="grid grid-cols-2 gap-2">{d.teamTalks.map((x) => <Button key={x.id} disabled={d.teamMeetingWait > 0} onClick={() => void meet(x.id as TeamTalk)}>{x.label}</Button>)}</div>
          {msg && <p role="status" className={cx('mt-3 rounded-lg border px-3 py-2 text-[13px]', msg.result === 'good' ? 'border-good-bg text-good-text' : msg.result === 'bad' ? 'border-bad-bg text-bad-text' : 'border-line2 text-soft')}>{msg.text}</p>}
          <p className="mt-3 text-xs text-muted">El efecto depende de cómo van los resultados: felicitar tras una mala racha o exigir tras una buena sienta mal.</p>
        </Card>
        <Card title="Grupos" icon="globe">
          <ul className="flex flex-col gap-2.5 text-[13px]">{d.groups.map((g) => (
            <li key={g.id}>
              <div className="flex items-center gap-2"><b>{g.label}</b><span className="text-muted">· {g.size}</span><span className="ml-auto"><Badge tone={moraleTone(g.morale)}>{g.morale}</Badge></span></div>
              <div className="truncate text-xs text-muted" title={g.members.map((m) => m.name).join(', ')}>{g.members.map((m) => m.name).join(', ')}</div>
            </li>
          ))}</ul>
        </Card>
      </div>
      <Card title={`Jugadores con preocupaciones${unhappy.length ? ` (${unhappy.length})` : ''}`} icon="alert">
        {unhappy.length === 0 ? <Empty>Todo el mundo está tranquilo.</Empty> : (
          <ul className="flex flex-col divide-y divide-line">{unhappy.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
              <Badge tone="accent">{t(`pos.${r.position}`)}</Badge>
              <span className="min-w-[160px] flex-1"><PlayerLink id={r.id} name={r.name} />{r.leader && <Icon name="star" size={12} className="ml-1 inline text-warn" />}<span className="text-muted"> · {r.role} · juega {r.share} % (espera {r.expected} %)</span></span>
              <span className="flex flex-wrap gap-1">{r.concerns.map((c) => <Badge key={c.kind} tone={c.level >= 3 ? 'bad' : c.level === 2 ? 'warn' : 'neutral'}>{c.label}</Badge>)}</span>
              <Badge tone={moraleTone(r.morale)}>{r.label}</Badge>
              <Button size="sm" onClick={() => setTalkTo({ id: r.id, name: r.name })}>Hablar</Button>
            </li>
          ))}</ul>
        )}
      </Card>
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Card title="Promesas" icon="docCheck">
          {d.promises.length === 0 ? <Empty>No has prometido nada.</Empty> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">{d.promises.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="flex-1"><PlayerLink id={p.playerId} name={p.name} /> <span className="text-muted">· {p.kind === 'playingTime' ? 'más minutos' : 'dejarle salir'} · hasta el {fmtDate(p.due)}</span></span>
                <Badge tone={p.status === 'kept' ? 'good' : p.status === 'broken' ? 'bad' : 'accent'}>{p.status === 'kept' ? 'Cumplida' : p.status === 'broken' ? 'Incumplida' : 'En curso'}</Badge>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Últimas conversaciones" icon="history">
          {d.meetings.length === 0 ? <Empty>Aún no has hablado con nadie.</Empty> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">{d.meetings.map((m, i) => (
              <li key={i} className="flex gap-3"><span className="w-16 shrink-0 text-xs text-muted">{fmtDate(m.date)}</span><span className={m.result === 'good' ? 'text-good-text' : m.result === 'bad' ? 'text-bad-text' : 'text-soft'}><b className="text-text">{m.name}:</b> {m.text}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Card title="Toda la plantilla" icon="list">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-2 font-medium">Jugador</th><th className="font-medium">Rol</th><th className="font-medium">Minutos</th><th className="font-medium">Moral</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="py-1.5"><PlayerLink id={r.id} name={r.name} />{r.injured && <Icon name="medical" size={12} className="ml-1 inline text-bad-text" />}</td>
              <td className="text-soft">{r.role}</td>
              <td><span className="flex items-center gap-2"><Bar value={r.share} tone={r.share >= r.expected - 10 ? 'good' : r.share >= r.expected - 25 ? 'warn' : 'bad'} width={60} label={`Minutos de ${r.name}`} /><span className="num text-muted">{r.share} / {r.expected} %</span></span></td>
              <td><Badge tone={moraleTone(r.morale)}>{r.label}</Badge></td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setTalkTo({ id: r.id, name: r.name })}>Hablar</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <TalkDialog player={talkTo} onClose={() => { setTalkTo(null); load(); }} />
    </div>
  );
}

type Profile = NonNullable<Awaited<ReturnType<typeof game<'player'>>>>;

/** Conversación individual con un jugador de la plantilla. */
export function TalkDialog({ player, onClose }: { player: { id: string; name: string } | null; onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [res, setRes] = useState<{ result: string; text: string } | null>(null);
  useEffect(() => { setRes(null); if (player) void game('player', { id: player.id }).then(setP); else setP(null); }, [player]);
  if (!player) return null;
  const mood = p?.mood;
  const talk = async (k: PlayerTalk) => {
    try { setRes(await game('talkToPlayer', { playerId: player.id, talk: k })); setP(await game('player', { id: player.id })); } catch (e) { setRes({ result: 'bad', text: (e as Error).message }); }
  };
  return (
    <Dialog open={!!player} onClose={onClose} title={`Hablar con ${player.name}`} width={560}>
      {!mood ? <p className="text-sm text-muted">Cargando…</p> : (
        <div className="flex flex-col gap-4 text-[13px]">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-soft">
            <span>Moral: <b className="text-text">{mood.label}</b></span><span>Rol: <b className="text-text">{mood.role}</b></span>
            <span>Juega el <b className="text-text">{mood.share} %</b> (espera {mood.expected} %)</span>
          </div>
          {mood.concerns.length > 0 && <div className="flex flex-wrap gap-1.5">{mood.concerns.map((c) => <Badge key={c.kind} tone={c.level >= 3 ? 'bad' : c.level === 2 ? 'warn' : 'neutral'}>{c.label}</Badge>)}</div>}
          <div className="grid gap-2 sm:grid-cols-2">{mood.talks.map((k) => <Button key={k.id} onClick={() => void talk(k.id as PlayerTalk)}>{k.label}</Button>)}</div>
          {res && <p role="status" className={cx('rounded-lg border px-3 py-2', res.result === 'good' ? 'border-good-bg text-good-text' : res.result === 'bad' ? 'border-bad-bg text-bad-text' : 'border-line2 text-soft')}>{res.text}</p>}
          <p className="text-xs text-muted">Lo que funcione depende de su carácter: a los profesionales les motiva la exigencia; a los temperamentales, no. Las promesas tienen plazo y se notan si no se cumplen.</p>
        </div>
      )}
    </Dialog>
  );
}
