// SPEC 16.13: what the look controller (look.ts) needs from a mounted bake, and nothing else. Types only, so look.ts never imports the loader.
import type { Grid } from '../../types';
import type { AoField } from '../floor-ao';
import type { Grade } from '../grade';
import type { TierConfig } from '../quality';

export interface BakedUpdate {
  grade: Grade;
  hour: number;
  cfg: TierConfig;
  /** True colours, a scan shown, or the plain look: the bake steps back and the surfaces are lit exactly as before it existed */
  off: boolean;
}

export interface BakedHook {
  /** the bake is applied right now (loaded, and not stepped back) */
  readonly active: boolean;
  update(u: BakedUpdate): void;
  /** the soft contact shadow of movable pieces on the floor: furniture only, because the walls are already in the bake */
  contactField(grid: Grid): AoField;
  dispose(): void;
}
