// Extension points for the next stages (SPEC 18.9). Stage 1 only declares them; nothing in the walk reads them yet except where noted.
//   - which space the walker is in and what kind it is (`getSpaceContext`), so Furnish, the catalogue and the look can ask
//   - which catalogue pieces a kind of space allows (`catalogueAllowedIn`): the default allows everything, a later stage installs a filter
//   - per-space `outdoor` (no ceiling, sky) and `pack` (the style pack a space opens in) are fields of the space in building.json;
//     they are read here and handed to the walk in `SpaceHost.space`. `pack` is applied (the viewer's own pick still wins); `outdoor` is not.
import type { FurnitureKind, SpaceKind } from '../types';
import type { Space } from './types';

export interface SpaceContext {
  buildingId: string;
  spaceId: string;
  kind: SpaceKind;
  outdoor: boolean;
  pack: string | null;
}

let current: SpaceContext | null = null;
export const setSpaceContext = (c: SpaceContext | null): void => { current = c; };
/** The space the walker is in, or null when the walk is not in a building. */
export const getSpaceContext = (): SpaceContext | null => current;

export const contextOf = (buildingId: string, s: Space): SpaceContext => ({ buildingId, spaceId: s.id, kind: s.kind, outdoor: s.outdoor === true, pack: s.pack ?? null });

export type CatalogueFilter = (spaceKind: SpaceKind, item: { id: string; kind: FurnitureKind }) => boolean;
let filter: CatalogueFilter = () => true;
/** Installs the rule for which pieces a kind of space allows (a gym takes equipment, not beds). The default allows every piece anywhere. */
let installed = false;
export const setCatalogueFilter = (f: CatalogueFilter | null): void => { filter = f ?? (() => true); installed = f !== null; };
/** debug: is a rule installed (it is while a space of a building is up, and gone when it is torn down) */
export const catalogueFilterInstalled = (): boolean => installed;
/** Is this catalogue piece allowed where the walker is? Outside a building every piece is. */
export function catalogueAllowedIn(item: { id: string; kind: FurnitureKind }, kind: SpaceKind | null = current?.kind ?? null): boolean {
  return kind === null ? true : filter(kind, item);
}
