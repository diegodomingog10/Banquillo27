import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Badge, Bar, Card, Dots, Empty, money, Stat } from '../kit';
import { KitShirt } from '../pitch';
import { ClubLink, PlayerLink } from './shared';

type ClubData = NonNullable<Awaited<ReturnType<typeof game<'club'>>>>;

export function ClubScreen() {
  const { nav, dashboard } = useGame();
  const [c, setC] = useState<ClubData | null>(null);
  const id = nav.clubId ?? dashboard?.club.id ?? '';
  useEffect(() => { if (id) void game('club', { id }).then(setC); }, [id, dashboard?.date]);
  if (!c) return <p className="text-sm text-muted">Cargando…</p>;
  const f = c.finances;
  return (
    <div className="flex flex-col gap-[18px]">
      <Card className="flex flex-wrap items-center gap-5 !p-6">
        <KitShirt kit={c.kits.home} size={68} title={`Primera equipación de ${c.name}`} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2.5"><h1 className="font-display text-[26px] font-extrabold tracking-tight">{c.name}</h1>{c.isUser && <Badge tone="accent">Tu club</Badge>}</div>
          <div className="text-muted">{c.city} · {c.nation}{c.founded ? ` · fundado en ${c.founded}` : ''}{c.league ? ` · ${c.league.name}${c.position ? ` (${c.position}.º)` : ''}` : ''}</div>
        </div>
        <div className="flex flex-wrap gap-7">
          <Stat label="Reputación" value={c.reputation.toLocaleString('es')} />
          <Stat label="Estadio" value={c.stadium.capacity.toLocaleString('es')} hint={c.stadium.name} />
          <Stat label="Títulos" value={c.titles.length} />
        </div>
      </Card>
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <Card title="Equipaciones" icon="shirt">
          <div className="flex justify-around gap-3">
            {([['Primera', c.kits.home], ['Segunda', c.kits.away], ['Portero', c.kits.goalkeeper]] as const).map(([label, k]) => (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <KitShirt kit={k} size={72} title={`${label} equipación de ${c.name}`} />
                <div className="flex gap-1" aria-hidden="true"><span className="h-2.5 w-5 rounded-sm border border-line2" style={{ background: k.shorts }} /><span className="h-2.5 w-3 rounded-sm border border-line2" style={{ background: k.socks }} /></div>
                <span className="text-[13px] text-soft">{label}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Instalaciones" icon="club">
          {([['Entrenamiento', c.facilities.training], ['Cantera', c.facilities.youth], ['Captación juvenil', c.facilities.youthRecruitment], ['Formación juvenil', c.facilities.juniorCoaching], ['Estado del césped', Math.round(c.stadium.pitchCondition / 5)]] as [string, number][]).map(([label, v]) => (
            <div key={label} className="mb-2.5">
              <div className="mb-1 flex justify-between text-[13px]"><span className="text-soft">{label}</span><span className="font-semibold">{v >= 16 ? 'Excelente' : v >= 12 ? 'Buena' : v >= 8 ? 'Normal' : 'Pobre'}</span></div>
              <Bar value={v * 5} tone={v >= 14 ? 'good' : v >= 9 ? 'warn' : 'bad'} width="100%" label={label} />
            </div>
          ))}
        </Card>
        <Card title="Finanzas" icon="finance">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Saldo" value={money(f.balance)} tone={f.balance < 0 ? 'bad' : undefined} />
            <Stat label="Presupuesto de fichajes" value={money(f.transferBudget)} />
            <Stat label="Presupuesto salarial" value={money(f.wageBudget)} hint="por semana" />
            <Stat label="Deuda" value={money(f.debt)} tone={f.debt > 0 ? 'warn' : 'good'} />
          </div>
          <p className="mt-3 text-xs text-muted">Ingresos por temporada: TV {money(f.seasonIncome.tv)}, taquilla {money(f.seasonIncome.tickets)}, patrocinio {money(f.seasonIncome.sponsorship)}. Detalle completo en Finanzas.</p>
        </Card>
        <Card title="Directiva" icon="target">
          <ul className="list-inside list-disc text-[13px] text-soft">{c.objectives.map((o) => <li key={o} className="first-letter:uppercase">{o}</li>)}</ul>
          {c.rivals.length > 0 && <div className="mt-3 text-[13px] text-muted">Rivales: {c.rivals.map((r, i) => <span key={r.id}>{i > 0 && ', '}<ClubLink id={r.id} name={r.name} className="text-soft" /></span>)}</div>}
          <div className="mt-3 text-[13px] text-muted">Palmarés: {c.titles.length ? c.titles.map((x) => `${x.competition} ${x.season}`).join(' · ') : 'sin títulos en esta partida'}</div>
        </Card>
      </div>
      <Card title={`Plantilla (${c.squad.length})`} icon="squad">
        {c.squad.length === 0 ? <Empty>Sin jugadores.</Empty> : (
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {c.squad.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 border-t border-[#221E2C] py-1.5 text-[13px]">
                <Badge tone="accent" className="w-9 justify-center">{t(`pos.${p.position}`)}</Badge>
                <PlayerLink id={p.id} name={p.name} className="min-w-0 flex-1 truncate" />
                <span className="text-xs text-muted">{p.age}</span>
                <Dots value={p.caStars} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
