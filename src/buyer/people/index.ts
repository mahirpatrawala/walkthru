// One mount call for the buyer page: the people a viewer adds to a home (SPEC 2.1, 16.6.9). main.ts creates this once the walker, the
// furniture store, the seats and the HUD exist, and then only asks it four things: an "Add a person" line for the walker's sheet,
// the taps of the canvas, the walk grid with followers on it, and an update per frame.
import type { BuyerContext, ModeManager } from '../context';
import type { HudImpl } from '../hud';
import type { Seats } from '../seats';
import type { FurnitureStoreImpl, StorageLike } from '../store';
import { swingNoteFor } from '../wardrobe-hooks';
import { createPeople } from './manager';
import type { People, WalkerPort } from './manager';
import type { DeviceTier } from './model';
import { createPeopleUi } from './ui';
import type { PeopleUi } from './ui';

export interface MountPeopleDeps {
  ctx: BuyerContext;
  hud: HudImpl;
  store: FurnitureStoreImpl;
  seats: Seats;
  modes: ModeManager;
  storage: StorageLike | null;
  sceneId: string;
  /** the `?my=` code this visit opened, if any (read before main.ts takes it off the address) */
  shareCode: string | null;
  tier: () => DeviceTier;
  walker: WalkerPort;
  surfaceProbe: (x: number, z: number) => number | null;
  /** the walk grid with the door frame posts added, for the drawn bodies (SPEC 4.12) */
  bodyGrid?: (walk: import('../../types').Grid) => import('../../types').Grid;
  /** bodies came or went (the baked lighting probes them) */
  onBodies?: () => void;
  /** another sheet is open (the walker's own picker, the rooms sheet) */
  otherBlocking: () => boolean;
}

export interface MountedPeople {
  people: People;
  ui: PeopleUi;
}

export function mountPeople(d: MountPeopleDeps): MountedPeople {
  const people = createPeople({
    scene: d.ctx.viewer.scene, camera: d.ctx.viewer.camera, store: d.store, seats: d.seats, walker: d.walker,
    sceneId: d.sceneId, storage: d.storage, tier: d.tier, toast: (t) => d.hud.toast(t),
    swingNote: (box) => swingNoteFor(box),
    passCard: (c) => { if (c) d.ctx.hud.showCard(c); else d.ctx.hud.hideCard(); },
    onBodies: d.onBodies, surfaceProbe: d.surfaceProbe, bodyGrid: d.bodyGrid,
  });
  const ui = createPeopleUi({ ctx: d.ctx, hud: d.hud, people, walker: d.walker, parent: document.body, otherBlocking: d.otherBlocking });
  d.modes.onChange((id) => {
    people.setFurnishing(id === 'furnish');
    if (id !== 'walk') ui.cancel();
  });
  return { people, ui };
}
