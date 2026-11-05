import { useState } from 'react';
import { t } from '../../i18n';
import { dataClient } from '../../store/dataClient';
import { useGame } from '../../store/gameStore';
import { Button, Panel, Stat } from '../components';

export function GenerateScreen() {
  const { world, setWorld, setScreen } = useGame();
  const [seed, setSeed] = useState(42);
  const [nations, setNations] = useState(8);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await dataClient.generate({ seed, nations });
      setWorld(r.world);
      setMs(r.ms);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!world) return;
    const blob = new Blob([JSON.stringify(world)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `banquillo-mundo-${world.meta.seed ?? 'importado'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const leagues = world?.competitions.filter((c) => c.format === 'league') ?? [];
  return (
    <div className="max-w-5xl">
      <Panel title={t('generator.title')}>
        <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t('generator.seed')}</span>
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="w-32 rounded bg-card2 px-2 py-1" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">{t('generator.nations')}</span>
            <input type="number" min={1} max={8} value={nations} onChange={(e) => setNations(Number(e.target.value))} className="w-20 rounded bg-card2 px-2 py-1" />
          </label>
          <Button type="submit" disabled={busy}>{busy ? t('generator.generating') : t('generator.generate')}</Button>
          {world && <Button variant="secondary" onClick={download}>{t('generator.download')}</Button>}
          {world && <Button variant="secondary" onClick={() => setScreen('browse')}>Explorar</Button>}
        </form>
        {ms !== null && <p className="mt-3 text-sm text-accent-text">{t('generator.done', { ms: Math.round(ms) })}</p>}
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </Panel>
      {world && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={t('summary.nations')} value={world.nations.length} />
            <Stat label={t('summary.competitions')} value={world.competitions.length} />
            <Stat label={t('summary.clubs')} value={world.clubs.length} />
            <Stat label={t('summary.players')} value={world.players.length.toLocaleString('es')} />
            <Stat label={t('summary.staff')} value={world.staff.length.toLocaleString('es')} />
          </div>
          <Panel title="Ligas">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr><th className="py-1">{t('summary.league')}</th><th>{t('summary.teams')}</th><th>{t('summary.topClub')}</th><th className="text-right">{t('summary.avgCa')}</th></tr>
              </thead>
              <tbody>
                {leagues.map((l) => {
                  const clubs = world.clubs.filter((c) => l.teamIds.includes(c.id));
                  const top = clubs.slice().sort((a, b) => b.reputation - a.reputation)[0];
                  const cas = world.players.filter((p) => p.clubId && l.teamIds.includes(p.clubId)).map((p) => p.ca).sort((a, b) => b - a);
                  const avg = cas.slice(0, l.teamIds.length * 11).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(cas.length, l.teamIds.length * 11));
                  return (
                    <tr key={l.id} className="border-t border-line">
                      <td className="py-1">{l.name}</td>
                      <td>{l.teamIds.length}</td>
                      <td>{top?.name}</td>
                      <td className="text-right">{avg.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
