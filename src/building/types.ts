// A building (SPEC 18): a list of levels, each with spaces. A space is an ordinary scene (public/scenes/<sceneId>/property.json) with a
// kind and a name; portals join a door opening in one space to a door opening in another, or a lift door to the levels the lift serves.
// Pure data and rules: no DOM, no three.

// the kind of place, as the scene itself carries it (`PropertyFile.spaceKind`, src/types.ts): a flat is a `home`
import type { SpaceKind } from '../types';
export type { SpaceKind };
export const SPACE_KINDS: readonly SpaceKind[] = ['home', 'lobby', 'corridor', 'gym', 'hall', 'pool', 'garden', 'other'];

/** Where a space's own scene frame sits on its level's plan: turned about the scene origin (clockwise on the plan), then moved. */
export interface Placement { x: number; z: number; rotDeg: 0 | 90 | 180 | 270 }

/** How a portal door looks: a heavy flat main door with a number plate, a glass lobby door, or an ordinary leaf. */
export type DoorLook = 'main' | 'glass' | 'plain' | 'lift' | 'stairs';

export type Portal =
  | { id: string; kind: 'door'; /** the door opening (id in this space's scene) */ opening: string; to: { space: string; portal: string }; label: string; look?: DoorLook; /** the words on the prompt: "Enter Flat 302" */ prompt?: string; /** shown on the number plate */ plate?: string }
  | { id: string; kind: 'lift'; opening: string; lift: string; label?: string }
  | { id: string; kind: 'stairs'; opening: string; label?: string }
  /** a door to the street or anywhere the sample does not model: it says so */
  | { id: string; kind: 'outside'; opening: string; label: string; look?: DoorLook; prompt?: string };

export interface Space {
  /** unique in the building; the `space=` of the URL. Equals the scene id unless one scene is used by several spaces. */
  id: string;
  kind: SpaceKind;
  /** "Flat 302 · 2 BHK" */
  name: string;
  /** public/scenes/<sceneId>/ */
  sceneId: string;
  /** flat spaces: the design this is an instance of (a key of `flatTypes`) */
  type?: string;
  /** the scene is the design's mirror image (generated at build time) */
  mirrored?: boolean;
  placement: Placement;
  portals: Portal[];
  /** a placeholder for a later stage: enterable as an empty room, labelled on the map */
  comingNext?: boolean;
  notes?: string[];
  /** a space under the sky (no ceiling): read and handed to the walk, not drawn that way yet (SPEC 18.9) */
  outdoor?: boolean;
  /** the style pack this space opens in, unless the viewer has picked one (src/look/packs ids) */
  pack?: string;
}

export interface Level {
  id: string;
  /** "Ground", "Level 2" */
  label: string;
  /** the lift button: "G", "1", "2" */
  short: string;
  /** what is on this level, for the lift panel: "Flats 201–204" */
  summary: string;
  /** floor to floor height of this level, metres; falls back to the building's */
  floorToFloorM?: number;
  spaces: Space[];
}

export interface FlatType {
  name: string;
  /** the design scene */
  sceneId: string;
  /** its mirror image, when a plan needed one */
  mirrorSceneId?: string;
}

export interface Lift {
  id: string;
  name: string;
  /** the car, metres; the door of the car equals the lift door opening in the lobby */
  car: { widthM: number; depthM: number; doorM: number };
  /** level ids it stops at */
  serves: string[];
}

export interface BuildingFile {
  version: 1;
  id: string;
  name: string;
  subtitle?: string;
  /** made up for the demonstration: says so wherever it is shown */
  sample: boolean;
  /** one line shown on the map: "Sample layout for demonstration" */
  note: string;
  floorToFloorM: number;
  flatTypes: Record<string, FlatType>;
  lifts: Lift[];
  /** lowest first */
  levels: Level[];
  /** the space the entry page starts in (default: the first space of the first level) */
  startSpace?: string;
  /** true keeps it out of the start page's list: it opens by its link */
  unlisted?: boolean;
  /** a bare building: no added decor in any space (a builder starting from nothing) */
  bare?: boolean;
}

/** The slim entry the start page lists (public/buildings/index.json). */
export interface BuildingIndexEntry {
  id: string;
  name: string;
  subtitle?: string;
  sample: boolean;
  levels: number;
  flats: number;
  /** flat type name -> how many */
  flatTypes: { name: string; count: number }[];
  amenities: string[];
}
export interface BuildingIndex { version: 1; buildings: BuildingIndexEntry[] }
