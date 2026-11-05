/**
 * Diálogos del mercado: oferta a un club (traspaso o cesión), negociación de contrato
 * con el jugador y su agente, poner a la venta / en cesión y responder a ofertas.
 */
import { useEffect, useState } from 'react';
import type { ContractTerms, OfferTerms, SquadRole } from '../../engine/transfers';
import type { dealView } from '../../engine/transfers';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Badge, Button, cx, Dialog, money, Segmented, Toggle } from '../kit';

export type DealInfo = ReturnType<typeof dealView>;

export const ROLE_OPTIONS: { value: SquadRole; label: string }[] = [
  { value: 'star', label: 'Estrella' }, { value: 'important', label: 'Importante' }, { value: 'rotation', label: 'Rotación' },
  { value: 'backup', label: 'Suplente' }, { value: 'youth', label: 'Promesa' },
];

/** Campo de importe en euros con atajos (escribe 2,5M o 300k). */
export function MoneyInput({ label, value, onChange, hint, step }: { label: string; value: number; onChange: (v: number) => void; hint?: string; step?: number }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => { setText(fmt(value)); }, [value]);
  const commit = (s: string) => {
    const v = parseMoney(s);
    if (v !== null) onChange(v);
    else setText(fmt(value));
  };
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-soft">{label}</span>
      <div className="flex items-center gap-1.5">
        <input className="h-9 w-full rounded-lg border border-line2 bg-card2 px-3 text-text num" value={text} inputMode="decimal"
          onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} aria-label={label} />
        {step ? <>
          <button type="button" className="h-9 w-9 shrink-0 rounded-lg border border-line2 text-soft hover:bg-card2" aria-label={`Bajar ${label}`} onClick={() => onChange(Math.max(0, value - step))}>−</button>
          <button type="button" className="h-9 w-9 shrink-0 rounded-lg border border-line2 text-soft hover:bg-card2" aria-label={`Subir ${label}`} onClick={() => onChange(value + step)}>+</button>
        </> : null}
      </div>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function fmt(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '').replace('.', ',')}k`;
  return String(Math.round(v));
}
export function parseMoney(s: string): number | null {
  const m = s.trim().toLowerCase().replace(/\s|€/g, '').replace(',', '.').match(/^(\d+(?:\.\d+)?)(m|k)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
  return Math.round(n);
}

function NumberField({ label, value, onChange, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-soft">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className="num h-9 w-24 rounded-lg border border-line2 bg-card2 px-3 text-text" aria-label={label} />
        {suffix && <span className="text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-lg border border-bad-bg bg-[#2A1418] px-3 py-2 text-[13px] text-bad-text">{error}</p> : null;
}

// ---------------------------------------------------------------- oferta al club
export function OfferDialog({ open, onClose, player, loan, onSent }: {
  open: boolean; onClose: () => void; loan: boolean;
  player: { id: string; name: string; value: number; asking: number | null; club: string | null; free: boolean };
  onSent: (deal: DealInfo) => void;
}) {
  const { dashboard } = useGame();
  const [fee, setFee] = useState(player.asking ?? player.value);
  const [inst, setInst] = useState(0);
  const [sellOn, setSellOn] = useState(0);
  const [bonusOn, setBonusOn] = useState(false);
  const [bonus, setBonus] = useState(Math.round((player.asking ?? player.value) * 0.1));
  const [apps, setApps] = useState(25);
  const [swap, setSwap] = useState<string>('');
  const [share, setShare] = useState(75);
  const [loanFee, setLoanFee] = useState(0);
  const [optOn, setOptOn] = useState(false);
  const [opt, setOpt] = useState(Math.round(player.value * 1.1));
  const [squad, setSquad] = useState<{ id: string; name: string; value: number; position: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError(null);
    void game('squadTable').then((rows) => setSquad(rows.map((r) => ({ id: r.id, name: r.name, value: r.value, position: r.position }))));
  }, [open]);
  const send = async () => {
    setBusy(true);
    setError(null);
    const terms: OfferTerms = loan
      ? { fee: 0, installments: 0, sellOnPct: 0, bonus: null, swapPlayerId: null, loan: { wageShare: share, fee: loanFee, buyOption: optOn ? opt : null } }
      : { fee: player.free ? 0 : fee, installments: inst, sellOnPct: sellOn, bonus: bonusOn ? { amount: bonus, apps } : null, swapPlayerId: swap || null, loan: null };
    try {
      const deal = await game('makeOffer', { playerId: player.id, terms });
      onSent(deal);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const budget = dashboard?.finances.transferBudget ?? 0;
  return (
    <Dialog open={open} onClose={onClose} title={player.free ? `Fichar a ${player.name} (libre)` : loan ? `Cesión de ${player.name}` : `Oferta por ${player.name}`} width={620}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
          <span>Valor: <b className="text-text">{money(player.value)}</b></span>
          {player.asking !== null && !player.free && <span>Precio estimado del club: <b className="text-text">{money(player.asking)}</b></span>}
          <span>Tu presupuesto: <b className={cx(budget < fee && !loan ? 'text-bad-text' : 'text-text')}>{money(budget)}</b></span>
        </div>
        {player.free ? <p className="text-[13px] text-soft">Es agente libre: no hay traspaso. Pasarás directamente a negociar el contrato con el jugador y su agente.</p> : loan ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><span className="mb-1 block text-[13px] text-soft">Parte del salario que pagas</span>
              <Segmented label="Parte del salario" value={share} onChange={setShare} options={[25, 50, 75, 100].map((v) => ({ value: v, label: `${v} %` }))} /></div>
            <MoneyInput label="Cuota de cesión" value={loanFee} onChange={setLoanFee} hint="Opcional" />
            <div className="flex flex-col gap-2">
              <Toggle label="Opción de compra" checked={optOn} onChange={setOptOn} />
              {optOn && <MoneyInput label="Importe de la opción" value={opt} onChange={setOpt} />}
            </div>
            <p className="text-xs text-muted sm:col-span-2">La cesión dura hasta final de temporada. Con opción de compra podrás quedártelo pagando el importe antes de que acabe.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyInput label="Importe del traspaso" value={fee} onChange={setFee} step={Math.max(50000, Math.round(player.value * 0.05 / 50000) * 50000)} />
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-soft">Forma de pago</span>
              <select value={inst} onChange={(e) => setInst(Number(e.target.value))} className="h-9 rounded-lg border border-line2 bg-card2 px-3 text-text">
                <option value={0}>Al contado</option>
                {[6, 12, 24, 36].map((m) => <option key={m} value={m}>40 % ahora y el resto en {m} meses</option>)}
              </select></label>
            <NumberField label="Porcentaje de futura venta" value={sellOn} onChange={setSellOn} min={0} max={50} suffix="% para el vendedor" />
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-soft">Intercambio (jugador tuyo que entra)</span>
              <select value={swap} onChange={(e) => setSwap(e.target.value)} className="h-9 rounded-lg border border-line2 bg-card2 px-3 text-text">
                <option value="">Ninguno</option>
                {squad.map((p) => <option key={p.id} value={p.id}>{t(`pos.${p.position}`)} · {p.name} ({money(p.value)})</option>)}
              </select></label>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Toggle label="Bonus por partidos jugados" checked={bonusOn} onChange={setBonusOn} />
              {bonusOn && <div className="grid gap-4 sm:grid-cols-2"><MoneyInput label="Importe del bonus" value={bonus} onChange={setBonus} /><NumberField label="Tras" value={apps} onChange={setApps} min={5} max={150} suffix="partidos" /></div>}
            </div>
          </div>
        )}
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={player.free ? 'docCheck' : 'transfers'} disabled={busy} onClick={() => void send()}>{player.free ? 'Negociar contrato' : 'Enviar oferta'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- contrato con el jugador
type DealWithDemands = DealInfo & { demands: ContractTerms | null };

export function ContractDialog({ dealId, onClose, onDone }: { dealId: string | null; onClose: () => void; onDone?: () => void }) {
  const { setDashboard } = useGame();
  const [deal, setDeal] = useState<DealWithDemands | null>(null);
  const [terms, setTerms] = useState<ContractTerms | null>(null);
  const [clauseOn, setClauseOn] = useState(false);
  const [reply, setReply] = useState<{ result: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReply(null);
    setError(null);
    if (!dealId) { setDeal(null); return; }
    void game('deal', { dealId }).then((d) => {
      setDeal(d);
      if (d?.demands) { setTerms({ ...d.demands, wage: Math.round(d.demands.wage * 0.9) }); setClauseOn(!!d.demands.releaseClause); }
    });
  }, [dealId]);
  if (!dealId) return null;
  const d = deal?.demands;
  const set = <K extends keyof ContractTerms>(k: K, v: ContractTerms[K]) => setTerms((x) => (x ? { ...x, [k]: v } : x));
  const propose = async () => {
    if (!terms || !deal) return;
    setBusy(true);
    setError(null);
    try {
      const r = await game('proposeContract', { dealId: deal.id, terms: { ...terms, releaseClause: clauseOn ? terms.releaseClause ?? Math.round((deal.player?.value ?? 0) * 2) : null } });
      setReply({ result: r.result, text: r.text });
      setDashboard(r.dashboard);
      setDeal({ ...r.deal, demands: r.demands });
      if (r.result === 'accepted' || r.result === 'rejected') onDone?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const open = deal?.status === 'negotiating';
  const title = deal ? (deal.kind === 'renewal' ? `Renovación de ${deal.player?.name ?? ''}` : `Contrato de ${deal.player?.name ?? ''}`) : 'Contrato';
  return (
    <Dialog open={!!dealId} onClose={onClose} title={title} width={720}>
      {!deal || !terms ? <p className="text-sm text-muted">{deal && !deal.demands ? 'La negociación ya no está abierta.' : 'Cargando…'}</p> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <span>Interés del jugador:</span>
            <Badge tone={deal.interest >= 60 ? 'good' : deal.interest >= 40 ? 'warn' : 'bad'}>{deal.interest >= 60 ? 'Alto' : deal.interest >= 40 ? 'Medio' : 'Bajo'}</Badge>
            <span>Paciencia:</span><span className="flex gap-1" aria-label={`Le quedan ${deal.patience} rondas`}>{[0, 1, 2].map((i) => <span key={i} className={cx('h-2 w-5 rounded-sm', i < deal.patience ? 'bg-accent-soft' : 'bg-line2')} />)}</span>
            {deal.kind !== 'renewal' && deal.terms.fee > 0 && <span>Traspaso acordado: <b className="text-text">{money(deal.terms.fee)}</b></span>}
          </div>
          {d && (
            <div className="rounded-xl border border-line bg-card2 px-4 py-3 text-[13px]">
              <div className="mb-1.5 text-xs uppercase tracking-[0.08em] text-muted">Lo que pide el agente</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-soft">
                <span>Salario <b className="text-text">{money(d.wage)}/sem</b></span><span><b className="text-text">{d.years}</b> años</span>
                <span>Rol <b className="text-text">{ROLE_OPTIONS.find((r) => r.value === d.role)?.label}</b></span>
                <span>Prima <b className="text-text">{money(d.signingBonus)}</b></span><span>Comisión <b className="text-text">{money(d.agentFee)}</b></span>
                {d.releaseClause && <span>Cláusula ≤ <b className="text-text">{money(d.releaseClause * 1.6)}</b></span>}
              </div>
            </div>
          )}
          <fieldset disabled={!open} className="grid gap-4 sm:grid-cols-2">
            <MoneyInput label="Salario semanal" value={terms.wage} onChange={(v) => set('wage', v)} step={Math.max(100, Math.round(terms.wage * 0.05 / 100) * 100)} />
            <NumberField label="Duración" value={terms.years} onChange={(v) => set('years', v)} min={1} max={5} suffix="años" />
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-soft">Rol en la plantilla</span>
              <select value={terms.role} onChange={(e) => set('role', e.target.value as SquadRole)} className="h-9 rounded-lg border border-line2 bg-card2 px-3 text-text">
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select></label>
            <MoneyInput label="Bonus por gol" value={terms.goalBonus} onChange={(v) => set('goalBonus', v)} />
            <MoneyInput label="Prima de fichaje" value={terms.signingBonus} onChange={(v) => set('signingBonus', v)} />
            <MoneyInput label="Comisión del agente" value={terms.agentFee} onChange={(v) => set('agentFee', v)} />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Toggle label="Cláusula de rescisión" checked={clauseOn} onChange={setClauseOn} />
              {clauseOn && <MoneyInput label="Importe de la cláusula" value={terms.releaseClause ?? Math.round((deal.player?.value ?? 0) * 2)} onChange={(v) => set('releaseClause', v)} />}
            </div>
          </fieldset>
          {reply && (
            <p role="status" className={cx('rounded-lg border px-3 py-2 text-[13px]', reply.result === 'accepted' ? 'border-good-bg bg-[#0F2219] text-good-text' : reply.result === 'rejected' ? 'border-bad-bg bg-[#2A1418] text-bad-text' : 'border-warn-bg bg-[#221C10] text-warn')}>{reply.text}</p>
          )}
          <ErrorText error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {open && d && <Button variant="ghost" onClick={() => setTerms({ ...terms, ...d })}>Igualar lo que pide</Button>}
            <Button variant="ghost" onClick={onClose}>{open ? 'Cerrar' : 'Listo'}</Button>
            {open && <Button variant="primary" icon="docCheck" disabled={busy} onClick={() => void propose()}>Proponer contrato</Button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- en venta / cesión
export function ListDialog({ open, onClose, player, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void; player: { id: string; name: string; value: number; listed: { asking: number | null; loan: boolean } | null }; loan?: boolean }) {
  const [asking, setAsking] = useState(player.listed?.asking ?? player.value);
  const [loan, setLoan] = useState(player.listed?.loan ?? false);
  const save = async (listing: { asking: number | null; loan: boolean } | null) => {
    await game('setListed', { playerId: player.id, listing });
    onSaved();
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Ofrecer a ${player.name}`} width={480}>
      <div className="flex flex-col gap-4">
        <Segmented label="Tipo" value={loan ? 'loan' : 'sale'} onChange={(v) => setLoan(v === 'loan')} options={[{ value: 'sale', label: 'En venta' }, { value: 'loan', label: 'Cedible' }]} />
        {!loan && <MoneyInput label="Precio pedido" value={asking} onChange={setAsking} hint={`Valor de mercado: ${money(player.value)}`} />}
        <p className="text-xs text-muted">Los clubes interesados harán ofertas mientras el mercado esté abierto. Te llegarán a la bandeja.</p>
        <div className="flex justify-end gap-2">
          {player.listed && <Button variant="ghost" onClick={() => void save(null)}>Quitar de la lista</Button>}
          <Button variant="primary" icon="transfers" onClick={() => void save({ asking: loan ? null : asking, loan })}>Ofrecer</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- oferta recibida
