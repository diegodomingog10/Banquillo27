import { useEffect, useState } from 'react';
import type { ExpenseKey, IncomeKey } from '../../engine/economy';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { BreakdownBars, LineChart } from '../charts';
import { fmtDate } from '../format';
import { Icon } from '../icons';
import { Badge, Button, Card, Empty, money, PageHeader, Stat } from '../kit';
import { MoneyInput } from './market';

type Fin = Awaited<ReturnType<typeof game<'finances'>>>;

const INCOME: Record<IncomeKey, string> = { tickets: 'Taquilla', tv: 'Televisión', sponsorship: 'Patrocinio', merchandising: 'Merchandising', prizes: 'Premios', transfers: 'Ventas y traspasos', other: 'Otros' };
const EXPENSE: Record<ExpenseKey, string> = { wages: 'Salarios de jugadores', staff: 'Salarios del staff', transfers: 'Fichajes', bonuses: 'Primas y bonus', agents: 'Comisiones de agentes', facilities: 'Instalaciones', operations: 'Gastos de operación', interest: 'Intereses de la deuda', fines: 'Multas' };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const signed = (v: number) => (v < 0 ? `-${money(-v)}` : money(v));

export function FinancesScreen() {
  const { dashboard, setDashboard } = useGame();
  const [f, setF] = useState<Fin | null>(null);
  const [shift, setShift] = useState(0);
  const [price, setPrice] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => void game('finances').then((x) => { setF(x); setPrice(x.ticketPrice); });
  useEffect(load, [dashboard?.date]);
  if (!f) return <p className="text-sm text-muted">Cargando…</p>;
  const income = (Object.keys(INCOME) as IncomeKey[]).map((k) => ({ label: INCOME[k], value: f.ledger.income[k], previous: f.lastLedger?.income[k] ?? null })).filter((r) => r.value > 0 || (r.previous ?? 0) > 0);
  const expense = (Object.keys(EXPENSE) as ExpenseKey[]).map((k) => ({ label: EXPENSE[k], value: f.ledger.expense[k], previous: f.lastLedger?.expense[k] ?? null })).filter((r) => r.value > 0 || (r.previous ?? 0) > 0);
  const totalIn = income.reduce((a, r) => a + r.value, 0);
  const totalOut = expense.reduce((a, r) => a + r.value, 0);
  const room = f.wageBudget - f.wageBill;
  const ffpTone = f.ffp.embargo ? 'bad' : f.ffp.status === 'warning' ? 'warn' : f.forecast.projectedResult < -f.ffp.limit * 0.8 ? 'warn' : 'good';
  const apply = async (fn: () => Promise<Fin>, ok: string) => {
    try { const x = await fn(); setF(x); setMsg(ok); setShift(0); setDashboard(await game('dashboard')); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Finanzas" subtitle={`${f.club.name} · temporada ${f.season}`} />
      <Card className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Saldo" value={signed(f.balance)} tone={f.balance < 0 ? 'bad' : undefined} />
        <Stat label="Previsión a final de temporada" value={signed(f.forecast.projectedBalance)} tone={f.forecast.projectedBalance < 0 ? 'bad' : undefined} hint={`resultado ${signed(f.forecast.projectedResult)}`} />
        <Stat label="Presupuesto de fichajes" value={money(f.transferBudget)} />
        <Stat label="Salarios" value={`${money(f.wageBill)}/sem`} hint={`presupuesto ${money(f.wageBudget)}`} tone={room < 0 ? 'bad' : undefined} />
        <Stat label="Pagos pendientes" value={money(f.owed)} hint={f.due ? `nos deben ${money(f.due)}` : 'a otros clubes'} tone={f.owed > f.transferBudget ? 'warn' : undefined} />
        <Stat label="Deuda" value={money(f.debt)} tone={f.debt > 0 ? 'warn' : 'good'} />
      </Card>

      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card title="Evolución del saldo" icon="chart">
          <LineChart label="Saldo a principio de mes" format={signed} points={f.history.map((h) => ({ x: `${MONTHS[Number(h.date.slice(5, 7)) - 1]} ${h.date.slice(2, 4)}`, y: h.balance }))} />
        </Card>
        <Card title="Juego limpio financiero" icon="shield" actions={<Badge tone={ffpTone}>{f.ffp.embargo ? 'Sancionado' : f.ffp.status === 'warning' ? 'Advertido' : ffpTone === 'warn' ? 'En riesgo' : 'Cumple'}</Badge>}>
          <div className="flex flex-col gap-3 text-[13px] text-soft">
            <p>Pérdida máxima permitida por temporada: <b className="text-text">{money(f.ffp.limit)}</b> (si además el saldo queda en negativo).</p>
            <p>Resultado de esta temporada hasta hoy: <b className={f.ffp.seasonResult < 0 ? 'text-bad-text' : 'text-good-text'}>{signed(f.ffp.seasonResult)}</b>. Previsto al cierre: <b className={f.forecast.projectedResult < 0 ? 'text-bad-text' : 'text-good-text'}>{signed(f.forecast.projectedResult)}</b>.</p>
            {f.ffp.embargo && <p className="flex items-center gap-2 text-bad-text"><Icon name="alert" size={15} />No puedes inscribir fichajes hasta {f.ffp.embargoUntil ? fmtDate(f.ffp.embargoUntil) : 'nuevo aviso'}.</p>}
            {f.ffp.fines > 0 && <p>Multas pagadas: <b className="text-text">{money(f.ffp.fines)}</b>.</p>}
            <p className="text-xs text-muted">Primera infracción: advertencia. Si se repite: multa del 3 % de los ingresos y prohibición de fichar en el siguiente mercado de verano.</p>
          </div>
        </Card>
        <Card title={`Ingresos · ${money(totalIn)}`} icon="finance" actions={f.lastLedger ? <span className="text-xs text-muted">| marca = temporada anterior</span> : undefined}>
          {income.length ? <BreakdownBars rows={income} format={money} /> : <Empty>Todavía no hay ingresos esta temporada.</Empty>}
        </Card>
        <Card title={`Gastos · ${money(totalOut)}`} icon="finance">
          {expense.length ? <BreakdownBars rows={expense} format={money} color="#6E6880" /> : <Empty>Todavía no hay gastos esta temporada.</Empty>}
        </Card>
        <Card title="Reparto del presupuesto" icon="sliders">
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="text-soft">Pasa dinero entre fichajes y salarios: 1 € semanal de salario equivale a 52 € de fichajes.</p>
            <input type="range" aria-label="Mover presupuesto entre fichajes y salarios" min={-Math.max(0, Math.round(room))} max={Math.round(f.transferBudget / 52)} step={Math.max(100, Math.round(f.wageBudget / 200 / 100) * 100)}
              value={shift} onChange={(e) => setShift(Number(e.target.value))} className="w-full accent-[#8B5CF6]" />
            <div className="flex flex-wrap justify-between gap-2 text-muted">
              <span>Fichajes: <b className="text-text">{money(Math.max(0, f.transferBudget - shift * 52))}</b></span>
              <span>Salarios: <b className="text-text">{money(f.wageBudget + shift)}/sem</b></span>
            </div>
            <div className="flex justify-end"><Button size="sm" variant="primary" disabled={!shift} onClick={() => void apply(() => game('adjustBudgets', { weekly: shift }), 'Presupuestos actualizados.')}>Aplicar</Button></div>
          </div>
        </Card>
        <Card title="Estadio y entradas" icon="club">
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-wrap gap-6"><Stat label="Aforo" value={f.capacity.toLocaleString('es')} /><Stat label="Abonados" value={f.seasonTicketHolders.toLocaleString('es')} /></div>
            <MoneyInput label="Precio medio de la entrada (€)" value={price} onChange={setPrice} hint="Subirlo da más dinero por entrada, pero viene menos gente." />
            <div className="flex justify-end"><Button size="sm" variant="primary" disabled={price === f.ticketPrice} onClick={() => void apply(() => game('setTicketPrice', { price }), 'Precio actualizado.')}>Guardar precio</Button></div>
          </div>
        </Card>
      </div>
      {msg && <p role="status" className="text-[13px] text-soft">{msg}</p>}
      <Card title="Pagos programados" icon="calendar">
        {f.payments.length ? (
          <table className="w-full text-[13px]"><thead><tr className="text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-1.5 font-medium">Fecha</th><th className="font-medium">Concepto</th><th className="font-medium">Club</th><th className="text-right font-medium">Importe</th></tr></thead>
            <tbody>{f.payments.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-1.5">{fmtDate(p.due)}</td>
                <td>{p.kind === 'installment' ? 'Plazo de traspaso' : p.kind === 'bonus' ? 'Bonus por partidos' : p.kind === 'sellOn' ? 'Porcentaje de reventa' : 'Cesión'}{p.player ? ` · ${p.player}` : ''}</td>
                <td>{p.other}</td>
                <td className={`num text-right font-semibold ${p.out ? 'text-bad-text' : 'text-good-text'}`}>{p.out ? '-' : '+'}{money(p.amount)}</td>
              </tr>
            ))}</tbody></table>
        ) : <Empty>No hay pagos aplazados.</Empty>}
      </Card>
    </div>
  );
}
