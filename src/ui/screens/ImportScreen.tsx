import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ImportFile, ImportIssue, ImportResult } from '../../data/importers/importDatabase';
import type { VerifyReport } from '../../data/verify';
import { t } from '../../i18n';
import { dataClient } from '../../store/dataClient';
import { useGame } from '../../store/gameStore';
import { Button, Panel, Stat } from '../components';

const EXAMPLES = import.meta.glob('../../../data/examples/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const SEV_ICON = {
  error: <XCircle size={14} className="text-bad" />,
  warning: <AlertTriangle size={14} className="text-warn" />,
  info: <Info size={14} className="text-accent-text" />,
};

export function ImportScreen() {
  const { world, setWorld, setScreen } = useGame();
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [fill, setFill] = useState(true);
  const [merge, setMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ result: ImportResult; verify: VerifyReport; ms: number } | null>(null);
  const [filter, setFilter] = useState<'all' | ImportIssue['severity']>('all');
  const [error, setError] = useState<string | null>(null);

  const pickFiles = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all([...list].map(async (f) => ({ name: f.name, content: await f.text() })));
    setFiles(read);
    setResult(null);
  };
  const loadExample = () => {
    setFiles(Object.entries(EXAMPLES).map(([path, content]) => ({ name: path.split('/').pop() as string, content })));
    setResult(null);
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await dataClient.import(files, { fillSquads: fill, base: merge && world ? world : undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const issues = useMemo(() => (result?.result.issues ?? []).filter((i) => filter === 'all' || i.severity === filter), [result, filter]);
  const c = result?.result.counts;

  return (
    <div className="max-w-6xl">
      <Panel title={t('importer.title')}>
        <p className="mb-3 text-sm text-soft">{t('importer.intro')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded bg-line2 px-3 py-1.5 text-sm hover:bg-line2">
            {t('importer.pickFiles')}
            <input type="file" multiple accept=".csv,.json,.tsv,.txt" className="sr-only" onChange={(e) => void pickFiles(e.target.files)} />
          </label>
          <Button variant="secondary" onClick={loadExample}>{t('importer.loadExample')}</Button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> {t('importer.fillSquads')}
          </label>
          <label className={`flex items-center gap-2 text-sm ${world ? '' : 'opacity-40'}`}>
            <input type="checkbox" disabled={!world} checked={merge} onChange={(e) => setMerge(e.target.checked)} /> {t('importer.mergeWithGenerated')}
          </label>
          <Button onClick={() => void run()} disabled={busy || files.length === 0}>{busy ? t('importer.running') : t('importer.run')}</Button>
        </div>
        {files.length > 0 && <p className="mt-3 text-xs text-muted">{files.map((f) => f.name).join(' · ')}</p>}
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </Panel>

      {result && c && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label={t('summary.clubs')} value={`${c.club.imported} / ${c.club.read}`} />
            <Stat label={t('summary.players')} value={`${c.player.imported} / ${c.player.read}`} />
            <Stat label={t('summary.competitions')} value={`${c.competition.imported} / ${c.competition.read}`} />
            <Stat label="Desde estadísticas" value={result.result.playersFromStats} />
            <Stat label={t('importer.estimated')} value={result.result.playersEstimated} />
            <Stat label="Ficticios añadidos" value={result.result.generatedFill} />
          </div>
          <Panel
            title={`${t('importer.report')} · ${result.result.errorCount} ${t('importer.errors').toLowerCase()}, ${result.result.warningCount} ${t('importer.warnings').toLowerCase()}`}
            actions={
              <div className="flex gap-2">
                <select aria-label="Filtrar incidencias" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded bg-card2 px-2 py-1 text-xs">
                  <option value="all">Todas</option>
                  <option value="error">{t('severity.error')}</option>
                  <option value="warning">{t('severity.warning')}</option>
                  <option value="info">{t('severity.info')}</option>
                </select>
                <Button onClick={() => { setWorld(result.result.database); setScreen('browse'); }}>{t('importer.useDatabase')}</Button>
              </div>
            }
          >
            {issues.length === 0 ? (
              <p className="text-sm text-muted">{t('importer.noIssues')}</p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-left text-muted">
                    <tr><th /><th>{t('importer.file')}</th><th>{t('importer.row')}</th><th>{t('importer.entity')}</th><th>Id</th><th>{t('importer.field')}</th><th>{t('importer.message')}</th></tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 1000).map((i, k) => (
                      <tr key={k} className="border-t border-line">
                        <td className="py-1 pr-1">{SEV_ICON[i.severity]}</td>
                        <td className="pr-2">{i.file}</td>
                        <td className="pr-2">{i.row ?? '—'}</td>
                        <td className="pr-2">{t(`entity.${i.entity}`)}</td>
                        <td className="pr-2 font-mono">{i.id ?? '—'}</td>
                        <td className="pr-2">{i.field ?? '—'}</td>
                        <td>{i.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title={`Verificación · ${result.verify.errors.length} errores, ${result.verify.warnings.length} avisos`}>
            <ul className="max-h-60 overflow-auto text-xs text-soft">
              {[...result.verify.errors, ...result.verify.warnings].slice(0, 300).map((v, k) => (
                <li key={k}>{t(`entity.${v.entity}`)} {v.id} {v.field ? `(${v.field})` : ''}: {v.message}</li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
