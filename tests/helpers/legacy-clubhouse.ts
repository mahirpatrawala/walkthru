// The stage-3 sample pool area and garden (scripts/building/outdoor-spaces.ts), built in memory beside a stand-in foyer. The Sample Tower no longer uses them (its clubhouse
// level follows a brochure plan, scripts/building/podium-level.ts), but the generators stay for other buildings and their numbers stay tested.
import type { PropertyFile } from '../../src/types';
import type { OutdoorFile } from '../../src/outdoor/types';
import { rectRoom } from '../../scripts/building/scene-kit';
import { doorPair } from '../../scripts/building/spaces';
import { GARDEN_DOOR_AT, POOL_DOOR_AT, gardenOutdoor, gardenProperty, gardenRoom, poolOutdoor, poolProperty, poolRoom } from '../../scripts/building/outdoor-spaces';

export type LegacyKey = 'pool' | 'garden' | 'poolBare' | 'gardenBare';
export interface Legacy { scene: Record<LegacyKey, PropertyFile>; outdoor: Record<LegacyKey, OutdoorFile> }

export function legacyClubhouse(): Legacy {
  const foyer = rectRoom('foyer', 'Clubhouse foyer', 'other', { x0: 0, z0: 0, x1: 12, z1: 6 });
  const pool = doorPair({ room: foyer, side: 'E', at: POOL_DOOR_AT, id: 'door-pool' }, { room: poolRoom(), id: 'door-foyer' }, 1.2);
  const garden = doorPair({ room: foyer, side: 'S', at: GARDEN_DOOR_AT, id: 'door-garden' }, { room: gardenRoom(), id: 'door-foyer' }, 1.2);
  const p = poolProperty('legacy-pool', pool.b, false), pb = poolProperty('legacy-pool-bare', pool.b, true);
  const g = gardenProperty('legacy-garden', garden.b, false), gb = gardenProperty('legacy-garden-bare', garden.b, true);
  return { scene: { pool: p.property, garden: g.property, poolBare: pb.property, gardenBare: gb.property }, outdoor: { pool: p.outdoor, garden: g.outdoor, poolBare: pb.outdoor, gardenBare: gb.outdoor } };
}
void gardenOutdoor; void poolOutdoor;
