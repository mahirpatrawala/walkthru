// The catalogue rows of the shared spaces of a building: gym equipment (catalog-gym.ts), the lobby (catalog-lobby.ts) and the hall
// (catalog-hall.ts), and the table that lets a few home pieces (a sofa, a planter, a dining table) also be offered in a lobby or a hall.
// Types only come from pieces.ts, so this file and pieces.ts do not need each other when they load.
import type { SpaceKind } from '../types';
import type { MorePiece } from './catalog-more';
import { GYM_PIECES } from './catalog-gym';
import { LOBBY_PIECES } from './catalog-lobby';
import { HALL_PIECES } from './catalog-hall';
import { POOL_PIECES } from './catalog-pool';
import { GARDEN_PIECES } from './catalog-garden';

export const SPACE_PIECES: MorePiece[] = [...GYM_PIECES, ...LOBBY_PIECES, ...HALL_PIECES, ...POOL_PIECES, ...GARDEN_PIECES];
export const SPACE_ROWS = SPACE_PIECES.map((p) => p.row);

/**
 * Home pieces that also belong in a shared space. Everything else of the original and second tables is a home piece only. Chairs and
 * tables go to the hall, sofas, side tables and planters to the lobby; a yoga mat is as good in a studio as in a bedroom.
 */
export const EXTRA_PLACES: Record<string, SpaceKind[]> = {
  'sofa-3': ['lobby', 'hall', 'games'], 'sofa-2': ['lobby', 'hall', 'games'], 'sofa-l': ['lobby'], armchair: ['lobby', 'hall', 'corridor', 'games'],
  'side-table': ['lobby', 'hall', 'corridor', 'games'], 'coffee-rect': ['lobby', 'hall'], 'coffee-round': ['lobby', 'hall', 'games'],
  'planter-pot': ['lobby', 'hall', 'corridor', 'pool', 'garden', 'games'], 'planter-box': ['lobby', 'hall', 'corridor', 'pool', 'garden', 'games'],
  'balcony-chair': ['pool', 'garden'], 'balcony-set': ['pool', 'garden'],
  sideboard: ['lobby', 'hall'], 'office-chair': ['lobby'], 'bar-stool': ['lobby', 'hall'],
  'dining-4': ['hall'], 'dining-6': ['hall'], 'dining-8': ['hall'], 'dining-round-4': ['hall'],
  'yoga-mat': ['gym'], 'bookshelf-wide': ['lobby'],
};
