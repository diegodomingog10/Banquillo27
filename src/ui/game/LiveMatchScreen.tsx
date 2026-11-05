import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommentLine } from '../../engine/commentary';
import type { Advice, LiveTick } from '../../engine/liveMatch';
import type { LivePlayer, LiveTeam, MatchCommand, ReplayAction } from '../../engine/matchEngine';
import { SHOUT_IDS, TWEAK_IDS, type Mentality, type ShoutId, type TweakId } from '../../engine/tactics';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Icon, type IconName } from '../icons';
import type { MatchKits } from '../../data/kits';
import { FootballPitch, kitAccent, KitDisc, KitShirt, pitchPos } from '../pitch';
import { Badge, Bar, Button, Card, cx, ratingClass, Segmented, Tabs, Toggle } from '../kit';

type Info = Awaited<ReturnType<typeof game<'liveStart'>>>;
type Speed = 0 | 1 | 2 | 4;
type Mode = '2d' | 'key';

const SPEED_MS: Record<1 | 2 | 4, number> = { 1: 1100, 2: 550, 4: 260 };
const SHOUT_ICON: Record<ShoutId, IconName> = {
  encourage: 'heart', demandMore: 'bolt', praise: 'star', focus: 'target', calmDown: 'pulse', fireUp: 'flag', showPassion: 'heart', noPressure: 'eye',
};

interface Flash { text: string; tone: 'good' | 'bad' | 'warn'; until: number }
interface CardMark { playerId: string; color: 'yellow' | 'red'; until: number }

