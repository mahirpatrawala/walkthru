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

export interface HostedStore { all(): Array<{ id: string }>; onChange(cb: () => void): () => void; setTemporary(key: string, o: { box: import('../types').Box; heightM: number }[]): void }
export interface HostedSeats { setHostsPresent(p: ReadonlySet<string>): void; liveIds(): string[]; obstacles(): { box: import('../types').Box; heightM: number }[] }
export interface HostedDecor { hostId: string; group: THREE.Object3D }

/**
 * Decor tied to a piece (a drawing's study chair at its desk) exists only while that piece does. A seat whose piece is hidden
 * stops being a seat and stops blocking the walking grid; the decor chair is not drawn. Returns the remover.
 */
export function syncHosted(store: HostedStore, decor: HostedDecor[], seats: HostedSeats): () => void {
  let seatKey = seats.liveIds().join('|');
  const sync = (): void => {
    const present = new Set(store.all().map((i) => i.id));
    for (const d of decor) d.group.visible = present.has(d.hostId);
    seats.setHostsPresent(present);
    const key = seats.liveIds().join('|');
    if (key !== seatKey) { seatKey = key; store.setTemporary('seats', seats.obstacles()); }
  };
  sync();
  return store.onChange(sync);
}
