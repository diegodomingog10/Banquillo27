import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { fmtDateLong } from '../format';
import { Icon } from '../icons';
import { Badge, Bar, Button, Card, FormBadge, toneFor } from '../kit';
import { PlayerLink } from './shared';

type Pre = NonNullable<Awaited<ReturnType<typeof game<'preMatch'>>>>;

export function PreMatch() {
  const { nav, setDashboard, go, setStatus } = useGame();
  const [pre, setPre] = useState<Pre | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (nav.fixtureId) void game('preMatch', { id: nav.fixtureId }).then(setPre); }, [nav.fixtureId]);
  if (!pre) return <p className="text-sm text-muted">Cargando…</p>;
  const f = pre.fixture;
  const play = async () => {
    setBusy(true);
    try {
      const { match, dashboard } = await game('playMatch');
      setDashboard(dashboard);
      go('match', { fixtureId: match?.fixture.id ?? null });
      setStatus('Partido jugado');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex max-w-6xl flex-col gap-[18px]">
      <Card className="!p-7 text-center">
        <div className="text-xs uppercase tracking-[0.08em] text-muted first-letter:uppercase">{f.competitionName} · {f.roundLabel} · {fmtDateLong(f.date)}</div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-5">
          <div className="text-right font-display text-2xl font-bold">{f.homeName}</div>
          <div className="font-display text-xl font-extrabold text-faint">vs</div>
          <div className="text-left font-display text-2xl font-bold">{f.awayName}</div>
        </div>
        <div className="mt-1 text-[13px] text-muted">{f.homeId === pre.opponent.id ? pre.opponent.stadium : 'En casa'}</div>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Button variant="ghost" icon="tactics" onClick={() => go('tactics')}>Cambiar táctica</Button>
          <Button variant="primary" size="lg" icon="whistle" onClick={() => void play()} disabled={busy}>{busy ? 'Jugando…' : 'Jugar partido'}</Button>
        </div>
        <p className="mt-3 text-xs text-muted">Resultado directo. La vista en directo (2D, comentarios, cambios, ajustes y gritos) llega en la Fase 5.</p>
      </Card>
      {pre.replaced.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warn-bg bg-[#221C10] px-4 py-2.5 text-[13px]"><Icon name="medical" className="text-warn" />El asistente ha cubierto la baja de {pre.replaced.join(', ')} en tu once.</div>
      )}
      <div className="grid gap-[18px] md:grid-cols-2">
        <Card title="Previa" icon="eye">
          <dl className="grid grid-cols-[140px_1fr] items-center gap-y-3 text-[13px]">
            <dt className="text-muted">Tu forma</dt><dd className="flex gap-1">{pre.userForm.map((o, i) => <FormBadge key={i} o={o} size={22} />)}</dd>
            <dt className="text-muted">Forma del rival</dt><dd className="flex gap-1">{pre.opponentForm.map((o, i) => <FormBadge key={i} o={o} size={22} />)}</dd>
            <dt className="text-muted">Clasificación</dt><dd>{pre.userPosition ?? '—'}.º frente a {pre.opponentPosition ?? '—'}.º</dd>
            <dt className="text-muted">Tu sistema</dt><dd className="flex items-center gap-2">{pre.formation}<Bar value={pre.familiarity} tone={toneFor(pre.familiarity)} width={70} label="Familiaridad" /><span className="text-xs text-muted">{pre.familiarity} %</span></dd>
          </dl>
          <h3 className="mb-2 mt-5 text-xs uppercase tracking-[0.08em] text-muted">Jugadores clave del rival</h3>
          <ul className="flex flex-col gap-1.5 text-[13px]">{pre.opponentKeyPlayers.map((p) => <li key={p.id} className="flex items-center gap-2"><Badge tone="accent" className="w-9 justify-center">{t(`pos.${p.position}`)}</Badge><PlayerLink id={p.id} name={p.name} /></li>)}</ul>
        </Card>
        <Card title="Once previsto" icon="squad">
          <ul className="grid grid-cols-1 gap-1.5 text-[13px] sm:grid-cols-2">
            {pre.lineup.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <Badge tone="accent" className="w-9 justify-center">{t(`pos.${p.position}`)}</Badge>
                <PlayerLink id={p.id} name={p.name} className="min-w-0 flex-1 truncate" />
                <Bar value={p.condition} width={32} label={`Condición ${p.condition}%`} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