export function IncomingDialog({ deal, onClose, onDone }: { deal: DealInfo | null; onClose: () => void; onDone: () => void }) {
  const { setDashboard } = useGame();
  const [counter, setCounter] = useState(deal ? Math.round(deal.terms.fee * 1.25) : 0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (deal) setCounter(Math.round(Math.max(deal.terms.fee, deal.player?.value ?? 0) * 1.25)); setError(null); }, [deal]);
  if (!deal) return null;
  const answer = async (a: 'accept' | 'reject' | { counterFee: number }) => {
    try {
      const r = await game('respondIncoming', { dealId: deal.id, answer: a });
      setDashboard(r.dashboard);
      onDone();
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  const t0 = deal.terms;
  return (
    <Dialog open={!!deal} onClose={onClose} title={`Oferta de ${deal.buyer} por ${deal.player?.name ?? ''}`} width={520}>
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-soft">
          {t0.loan ? <span>Cesión · pagan el <b className="text-text">{t0.loan.wageShare} %</b> del salario{t0.loan.buyOption ? <> · opción de compra <b className="text-text">{money(t0.loan.buyOption)}</b></> : null}</span>
            : <><span>Ofrecen <b className="text-text">{money(t0.fee)}</b></span>{t0.installments > 0 && <span>en {t0.installments} plazos</span>}{t0.sellOnPct > 0 && <span>{t0.sellOnPct} % de futura venta</span>}</>}
          <span>Valor: <b className="text-text">{money(deal.player?.value ?? 0)}</b></span>
        </div>
        {!t0.loan && <MoneyInput label="Contraoferta (importe que pides)" value={counter} onChange={setCounter} />}
        <ErrorText error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => void answer('reject')}>Rechazar</Button>
          {!t0.loan && <Button onClick={() => void answer({ counterFee: counter })}>Pedir {money(counter)}</Button>}
          <Button variant="primary" icon="check" onClick={() => void answer('accept')}>Aceptar</Button>
        </div>
      </div>
    </Dialog>
  );
}
