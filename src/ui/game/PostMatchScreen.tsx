import { useEffect, useState } from 'react';
import type { PostMatchState } from '../../engine/postMatch';
import type { MatchView } from '../../engine/views';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDateLong } from '../format';
import { Icon } from '../icons';
import { Badge, Button, Card, cx, Empty, ratingClass } from '../kit';
import { ClubLink, PlayerLink } from './shared';

export function PostMatchScreen() {
  const { dashboard, go } = useGame();
  const [data, setData] = useState<{ post: PostMatchState; match: MatchView | null } | null | undefined>(undefined);
  useEffect(() => { void game('postMatch').then(setData); }, []);
  if (data === undefined) return <p className="text-sm text-muted">Cargando…</p>;
  if (!data || !data.match) return <Empty>No hay post-partido disponible.</Empty>;
  const { post, match: m } = data;
  const f = m.fixture;
  const answer = async (qid: string, oid: string) => {
    const p = await game('pressAnswer', { questionId: qid, optionId: oid });
    setData({ post: p, match: m });
  };
  const skip = async () => { const p = await game('pressSkip'); if (p) setData({ post: p, match: m }); };
  const pending = post.press.find((q) => !q.answer);
  const scorers = m.events.filter((e) => e.type === 'goal' && e.period <= 4);
  const mySide = f.homeId === dashboard?.club.id ? 'home' : 'away';
  const myRatings = m.ratings.filter((r) => r.side === mySide).sort((a, b) => b.rating - a.rating);

  return (
    <div className="flex max-w-6xl flex-col gap-[18px]">
      <Card className="!p-7 text-center">
        <div className="text-xs uppercase tracking-[0.08em] text-muted first-letter:uppercase">{f.competitionName} · {f.roundLabel} · {fmtDateLong(f.date)}</div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-5">
          <ClubLink id={f.homeId} name={f.homeName} className="justify-self-end font-display text-2xl font-bold" />
          <div className="num rounded-xl bg-card2 px-5 py-2 font-display text-3xl font-extrabold">{f.homeGoals} - {f.awayGoals}</div>
          <ClubLink id={f.awayId} name={f.awayName} className="justify-self-start font-display text-2xl font-bold" />
        </div>
        {f.extra && <div className="mt-1 text-[13px] text-muted">{f.extra}</div>}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Badge tone={post.tone === 'good' ? 'good' : post.tone === 'bad' ? 'bad' : 'neutral'}>{post.headline}</Badge>
          {m.motm && <Badge tone="accent">Hombre del partido: {m.motm}</Badge>}
        </div>
        {scorers.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-6 text-[13px] text-soft">
            <div className="text-right">{scorers.filter((e) => e.teamId === f.homeId).map((e, i) => <div key={i}>{e.playerName} {e.minute}{e.stoppage ? `+${e.stoppage}` : ''}'</div>)}</div>
            <div className="text-left">{scorers.filter((e) => e.teamId === f.awayId).map((e, i) => <div key={i}>{e.playerName} {e.minute}{e.stoppage ? `+${e.stoppage}` : ''}'</div>)}</div>
          </div>
        )}
      </Card>

      <div className="grid gap-[18px] lg:grid-cols-2">
        <Card title="Informe del cuerpo técnico" icon="doc">
          <ul className="flex flex-col gap-2 text-[13px] text-soft">{post.report.map((r, i) => <li key={i} className="flex gap-2"><Icon name="chevronRight" size={14} className="mt-0.5 shrink-0 text-accent-soft" />{r}</li>)}</ul>
        </Card>
        <Card title="Rueda de prensa" icon="news" raised>
          {post.pressDone ? (
            <div className="flex flex-col gap-2 text-[13px]">
              <p className="text-soft">{post.skippedPress ? 'No has comparecido ante la prensa.' : 'Rueda de prensa terminada. Los titulares aparecerán en las noticias.'}</p>
              {post.press.filter((q) => q.answer).map((q) => <div key={q.id} className="rounded-lg bg-card2 px-3 py-2"><div className="text-xs text-muted">{q.journalist}</div><div className="text-soft">«{q.options.find((o) => o.id === q.answer)?.text}»</div></div>)}
            </div>
          ) : pending ? (
            <div className="flex flex-col gap-3">
              <div className="text-xs text-muted">{pending.journalist} · pregunta {post.press.indexOf(pending) + 1} de {post.press.length}</div>
              <p className="font-semibold">{pending.text}</p>
              <div className="flex flex-col gap-2">
                {pending.options.map((o) => (
                  <button key={o.id} type="button" onClick={() => void answer(pending.id, o.id)} className="rounded-xl border border-accent-line bg-card px-4 py-3 text-left text-[13px] hover:bg-accent-bg">{o.text}</button>
                ))}
              </div>
              <button type="button" onClick={() => void skip()} className="self-start text-xs text-muted hover:text-text hover:underline">No acudir a la rueda de prensa</button>
              <p className="text-xs text-faint">Tus palabras afectan a la moral del vestuario y de los jugadores aludidos.</p>
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-[18px] lg:grid-cols-2">
        <Card title="Notas de tus jugadores" icon="star">
          <table className="w-full text-[13px]"><tbody>
            {myRatings.map((r) => (
              <tr key={r.playerId} className="border-t border-[#221E2C]">
                <td className="w-12 py-1.5"><Badge tone="accent">{t(`pos.${r.position}`)}</Badge></td>
                <td><PlayerLink id={r.playerId} name={r.name} />{!r.started && <span className="ml-1.5 text-xs text-faint">suplente</span>}</td>
                <td className={cx('num text-right font-bold', ratingClass(r.rating))}>{r.rating.toFixed(1).replace('.', ',')}</td>
              </tr>
            ))}
          </tbody></table>
        </Card>
        <Card title="Consecuencias en la moral" icon="heart">
          {post.moraleChanges.length === 0 ? <Empty>La moral del vestuario no ha cambiado.</Empty> : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {post.moraleChanges.map((c) => {
                const d = c.after - c.before;
                return (
                  <li key={c.playerId} className="flex items-center gap-3">
                    <PlayerLink id={c.playerId} name={c.name} className="flex-1" />
                    <span className="num text-muted">{c.before} → {c.after}</span>
                    <Badge tone={d > 0 ? 'good' : 'bad'}>{d > 0 ? `+${d}` : d}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Ganar, rendir bien y lo que digas en la rueda de prensa sube la moral; perder o jugar mal la baja.</p>
        </Card>
      </div>
      <div className="flex gap-2">
        <Button icon="history" onClick={() => go('match', { fixtureId: f.id })}>Estadísticas completas</Button>
        <Button variant="ghost" icon="home" onClick={() => go('dashboard')}>Volver al inicio</Button>
      </div>
    </div>
  );
}
