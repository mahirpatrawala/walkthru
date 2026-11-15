// Owned by furnish-edit. The "Your layout · edited" chip: on screen in every mode while this viewer's layout differs from the home as drawn
// (SPEC 16.2: nothing about the home may be changed without saying so). Tap it to open furnish mode, where "Reset to the home as drawn" lives.
// Also: decor and seats tied to a piece that is hidden in this layout go with it.
import type * as THREE from 'three';
import { EDITED_CHIP } from './my-layout';

export interface ChipStore { isEdited(): boolean; onChange(cb: () => void): () => void }

/** Mounts the chip into the HUD's top-centre column. Returns the remover. */
export function mountLayoutChip(hudRoot: HTMLElement, store: ChipStore, onOpen: () => void): () => void {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'wt-layout-chip';
  chip.dataset.testid = 'layout-chip';
  chip.dataset.ui = '1';
  chip.textContent = EDITED_CHIP;
  chip.title = 'Your layout differs from the home as drawn. Tap to see or reset it.';
  chip.hidden = true;
  chip.addEventListener('click', (e) => { e.stopPropagation(); onOpen(); });
  (hudRoot.querySelector<HTMLElement>('.wt-top') ?? hudRoot).appendChild(chip);
  const sync = (): void => { chip.hidden = !store.isEdited(); };
  sync();
  const off = store.onChange(sync);
  return () => { off(); chip.remove(); };
}

export interface HostedStore {
  all(): Array<{ id: string }>;
  onChange(cb: () => void): () => void;
  setTemporary(key: string, o: { box: import('../types').Box; heightM: number }[]): void;
  /** the viewer's removed, moved and resized fittings (the drawing's chairs are among them) */
  fittings?(): import('../look/fittings').FittingsOverlay;
}
export interface HostedSeats {
  setHostsPresent(p: ReadonlySet<string>): void;
  liveIds(): string[];
  obstacles(): { box: import('../types').Box; heightM: number }[];
  /** optional: chairs that follow the piece they stand at and obey the viewer's overlay */
  syncHosts?(items: readonly import('../types').FurnitureItem[]): void;
  setOverlay?(o: import('../look/fittings').FittingsOverlay | null): void;
  poseOf?(decorId: string): { x: number; z: number; yawDeg: number } | null;
  isRemoved?(decorId: string): boolean;
  stateKey?(): string;
  records?(): import('../look/fittings').FittingRecord[];
}
export interface HostedDecor { id?: string; hostId: string; group: THREE.Object3D; place?(at: { x: number; z: number; yawDeg: number }): void }

/**
 * Decor tied to a piece (a drawing's study chair at its desk) exists only while that piece does. A seat whose piece is hidden
 * stops being a seat and stops blocking the walking grid; the decor chair is not drawn. A chair also follows its piece when My layout
 * moves or resizes it, stands where the viewer put it, and is gone when the viewer removed it. Returns the remover.
 */
export function syncHosted(store: HostedStore, decor: HostedDecor[], seats: HostedSeats, onRecords?: (r: import('../look/fittings').FittingRecord[]) => void): () => void {
  let seatKey = `${seats.liveIds().join('|')}#${seats.stateKey?.() ?? ''}`;
  const sync = (): void => {
    const items = store.all();
    const present = new Set(items.map((i) => i.id));
    seats.setOverlay?.(store.fittings?.() ?? null);
    if (seats.syncHosts) seats.syncHosts(items as import('../types').FurnitureItem[]); else seats.setHostsPresent(present);
    for (const d of decor) {
      const gone = (d.id !== undefined && seats.isRemoved?.(d.id)) ?? false;
      d.group.visible = present.has(d.hostId) && !gone;
      const at = d.id !== undefined ? seats.poseOf?.(d.id) : null;
      if (at && d.place) d.place(at);
    }
    const key = `${seats.liveIds().join('|')}#${seats.stateKey?.() ?? ''}`;
    if (key !== seatKey) { seatKey = key; store.setTemporary('seats', seats.obstacles()); }
    onRecords?.(seats.records?.() ?? []);
  };
  sync();
  return store.onChange(sync);
}
