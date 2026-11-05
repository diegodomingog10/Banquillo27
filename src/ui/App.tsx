import { t } from '../i18n';
import { useGame, type Screen } from '../store/gameStore';
import { GameShell } from './game/GameShell';
import { Icon } from './icons';
import { BrowseScreen } from './screens/BrowseScreen';
import { GenerateScreen } from './screens/GenerateScreen';
import { ImportScreen } from './screens/ImportScreen';
import { MainMenu } from './screens/MainMenu';
import { NewGameScreen } from './screens/NewGameScreen';
import { OptionsScreen } from './screens/OptionsScreen';

const TITLES: Partial<Record<Screen, string>> = {
  newGame: t('menu.newGame'), import: t('menu.importDb'), generate: t('menu.generateWorld'), browse: 'Explorar base de datos', options: t('menu.options'),
};

export function App() {
  const { screen, setScreen, world, dashboard } = useGame();
  if (dashboard) return <GameShell />;
  if (screen === 'home') return <MainMenu />;
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b border-line bg-panel px-6 py-3">
        <button type="button" onClick={() => setScreen('home')} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-soft hover:bg-card2">
          <Icon name="chevronLeft" /> Menú principal
        </button>
        <div className="h-6 w-6 rounded-md bg-accent" aria-hidden="true" />
        <h1 className="font-display text-lg font-bold">{TITLES[screen]}</h1>
        <div className="flex-1" />
        {world && screen !== 'browse' && <button type="button" onClick={() => setScreen('browse')} className="text-sm text-accent-text hover:underline">Explorar la base cargada</button>}
      </header>
      <main className="mx-auto max-w-7xl p-6">
        {screen === 'newGame' && <NewGameScreen />}
        {screen === 'generate' && <GenerateScreen />}
        {screen === 'import' && <ImportScreen />}
        {screen === 'browse' && world && <BrowseScreen world={world} />}
        {screen === 'options' && <OptionsScreen />}
      </main>
    </div>
  );
}