export function LiveMatchScreen() {
  const { setDashboard, go, setStatus } = useGame();
  const [info, setInfo] = useState<Info | null>(null);
  const [tick, setTick] = useState<LiveTick | null>(null);
  const [comments, setComments] = useState<CommentLine[]>([]);
  const [heat, setHeat] = useState<number[][]>(() => [new Array(40).fill(0), new Array(40).fill(0)]);
  const [speed, setSpeed] = useState<Speed>(0);
  const [mode, setMode] = useState<Mode>('2d');
  const [anim, setAnim] = useState<{ actions: ReplayAction[]; step: number; stepMs: number }>({ actions: [], step: 0, stepMs: 400 });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [cards, setCards] = useState<CardMark[]>([]);
  const [shoutMsg, setShoutMsg] = useState<string | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [panel, setPanel] = useState<'subs' | 'tactic' | 'shouts'>('subs');
  const [subOut, setSubOut] = useState<string | null>(null);
  const [subIn, setSubIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const absorb = useCallback((tk: LiveTick, userSide: 0 | 1, _homeId: string, stepMs: number) => {
    setTick(tk);
    if (tk.comments.length) setComments((c) => [...tk.comments.slice().reverse(), ...c].slice(0, 80));
    if (tk.replay.length) {
      setHeat((h) => {
        const next = [h[0]!.slice(), h[1]!.slice()];
        for (const a of tk.replay) {
          const col = Math.min(7, Math.floor(a.x * 8));
          const row = Math.min(4, Math.floor(a.y * 5));
          next[a.side]![row * 8 + col]!++;
        }
        return next;
      });
      setAnim({ actions: tk.replay, step: 0, stepMs: Math.max(120, stepMs / Math.max(1, tk.replay.length)) });
    }
    if (tk.shouts.length) setShoutMsg(tk.shouts[tk.shouts.length - 1]!.summary);
    const now = Date.now();
    for (const e of tk.events) {
      if (e.type === 'goal' && e.detail !== 'shootout') setFlash({ text: '¡GOL!', tone: e.teamId === tk.snapshot.teams[userSide].clubId ? 'good' : 'bad', until: now + 2200 });
      if ((e.type === 'yellow' || e.type === 'secondYellow' || e.type === 'red') && e.playerId) setCards((c) => [...c, { playerId: e.playerId!, color: e.type === 'yellow' ? 'yellow' : 'red', until: now + 2500 }]);
    }
    if (tk.pause === 'halfTime') { setSpeed(0); setFlash({ text: 'Descanso', tone: 'warn', until: now + 2000 }); }
    if (tk.pause === 'injury' || tk.pause === 'redCard') setSpeed(0);
    if (tk.snapshot.finished) setSpeed(0);
  }, []);

  useEffect(() => {
    void game('liveStart', { assistant: false }).then((i) => {
      setInfo(i);
      absorb(i.tick, i.userSide, i.home.id, 400);
    }).catch((e: Error) => setError(e.message));
  }, [absorb]);

  // Bucle de reproducción
  useEffect(() => {
    if (!info || speed === 0 || tick?.snapshot.finished) return;
    const ms = mode === 'key' ? 2200 : SPEED_MS[speed];
    const id = setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const tk = await game('liveTick', mode === 'key' ? { untilKey: true } : { phases: 1 });
        absorb(tk, info.userSide, info.home.id, mode === 'key' ? 1800 : ms);
      } finally {
        busy.current = false;
      }
    }, ms);
    return () => clearTimeout(id);
  }, [info, speed, mode, tick, absorb]);

  // Animación de las acciones de la fase
  useEffect(() => {
    if (anim.step >= anim.actions.length - 1) return;
    const id = setTimeout(() => setAnim((a) => ({ ...a, step: a.step + 1 })), anim.stepMs);
    return () => clearTimeout(id);
  }, [anim]);

  useEffect(() => {
    if (!flash && cards.length === 0) return;
    const id = setTimeout(() => {
      const now = Date.now();
      setFlash((f) => (f && f.until > now ? f : null));
      setCards((c) => c.filter((x) => x.until > now));
    }, 400);
    return () => clearTimeout(id);
  }, [flash, cards]);

  const command = async (cmd: MatchCommand) => {
    try { await game('liveCommand', { cmd }); } catch (e) { setError((e as Error).message); }
    // Aplica ya la orden (sin avanzar el reloj si está en pausa se verá en la siguiente fase)
    if (speed === 0 && info) absorb(await game('liveTick', { phases: 1 }), info.userSide, info.home.id, 400);
  };
  const toEnd = async () => {
    if (!info) return;
    setSpeed(0);
    absorb(await game('liveTick', { toEnd: true }), info.userSide, info.home.id, 400);
  };
  const finish = async () => {
    try {
      const { dashboard } = await game('liveFinish');
      setDashboard(dashboard);
      setStatus('Partido terminado');
      go('postmatch');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) return <Card><p className="text-sm text-bad" role="alert">{error}</p></Card>;
  if (!info || !tick) return <p className="text-sm text-muted">Preparando el partido…</p>;
  const snap = tick.snapshot;
  const [home, away] = snap.teams;
  const me = snap.teams[info.userSide];
  const minute = `${snap.minute}${snap.stoppage ? `+${snap.stoppage}` : ''}'`;
  const periodLabel = snap.finished ? 'Final' : snap.period === 1 ? '1.ª parte' : snap.period === 2 ? '2.ª parte' : 'Prórroga';
  const action = anim.actions[Math.min(anim.step, anim.actions.length - 1)];
  const kits = info.kits;
  const awayKitLabel = kits.awayKit === 'home' ? 'primera equipación' : kits.awayKit === 'away' ? 'segunda equipación' : 'equipación alternativa';

  return (
    <div className="flex flex-col gap-4">
      {/* Marcador */}
      <Card className="flex flex-wrap items-center gap-4 !py-3">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <span className="truncate font-display text-xl font-bold">{info.home.name}</span>
          <KitShirt kit={kits.home} size={34} title={`${info.home.name}: primera equipación`} />
        </div>
        <div className="text-center">
          <div className="num rounded-xl bg-card2 px-5 py-1.5 font-display text-3xl font-extrabold" aria-live="polite">{home.goals} - {away.goals}</div>
          <div className="mt-1 text-xs text-muted"><span className="num font-semibold text-text">{minute}</span> · {periodLabel}{snap.penalties ? ` · pen. ${snap.penalties.home}-${snap.penalties.away}` : ''}</div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <KitShirt kit={kits.away} size={34} title={`${info.away.name}: ${awayKitLabel}`} />
          <span className="truncate font-display text-xl font-bold">{info.away.name}</span>
        </div>
      </Card>

      {/* Controles de reproducción */}
      <div className="flex flex-wrap items-center gap-2">
        {snap.finished ? (
          <Button variant="primary" icon="check" size="lg" onClick={() => void finish()}>Ver el post-partido</Button>
        ) : (
          <>
            <Button variant={speed === 0 ? 'primary' : 'secondary'} icon={speed === 0 ? 'arrowRight' : 'pulse'} onClick={() => setSpeed(speed === 0 ? 1 : 0)}>{speed === 0 ? 'Reanudar' : 'Pausa'}</Button>
            <div role="radiogroup" aria-label="Velocidad" className="flex gap-1">
              {([1, 2, 4] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={speed === v} onClick={() => setSpeed(v)}
                  className={cx('h-9 w-12 rounded-[9px] border text-[13px] font-semibold', speed === v ? 'border-accent bg-accent text-white' : 'border-line2 text-soft hover:bg-card2')}>{v}x</button>
              ))}
            </div>
            <div className="w-[260px]"><Segmented label="Modo de vista" value={mode} onChange={setMode} options={[{ value: '2d', label: 'Completo' }, { value: 'key', label: 'Momentos clave' }]} /></div>
            <Button variant="ghost" icon="chevronRight" onClick={() => void toEnd()}>Resultado directo</Button>
          </>
        )}
        <div className="flex-1" />
        <Toggle label="El asistente hace los cambios" checked={assistant} onChange={(v) => { setAssistant(v); void game('liveAssistant', { on: v }); }} />
      </div>
      {tick.pause && !snap.finished && speed === 0 && (
        <div className="rounded-xl border border-warn-bg bg-[#221C10] px-4 py-2.5 text-[13px]" role="status">
          {tick.pause === 'halfTime' ? 'Descanso. Revisa la táctica, haz cambios o lanza un grito antes de reanudar.' : tick.pause === 'injury' ? 'Uno de tus jugadores se ha lesionado. Revisa los cambios.' : tick.pause === 'redCard' ? 'Te han expulsado a un jugador. Conviene reorganizar al equipo.' : 'Partido en pausa.'}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Pitch teams={snap.teams} kits={kits} action={action} stepMs={anim.stepMs} flash={flash} cards={cards} />
          <Card title="Comentarios" icon="news" padded actions={<span className="flex items-center gap-1.5 text-[13px] text-muted"><Icon name="mic" size={14} />Narra <span className="font-semibold text-soft">{info.narrator}</span></span>}>
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-auto text-[13px]" aria-live="polite">
              {comments.map((c) => (
                <li key={`${c.index}${c.text}`} className="flex gap-3">
                  <span className="num w-12 shrink-0 text-xs text-muted">{c.minute}</span>
                  <span className={cx(c.kind === 'goal' && 'font-semibold', c.kind === 'goal' && (c.teamId === me.clubId ? 'text-good-text' : 'text-bad-text'),
                    c.kind === 'card' && 'text-warn', c.kind === 'injury' && 'text-bad-text', c.kind === 'whistle' && 'text-accent-text', (c.kind === 'info' || c.kind === 'sub' || c.kind === 'tactic') && 'text-soft')}>{c.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <AdviceCard advice={tick.advice} onApply={(a) => {
            if ((a.kind === 'tweakOn' || a.kind === 'tweakOff') && a.tweak) void command({ type: 'tweak', tweak: a.tweak, active: a.kind === 'tweakOn' });
            if (a.kind === 'sub' && a.outId && a.inId) void command({ type: 'substitution', outId: a.outId, inId: a.inId });
          }} />
          <Card padded>
            <Tabs label="Controles" value={panel} onChange={setPanel} items={[{ id: 'subs', label: 'Cambios', icon: 'squad' }, { id: 'tactic', label: 'Táctica', icon: 'tactics' }, { id: 'shouts', label: 'Gritos', icon: 'whistle' }]} />
            {panel === 'subs' && <Subs team={me} max={snap.maxSubstitutions} out={subOut} inn={subIn} setOut={setSubOut} setIn={setSubIn}
              onConfirm={() => { if (subOut && subIn) { void command({ type: 'substitution', outId: subOut, inId: subIn }); setSubOut(null); setSubIn(null); } }} />}
            {panel === 'tactic' && <TacticPanel team={me} advice={tick.advice} onMentality={(m) => void command({ type: 'mentality', mentality: m })} onTweak={(tw, on) => void command({ type: 'tweak', tweak: tw, active: on })} />}
            {panel === 'shouts' && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  {SHOUT_IDS.map((s) => <Button key={s} icon={SHOUT_ICON[s]} onClick={() => void command({ type: 'shout', shout: s })}>{t(`shout.${s}`)}</Button>)}
                </div>
                <p className="text-xs text-muted">Los gritos cambian el estado de ánimo (confianza, concentración, agresividad, tensión), no los atributos. El efecto depende del carácter del equipo y del marcador.</p>
                {shoutMsg && <div className="rounded-lg bg-card2 px-3 py-2 text-[13px] text-soft"><span className="mr-1 text-accent-text">Cuerpo técnico:</span>{shoutMsg}</div>}
              </div>
            )}
          </Card>
          <LiveStats home={home} away={away} homeColor={kitAccent(kits.home)} awayColor={kitAccent(kits.away)} heat={heat} userSide={info.userSide} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- colores
// ---------------------------------------------------------------- campo 2D
function Pitch({ teams, kits, action, stepMs, flash, cards }: {
  teams: [LiveTeam, LiveTeam]; kits: MatchKits; action: ReplayAction | undefined; stepMs: number; flash: Flash | null; cards: CardMark[];
}) {
  const ball = action ? { x: action.x2, y: action.y2 } : { x: 0.5, y: 0.5 };
  const attackSide = action?.side ?? 0;
  const pos = useMemo(() => {
    const out: { p: LivePlayer; side: 0 | 1; left: number; top: number }[] = [];
    teams.forEach((tm, side) => {
      for (const p of tm.players) {
        if (!p.onPitch) continue;
        let x = side === 0 ? p.x : 1 - p.x;
        let y = side === 0 ? p.y : 1 - p.y;
        const attacking = side === attackSide;
        if (!p.isGk) {
          x += (attacking ? 1 : -1) * (side === 0 ? 1 : -1) * 0.06;
          x += (ball.x - x) * (attacking ? 0.18 : 0.26);
          y += (ball.y - y) * (attacking ? 0.15 : 0.3);
        }
        if (action && (p.id === action.targetId || (!action.targetId && p.id === action.playerId))) { x = ball.x; y = ball.y; }
        out.push({ p, side: side as 0 | 1, ...pitchPos(Math.min(0.99, Math.max(0.01, x)), Math.min(0.98, Math.max(0.02, y))) });
      }
    });
    return out;
  }, [teams, ball.x, ball.y, attackSide, action]);
  const dur = `${Math.min(900, stepMs)}ms`;
  const label = `Campo: ${teams[0].name} ${teams[0].goals}, ${teams[1].name} ${teams[1].goals}. ${action ? `Balón en poder de ${attackSide === 0 ? teams[0].name : teams[1].name}` : ''}`;
  return (
    <FootballPitch label={label} className="shadow-lg">
      {pos.map(({ p, side, left, top }) => {
        const card = cards.find((c) => c.playerId === p.id);
        const kit = side === 0 ? (p.isGk ? kits.homeGk : kits.home) : (p.isGk ? kits.awayGk : kits.away);
        return (
          <div key={p.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${left}%`, top: `${top}%`, transition: `left ${dur} ease-out, top ${dur} ease-out` }} title={`${p.fullName} · ${t(`pos.${p.position}`)} · ${p.condition}%`}>
            <KitDisc kit={kit} size={22} label={p.isGk ? 'P' : ''} />
            <div className="pointer-events-none mt-0.5 w-20 -translate-x-[29px] truncate text-center text-[10px] font-semibold text-white" style={{ textShadow: '0 1px 2px #000, 0 0 3px rgba(0,0,0,0.8)' }}>{p.name}</div>
            {card && <span className={cx('absolute -right-1 -top-2 h-3 w-2 rounded-[1px]', card.color === 'yellow' ? 'bg-warn' : 'bg-bad-strong')} aria-hidden="true" />}
          </div>
        );
      })}
      <div className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pitchPos(ball.x, ball.y).left}%`, top: `${pitchPos(ball.x, ball.y).top}%`, transition: `left ${dur} linear, top ${dur} linear` }} aria-hidden="true">
        <div className="absolute left-1 top-2 h-1.5 w-3 rounded-full bg-black/50 blur-[1px]" />
        <div className="relative h-3 w-3 rounded-full border border-black/40 bg-white" />
      </div>
      {flash && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className={cx('rounded-2xl px-8 py-3 font-display text-4xl font-extrabold text-white shadow-2xl', flash.tone === 'good' ? 'bg-good-strong/90' : flash.tone === 'bad' ? 'bg-bad-strong/90' : 'bg-raise/90')}>{flash.text}</span>
        </div>
      )}
    </FootballPitch>
  );
}

// ---------------------------------------------------------------- paneles
function AdviceCard({ advice, onApply }: { advice: Advice[]; onApply: (a: Advice) => void }) {
  return (
    <Card title="Cuerpo técnico" icon="bulb" raised>
      {advice.length === 0 ? <p className="text-[13px] text-muted">Sin recomendaciones ahora mismo: el plan está funcionando.</p> : (
        <ul className="flex flex-col gap-2">
          {advice.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 text-[13px]">
              <Icon name={a.kind === 'sub' ? 'squad' : a.kind === 'info' ? 'eye' : 'sliders'} className="mt-0.5 shrink-0 text-accent-soft" />
              <span className="flex-1 text-soft">{a.text}</span>
              {a.kind !== 'info' && <Button size="sm" variant="soft" onClick={() => onApply(a)}>{a.kind === 'sub' ? 'Hacer cambio' : a.kind === 'tweakOn' ? 'Activar' : 'Quitar'}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Subs({ team, max, out, inn, setOut, setIn, onConfirm }: {
  team: LiveTeam; max: number; out: string | null; inn: string | null; setOut: (id: string | null) => void; setIn: (id: string | null) => void; onConfirm: () => void;
}) {
  const on = team.players.filter((p) => p.onPitch);
  const bench = team.players.filter((p) => !p.used && !p.injured);
  const left = max - team.subsUsed;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex justify-between text-xs text-muted"><span>Cambios: {team.subsUsed}/{max}</span><span>Ventanas usadas: {team.subWindowsUsed}/3</span></div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-[0.08em] text-muted">En el campo · elige quién sale</div>
        <ul className="flex flex-col gap-0.5">
          {on.map((p) => (
            <li key={p.id}>
              <button type="button" aria-pressed={out === p.id} onClick={() => setOut(out === p.id ? null : p.id)} className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left', out === p.id ? 'bg-bad-bg' : 'hover:bg-card2')}>
                <Badge tone="accent" className="w-9 justify-center">{t(`pos.${p.position}`)}</Badge>
                <span className="min-w-0 flex-1 truncate">{p.fullName}{p.yellow > 0 && <span className="ml-1.5 inline-block h-2.5 w-2 rounded-[1px] bg-warn align-middle" title="Amonestado" />}</span>
                <Bar value={p.condition} width={40} label={`Condición ${p.condition}%`} />
                <span className={cx('num w-8 text-right font-semibold', ratingClass(p.rating))}>{p.rating?.toFixed(1).replace('.', ',') ?? '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-[0.08em] text-muted">Banquillo · elige quién entra</div>
        <ul className="flex flex-col gap-0.5">
          {bench.map((p) => (
            <li key={p.id}>
              <button type="button" aria-pressed={inn === p.id} onClick={() => setIn(inn === p.id ? null : p.id)} className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left', inn === p.id ? 'bg-good-bg' : 'hover:bg-card2')}>
                <Badge tone="accent" className="w-9 justify-center">{t(`pos.${p.position}`)}</Badge>
                <span className="min-w-0 flex-1 truncate">{p.fullName}</span>
                <Bar value={p.condition} width={40} label={`Condición ${p.condition}%`} />
              </button>
            </li>
          ))}
          {bench.length === 0 && <li className="px-2 text-muted">No quedan suplentes.</li>}
        </ul>
      </div>
      <Button variant="primary" icon="swap" disabled={!out || !inn || left <= 0} onClick={onConfirm}>{left <= 0 ? 'Sin cambios disponibles' : 'Hacer el cambio'}</Button>
    </div>
  );
}

function TacticPanel({ team, advice, onMentality, onTweak }: { team: LiveTeam; advice: Advice[]; onMentality: (m: Mentality) => void; onTweak: (t: TweakId, on: boolean) => void }) {
  const recommended = new Set(advice.filter((a) => a.kind === 'tweakOn' && a.tweak).map((a) => a.tweak));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-[0.08em] text-muted">Mentalidad</div>
        <Segmented label="Mentalidad" strong columns={4} value={team.baseMentality} onChange={(m) => onMentality(m as Mentality)}
          options={['Muy def.', 'Defensiva', 'Precavida', 'Equilibrada', 'Positiva', 'Ofensiva', 'Muy of.'].map((label, i) => ({ value: i + 1, label }))} />
      </div>
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-[0.08em] text-muted">Ajustes rápidos (se mantienen hasta quitarlos)</div>
        <div className="flex flex-wrap gap-1.5">
          {TWEAK_IDS.map((tw) => {
            const active = team.tweaks.includes(tw);
            return (
              <button key={tw} type="button" aria-pressed={active} onClick={() => onTweak(tw, !active)}
                className={cx('flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs', active ? 'border-accent bg-accent text-white' : 'border-line2 text-soft hover:bg-card2')}>
                {active && <Icon name="check" size={12} />}{t(`tweak.${tw}`)}{recommended.has(tw) && !active && <span className="h-1.5 w-1.5 rounded-full bg-good" title="Recomendado" />}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">Puedes combinar varios; algunos se contrarrestan entre sí. El punto verde marca lo que recomienda el cuerpo técnico.</p>
      </div>
    </div>
  );
}

function LiveStats({ home, away, homeColor, awayColor, heat, userSide }: { home: LiveTeam; away: LiveTeam; homeColor: string; awayColor: string; heat: number[][]; userSide: 0 | 1 }) {
  const [heatSide, setHeatSide] = useState<0 | 1>(userSide);
  const rows: [string, number, number, (v: number) => string][] = [
    ['Posesión', home.stats.possession, away.stats.possession, (v) => `${v}%`],
    ['Tiros', home.stats.shots, away.stats.shots, String],
    ['A puerta', home.stats.shotsOnTarget, away.stats.shotsOnTarget, String],
    ['xG', home.stats.xg, away.stats.xg, (v) => v.toFixed(2).replace('.', ',')],
    ['Pases', home.stats.passes, away.stats.passes, String],
    ['Acierto en el pase', home.stats.passes ? Math.round((home.stats.passesCompleted / home.stats.passes) * 100) : 0, away.stats.passes ? Math.round((away.stats.passesCompleted / away.stats.passes) * 100) : 0, (v) => `${v}%`],
    ['Córners', home.stats.corners, away.stats.corners, String],
    ['Faltas', home.stats.fouls, away.stats.fouls, String],
    ['Tarjetas', home.stats.yellow + home.stats.red, away.stats.yellow + away.stats.red, String],
  ];
  const grid = heat[heatSide] ?? [];
  const max = Math.max(1, ...grid);
  return (
    <Card title="Estadísticas en vivo" icon="chart">
      <table className="w-full text-[13px]"><tbody>
        {rows.map(([label, h, a, f]) => {
          const pct = h + a > 0 ? (h / (h + a)) * 100 : 50;
          return (
            <tr key={label}>
              <td className="num w-12 py-1 text-right font-semibold">{f(h)}</td>
              <td className="px-3"><div className="text-center text-xs text-muted">{label}</div>
                <div className="flex h-1.5 gap-px overflow-hidden rounded"><div style={{ width: `${pct}%`, background: homeColor }} /><div className="flex-1" style={{ background: awayColor }} /></div></td>
              <td className="num w-12 font-semibold">{f(a)}</td>
            </tr>
          );
        })}
      </tbody></table>
      <div className="mt-4 flex items-center gap-2">
        <span className="flex-1 text-xs uppercase tracking-[0.08em] text-muted">Mapa de calor</span>
        <div className="w-44"><Segmented label="Equipo del mapa de calor" value={heatSide} onChange={setHeatSide} options={[{ value: 0, label: home.name.split(' ')[0] ?? 'Local' }, { value: 1, label: away.name.split(' ')[0] ?? 'Visitante' }]} /></div>
      </div>
      <FootballPitch className="mt-2 !rounded-lg" label={`Mapa de calor de ${heatSide === 0 ? home.name : away.name}`}>
        <div className="absolute grid grid-cols-8 grid-rows-5" style={{ left: `${pitchPos(0, 0).left}%`, top: `${pitchPos(0, 0).top}%`, right: `${pitchPos(0, 0).left}%`, bottom: `${pitchPos(0, 0).top}%` }}>
          {grid.map((v, i) => <div key={i} style={{ background: `rgba(255, 196, 0, ${Math.min(0.75, (v / max) * 0.75)})`, mixBlendMode: 'screen' }} />)}
        </div>
      </FootballPitch>
      <p className="mt-1.5 text-[11px] text-faint">Dónde ha tenido el balón cada equipo (el local ataca hacia la derecha).</p>
    </Card>
  );
}
