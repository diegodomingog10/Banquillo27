import type { FixtureView, TableRowView } from '../../engine/views';
import { useGame } from '../../store/gameStore';
import { fmtShort } from '../format';
import { cx, FormBadge } from '../kit';

/** Nombre de jugador que abre su perfil. */
export function PlayerLink({ id, name, className }: { id: string; name: string; className?: string }) {
  const go = useGame((s) => s.go);
  return <button type="button" onClick={() => go('player', { playerId: id })} className={cx('text-left hover:text-accent-text hover:underline', className)}>{name}</button>;
}

export function ClubLink({ id, name, className }: { id: string; name: string; className?: string }) {
  const go = useGame((s) => s.go);
  return <button type="button" onClick={() => go('club', { clubId: id })} className={cx('text-left hover:text-accent-text hover:underline', className)}>{name}</button>;
}

export function FixtureRow({ f, highlight, onOpen }: { f: FixtureView; highlight?: string; onOpen?: (id: string) => void }) {
  return (
    <tr className="border-t border-[#221E2C]">
      <td className="py-2 pr-3 text-xs text-muted">{fmtShort(f.date)}</td>
      <td className={cx('pr-2 text-right', f.homeId === highlight && 'font-semibold text-[#E9E2FF]')}><ClubLink id={f.homeId} name={f.homeName} /></td>
      <td className="px-2 text-center">
        {f.played && onOpen
          ? <button type="button" onClick={() => onOpen(f.id)} className="num rounded-md bg-card2 px-2 py-0.5 font-semibold hover:bg-accent-bg" aria-label={`Ver partido ${f.homeName} ${f.homeGoals}-${f.awayGoals} ${f.awayName}`}>{f.homeGoals} - {f.awayGoals}</button>
          : <span className="num font-semibold text-faint">{f.played ? `${f.homeGoals} - ${f.awayGoals}` : 'vs'}</span>}
        {f.extra && <span className="ml-1 text-[11px] text-muted">({f.extra})</span>}
      </td>
      <td className={cx('pl-2', f.awayId === highlight && 'font-semibold text-[#E9E2FF]')}><ClubLink id={f.awayId} name={f.awayName} /></td>
      <td className="hidden pl-3 text-xs text-muted md:table-cell">{f.competitionName} · {f.roundLabel}</td>
      <td className="pl-2 text-right">{f.outcome && <FormBadge o={f.outcome} size={22} />}</td>
    </tr>
  );
}

const ZONE: Record<string, string> = {
  promotion: 'shadow-[inset_3px_0_0_#34D399]', playoff: 'shadow-[inset_3px_0_0_#FCD34D]', relegation: 'shadow-[inset_3px_0_0_#F87171]', continental: 'shadow-[inset_3px_0_0_#A78BFA]',
};

export function LeagueTable({ rows, highlight, compact }: { rows: TableRowView[]; highlight?: string; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-2 pl-2.5 font-medium">#</th><th className="font-medium">Club</th><th className="text-right font-medium">PJ</th>
            {!compact && <><th className="text-right font-medium">G</th><th className="text-right font-medium">E</th><th className="text-right font-medium">P</th><th className="text-right font-medium">GF</th><th className="text-right font-medium">GC</th></>}
            <th className="text-right font-medium">DG</th><th className="pr-2 text-right font-medium">Pts</th>{!compact && <th className="pl-4 font-medium">Forma</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.clubId} className={cx('border-t border-[#221E2C]', r.zone && ZONE[r.zone], r.clubId === highlight && 'bg-accent-bg font-semibold text-[#E9E2FF]')}>
              <td className="py-1.5 pl-2.5 text-muted">{r.position}</td>
              <td><ClubLink id={r.clubId} name={r.clubName} /></td>
              <td className="text-right">{r.played}</td>
              {!compact && <><td className="text-right">{r.won}</td><td className="text-right">{r.drawn}</td><td className="text-right">{r.lost}</td><td className="text-right">{r.gf}</td><td className="text-right">{r.ga}</td></>}
              <td className="text-right text-muted">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
              <td className="pr-2 text-right font-semibold">{r.points}</td>
              {!compact && <td className="pl-4"><span className="inline-flex gap-1">{r.form.map((o, i) => <FormBadge key={i} o={o} size={20} />)}</span></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] bg-good" />Ascenso</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] bg-warn" />Playoff</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] bg-accent-soft" />Torneo continental</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] bg-bad" />Descenso</span>
        </div>
      )}
    </div>
  );
}
