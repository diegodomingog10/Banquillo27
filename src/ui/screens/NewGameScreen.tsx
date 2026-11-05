import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Button, Panel, money } from '../components';

type Preview = Awaited<ReturnType<typeof game<'previewWorld'>>>;

export function NewGameScreen() {
  const { world, setDashboard, go } = useGame();
  const [source, setSource] = useState<'generated' | 'loaded'>(world ? 'loaded' : 'generated');
  const [seed, setSeed] = useState(42);
  const [nations, setNations] = useState(8);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [nationId, setNationId] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [clubId, setClubId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const worldParam = () => (source === 'loaded' && world ? world : { generate: { seed, nations } });

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await game('previewWorld', { world: worldParam() });
      setPreview(p);
      setNationId(p.nations[0]?.id ?? '');
      setLeagueId('');
      setClubId('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void loadPreview(); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const leagues = preview?.leagues.filter((l) => l.nationId === nationId).sort((a, b) => a.level - b.level) ?? [];
  const league = leagues.find((l) => l.id === leagueId) ?? leagues[0];
  const club = league?.clubs.find((c) => c.id === clubId);

  const start = async () => {
    if (!club || !firstName.trim() || !lastName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await game('newGame', {
        world: worldParam(), userClubId: club.id, seed: seed * 7919 + 1,
        manager: { firstName: firstName.trim(), lastName: lastName.trim(), nationality: nationId || null },
      });
      go('inbox', { messageId: null });
      setDashboard(d);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <Panel title="1 · Base de datos">
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={source === 'generated'} onChange={() => setSource('generated')} /> Mundo ficticio generado</label>
          <label className={`flex items-center gap-2 ${world ? '' : 'opacity-40'}`}><input type="radio" disabled={!world} checked={source === 'loaded'} onChange={() => setSource('loaded')} /> Base cargada {world ? `(${world.meta.name})` : '(importa una primero)'}</label>
          {source === 'generated' && (
            <>
              <label><span className="mb-1 block text-muted">Semilla</span><input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="w-28 rounded bg-card2 px-2 py-1" /></label>
              <label><span className="mb-1 block text-muted">Naciones</span><input type="number" min={1} max={8} value={nations} onChange={(e) => setNations(Number(e.target.value))} className="w-20 rounded bg-card2 px-2 py-1" /></label>
              <Button variant="secondary" onClick={() => void loadPreview()} disabled={busy}>Generar</Button>
            </>
          )}
        </div>
      </Panel>
      {preview && (
        <Panel title="2 · Elige club">
          <div className="mb-3 flex flex-wrap gap-3 text-sm">
            <select aria-label="País" value={nationId} onChange={(e) => { setNationId(e.target.value); setLeagueId(''); setClubId(''); }} className="rounded bg-card2 px-2 py-1">
              {preview.nations.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <select aria-label="Liga" value={league?.id ?? ''} onChange={(e) => { setLeagueId(e.target.value); setClubId(''); }} className="rounded bg-card2 px-2 py-1">
              {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="grid max-h-80 grid-cols-2 gap-1 overflow-auto md:grid-cols-3">
            {league?.clubs.map((c) => (
              <button key={c.id} type="button" onClick={() => setClubId(c.id)}
                className={`rounded px-3 py-2 text-left text-sm ${c.id === clubId ? 'bg-accent-bg ring-1 ring-accent' : 'bg-card2 hover:bg-line2'}`}>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted">Reputación {c.reputation} · fichajes {money(c.budget)}</div>
              </button>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="3 · Perfil del entrenador">
        <form className="flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <label><span className="mb-1 block text-muted">Nombre</span><input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className="rounded bg-card2 px-2 py-1" /></label>
          <label><span className="mb-1 block text-muted">Apellido</span><input required value={lastName} onChange={(e) => setLastName(e.target.value)} className="rounded bg-card2 px-2 py-1" /></label>
          <Button type="submit" disabled={busy || !club || !firstName.trim() || !lastName.trim()}>{busy ? 'Preparando…' : `Empezar con ${club?.name ?? '…'}`}</Button>
        </form>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </Panel>
    </div>
  );
}
