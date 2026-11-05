import { useState } from 'react';
import { game } from '../../store/gameClient';
import { useGame } from '../../store/gameStore';
import { Button, Card, Toggle } from '../kit';

export function OptionsScreen() {
  const { fontScale, setFontScale } = useGame();
  const [autosave, setAutosave] = useState(true);
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card title="Accesibilidad" icon="eye">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-soft">Tamaño de letra</span>
          <Button size="sm" onClick={() => setFontScale(Math.max(0.8, Math.round((fontScale - 0.1) * 10) / 10))} aria-label="Reducir letra">A−</Button>
          <span className="num w-12 text-center font-semibold">{Math.round(fontScale * 100)} %</span>
          <Button size="sm" onClick={() => setFontScale(Math.min(1.5, Math.round((fontScale + 0.1) * 10) / 10))} aria-label="Aumentar letra">A+</Button>
        </div>
        <p className="mt-3 text-[13px] text-muted">Todo el juego se maneja con el teclado: Tab para moverte, Ctrl+K para buscar y Ctrl+Intro para continuar.</p>
      </Card>
      <Card title="Partida" icon="save">
        <Toggle label="Guardado automático tras cada partido" checked={autosave} onChange={(v) => { setAutosave(v); void game('setAutosave', { on: v }); }} />
      </Card>
      <Card title="Idioma" icon="globe"><p className="text-sm text-soft">Español. Los textos están en un archivo de traducción para añadir más idiomas.</p></Card>
    </div>
  );
}
