import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '../src/data/schema';
import { commentary, type NarrationContext } from '../src/engine/commentary';
import { NARRATOR_IDS, narratorFor, NEUTRAL, phrases } from '../src/engine/narrators';

const n = { player: (id: string | null) => (id ? `J${id}` : ''), team: (id: string | null) => (id === 'h' ? 'Local' : id === 'a' ? 'Visitante' : '') };
const ev = (e: Partial<MatchEvent>): MatchEvent => ({ minute: 10, type: 'goal', teamId: 'h', playerId: '1', otherPlayerId: null, detail: 'shot:open', ...e } as MatchEvent);

describe('narradores', () => {
  it('cada partido tiene un narrador al azar y reproducible; salen los tres', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => narratorFor(i * 7919)));
    expect(seen.size).toBe(3);
    expect(narratorFor(42)).toBe(narratorFor(42));
  });
  it('todos los narradores tienen frase para cada momento (propia o neutra)', () => {
    for (const id of NARRATOR_IDS) for (const m of Object.keys(NEUTRAL) as (keyof typeof NEUTRAL)[]) expect(phrases(id, m).length).toBeGreaterThan(0);
  });
  it('lleva el marcador y usa frases de contexto sin marcadores sin rellenar', () => {
    for (const narrator of NARRATOR_IDS) {
      const ctx: NarrationContext = { narrator, homeId: 'h', awayId: 'a', score: [0, 0] };
      const lines = commentary([
        ev({ type: 'kickOff', minute: 0, teamId: null, playerId: null, detail: null }),
        ev({ minute: 20 }), ev({ minute: 50, teamId: 'a', playerId: '2' }), ev({ minute: 89, playerId: '3' }),
        ev({ type: 'save', teamId: 'a', playerId: '4', otherPlayerId: '5' }), ev({ type: 'yellow', playerId: '6', detail: null }),
        ev({ type: 'fullTime', minute: 90, teamId: null, playerId: null, detail: null }),
      ], n, 0, ctx);
      expect(ctx.score).toEqual([2, 1]);
      for (const l of lines) { expect(l.text).not.toMatch(/\{|\}|undefined|\s[,.!]/); }
      expect(lines.at(-1)!.text).toContain('Local 2, Visitante 1');
    }
  });
});
