// The pool-side and garden pieces together (SPEC 19). Stage 2's `SPACE_PIECES` (src/core/catalog-spaces.ts) takes `...OUTDOOR_PIECES` when the branches merge;
// until then catalog.ts and pieces.ts read it directly.
import { GARDEN_PIECES } from './catalog-garden';
import { POOL_PIECES } from './catalog-pool';

export const OUTDOOR_PIECES = [...POOL_PIECES, ...GARDEN_PIECES];
export const OUTDOOR_ROWS = OUTDOOR_PIECES.map((p) => p.row);
