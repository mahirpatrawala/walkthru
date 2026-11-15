// The seam between the walk (src/buyer/main.ts) and a building: what the walk is told when it opens a space of a building, and what it
// hands back so the building can sit on top of it (portals, the lift panel, the map). Types only, so main.ts imports nothing heavy.
import type { BuyerContext } from '../buyer/context';
import type { HudImpl } from '../buyer/hud';
import type { Doors } from '../buyer/doors';
import type { LoadingScreen } from '../buyer/loading';
import type { Look } from '../look/look';
import type { Grid, Layout, PropertyFile } from '../types';
import type { Viewer } from '../engine/viewer';

export interface Landing { x: number; z: number; yawDeg: number }

export interface SpaceHost {
  /** the building's id: the style the viewer picked is kept per building, not per scene */
  styleScope: string;
  /** where to stand (just inside the matching door), given the space's layout and walk grid; null: the scene's own start */
  arrival: ((layout: Layout, grid: Grid) => Landing | null) | null;
  /** false for every space after the first: no height picker, no first-visit hint */
  first: boolean;
  /** the time of day and colour mode carried over from the space before */
  carry: { hour?: number; trueColours?: boolean } | null;
  /** a bare building has none of the added decor by default */
  bare: boolean;
  /** replaces the sample tag under the room chip ("Sample building. Not a real home.") */
  tagText: string | null;
  /** the loading screen already showing, so the walk does not make a second one */
  loading: LoadingScreen;
  /** door opening id -> how its leaf looks (a heavy main door, a glass door, a lift door), set before the doors are built */
  doorLooks: ReadonlyMap<string, DoorStyle>;
  /** called when the space is ready to walk in, before the loading screen goes */
  onMounted(m: MountedSpace): void;
}

export type DoorStyleKind = 'main' | 'glass' | 'plain' | 'lift' | 'stairs';
export interface DoorStyle {
  kind: DoorStyleKind;
  /** the number on the plate of a main door, or the sign on a stairs door */
  text?: string;
  /** which face of the leaf carries the plate: 1 the room's own side, -1 the other side (the corridor, seen from a flat's own main door) */
  plateSide?: 1 | -1;
}

export interface MountedSpace {
  sceneId: string;
  property: PropertyFile;
  layout: Layout;
  ctx: BuyerContext;
  hud: HudImpl;
  viewer: Viewer;
  doors: Doors;
  look: Look | null;
  /** true while a sheet (height picker, rooms) is open */
  blocked(): boolean;
  /** a panel of the building's own is open: the walker stands still until it is closed */
  block(on: boolean): void;
  /** run when this space is taken down */
  onDispose(fn: () => void): void;
}

/** What `boot` hands back for a space in a building: take it down, completely. */
export interface SpaceSession {
  sceneId: string;
  dispose(): void;
  /** the look and style to carry to the next space */
  carry(): { hour?: number; trueColours?: boolean };
}
