import { CircleHelp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ageAt } from '../../engine/date';
import { ATTRIBUTE_GROUPS, type AttributeGroup } from '../../data/attributes';
import { mainPosition } from '../../data/ability';
import type { Player, WorldDatabase } from '../../data/schema';
import { t } from '../../i18n';
import { Panel, attrColor, money } from '../components';

export function BrowseScreen({ world }: { world: WorldDatabase }) {
  const leagues = world.competitions.filter((c) => c.format === 'league');
  const [leagueId, setLeagueId] = useState(leagues[0]?.id ?? '');
  const league = leagues.find((l) => l.id === leagueId);
  const clubs = useMemo(
    () => world.clubs.filter((c) => league?.teamIds.includes(c.id)).sort((a, b) => b.reputation - a.reputation),
    [world, league],
  );
  const [clubId, setClubId] = useState<string | null>(null);
  const club = clubs.find((c) => c.id === clubId) ?? clubs[0];
  const squad = useMemo(() => world.players.filter((p) => p.clubId === club?.id).sort((a, b) => b.ca - a.ca), [world, club]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const player = squad.find((p) => p.id === playerId) ?? squad[0];

  return (
    <div className="max-w-7xl">
      <h2 className="mb-4 font-display text-xl font-bold">{world.meta.name}</h2>
      <div className="mb-4 flex flex-wrap gap-3">
        <select aria-label="Liga" value={leagueId} onChange={(e) => { setLeagueId(e.target.value); setClubId(null); setPlayerId(null); }} className="rounded bg-card2 px-2 py-1 text-sm">
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select aria-label="Club" value={club?.id ?? ''} onChange={(e) => { setClubId(e.target.value); setPlayerId(null); }} className="rounded bg-card2 px-2 py-1 text-sm">
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.reputation})</option>)}
        </select>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Panel title={`Plantilla · ${club?.name ?? ''}`}>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr><th className="py-1">Jugador</th><th>Pos</th><th>Edad</th><th className="text-right">CA</th><th className="text-right">PA</th><th className="text-right">Valor</th><th className="text-right">Salario/sem</th><th /></tr>
              </thead>
              <tbody>
                {squad.map((p) => (
                  <tr key={p.id} onClick={() => setPlayerId(p.id)} className={`cursor-pointer border-t border-line hover:bg-card2 ${p.id === player?.id ? 'bg-card2' : ''}`}>
                    <td className="py-1">{p.commonName ?? `${p.firstName} ${p.lastName}`}</td>
                    <td>{t(`pos.${mainPosition(p.positions)}`)}</td>
                    <td>{ageAt(p.birthDate, world.meta.startDate)}</td>
                    <td className="text-right">{p.ca}</td>
                    <td className="text-right">{p.pa}</td>
                    <td className="text-right">{money(p.marketValue)}</td>
                    <td className="text-right">{p.contract ? money(p.contract.wage) : '—'}</td>
                    <td className="pl-2">{p.estimated.length > 0 && <span title={t('summary.estimatedData')}><CircleHelp size={14} className="text-warn" /></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        {player && <PlayerCard player={player} world={world} />}
      </div>
    </div>
  );
}

function PlayerCard({ player, world }: { player: Player; world: WorldDatabase }) {
  const est = new Set(player.estimated);
  const groups: AttributeGroup[] = mainPosition(player.positions) === 'GK'
    ? ['goalkeeping', 'mental', 'physical', 'hidden']
    : ['technical', 'mental', 'physical', 'hidden'];
  const nations = player.nationalities.map((n) => world.nations.find((x) => x.id === n)?.name ?? n).join(', ');
  return (
    <Panel title="Ficha del jugador">
      <div className="mb-3">
        <div className="text-lg font-semibold">{player.firstName} {player.lastName}</div>
        <div className="text-xs text-muted">
          {player.positions.map((p) => `${t(`pos.${p.position}`)} ${p.rating}`).join(' · ')} — {nations} — {player.heightCm} cm, {player.weightKg} kg — pie {player.preferredFoot === 'left' ? 'izquierdo' : player.preferredFoot === 'right' ? 'derecho' : 'ambos'}
        </div>
        <div className="mt-1 text-xs text-muted">
          {t(`personality.${player.personality}`)} · CA {player.ca}{est.has('ca') ? '*' : ''} · PA {player.pa}{est.has('pa') ? '*' : ''} · origen: {player.source === 'imported' ? 'importado' : 'generado'}
        </div>
        {player.estimated.length > 0 && (
          <div className="mt-2 rounded bg-warn-bg px-2 py-1 text-xs text-warn">
            {est.has('generatedFill')
              ? 'Jugador ficticio añadido para completar la plantilla'
              : `${t('summary.estimatedData')}: ${player.estimated.filter((e) => !e.startsWith('attributes.')).join(', ') || '—'}`}
            {player.estimated.some((e) => e.startsWith('attributes.')) && ` · ${player.estimated.filter((e) => e.startsWith('attributes.')).length} atributos (marcados con *)`}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 text-xs font-semibold uppercase text-muted">{t(`attrGroup.${g}`)}</div>
            <table className="w-full text-xs">
              <tbody>
                {ATTRIBUTE_GROUPS[g].map((a) => (
                  <tr key={a}>
                    <td className="pr-2 text-soft">{t(`attr.${a}`)}</td>
                    <td className={`text-right font-semibold ${attrColor(player.attributes[a])}`}>
                      {player.attributes[a]}{est.has(`attributes.${a}`) ? <span className="text-warn">*</span> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Panel>
  );
}
