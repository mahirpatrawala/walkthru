// The seam between the walk (src/buyer/main.ts) and a building: what the walk is told when it opens a space of a building, and what it
// hands back so the building can sit on top of it (portals, the lift panel, the map). Types only, so main.ts imports nothing heavy.
import type { BuyerContext } from '../buyer/context';
import type { HudImpl } from '../buyer/hud';
import type { Doors } from '../buyer/doors';
import type { LoadingScreen } from '../buyer/loading';
import type { Look } from '../look/look';
import type { Grid, Layout, PropertyFile } from '../types';
import type { Viewer } from '../engine/viewer';
import type { People, PersonSpec } from '../buyer/people/manager';
import type { PointerEvt } from '../engine/controls';

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
  /** which space this is (SPEC 18.9): its kind, whether it is outdoors, the style pack it opens in */
  space: { id: string; kind: string; outdoor: boolean; pack: string | null };
  /** the first line of the identity card: the building and the level ("Sample Tower, Level 2") */
  placeText: string | null;
  /** the level's label ("Level 2"): the identity card's second line begins with it */
  levelText?: string | null;
  /** the builder's brand on this building, for the identity card */
  brand?: import('../brand/builder-brand').ShownBrand | null;
  /** which way north lies in THIS scene (the building's north turned by the space's placement, SPEC 22.1), or null/absent when the building does not know */
  north?: import('../core/north').NorthRef | null;
  /** the building is a sample: its orientation is a demonstration value and the facing sheet says so */
  sample?: boolean;
  /** whether the building's Vastu checklist is switched on (its inventory setting, SPEC 22.3); never resolves to true when the service is unreachable */
  vastu?: (() => Promise<boolean>) | null;
  /** the quiet third line of the identity card ("Sample building. Plan follows a published brochure."), or null for none */
  tagText: string | null;
  /** the loading screen already showing, so the walk does not make a second one */
  loading: LoadingScreen;
  /** door opening id -> how its leaf looks (a heavy main door, a glass door, a lift door), set before the doors are built */
  doorLooks: ReadonlyMap<string, DoorStyle>;
  /** Asked first by the walk's tap-to-select: true when the tap was a portal's (a door or the lift), which the building then used. Set by the building once the space is up. */
  tapClaim: ((e: PointerEvt) => boolean) | null;
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
  /** the people a buyer added to this space (src/buyer/people) */
  people: People;
}

/** What `boot` hands back for a space in a building: take it down, completely. */
export interface SpaceSession {
  sceneId: string;
  dispose(): void;
  /** the look and style to carry to the next space */
  carry(): { hour?: number; trueColours?: boolean };
  /** the added people who are following the walker: taken out of this space's layout, to be set down beside the walker in the next */
  takeFollowers(): PersonSpec[];
}
