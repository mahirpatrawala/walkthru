// "Lived-in" mode: an optional layer of everyday Indian-home decor (cushions, a rug, a pressure cooker on the counter, curtains, a
// pooja shelf, shoes by the door ...) so an empty flat reads as a home. SPEC 16.2 rule 4 applies: it is decoration, it is labelled,
// and it never touches a measurement. The decor lives under the furniture root so shadows, the painterly mode and the look's tier
// follow it, but it is NOT in the walking grid and none of its meshes can be hit by a ray (build.ts), so collision, clearance,
// fit checks and the measure tool cannot see it. Nothing is planned or built until the mode is first switched on.
import * as THREE from 'three';
import type { FurnitureItem, Grid, Layout } from '../../types';
import type { Tier } from '../types';
import { buildDecorGroup } from './build';
import type { BuiltDecor } from './build';
import { boxesOverlap, pieceBox, planLivedIn } from './plan';
import type { DecorPiece } from './plan';

export { planLivedIn, pieceBox } from './plan';
export type { DecorPiece, DecorKind } from './plan';

/** The fixed label (SPEC 16.2 rule 4): shown beside the switch and, while the mode is on, in the rooms sheet. */
export const LIVED_IN_LABEL = 'Decor added to show a lived-in home. Not from your drawing.';
export const LIVED_IN_KEY = 'walkthru:livedIn';

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The remembered choice of this viewer, or null when they have not chosen. Never throws. */
export function readLivedIn(storage: StorageLike | null): boolean | null {
  try {
    const v = storage?.getItem(LIVED_IN_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}
export function writeLivedIn(storage: StorageLike | null, on: boolean): void {
  try { storage?.setItem(LIVED_IN_KEY, on ? '1' : '0'); } catch { /* private mode: the choice just is not remembered */ }
}
/** What a visit starts with: the viewer's own choice if they made one, else the home's default (on for made-up sample homes). */
export function initialLivedIn(storage: StorageLike | null, defaultOn: boolean): boolean {
  return readLivedIn(storage) ?? defaultOn;
}

export interface LivedInStore {
  all(): FurnitureItem[];
  /** the walking grid with these ids left out */
  gridWithout(ids: string[]): Grid;
  onChange(cb: () => void): () => void;
}

export interface LivedInOpts {
  /** where the decor group goes: the furniture root, so shadows and the painterly mode follow it */
  parent: THREE.Object3D;
  layout: Layout;
  store: LivedInStore;
  storage: StorageLike | null;
  /** on for made-up sample homes, off for a real drawing until the buyer taps it */
  defaultOn: boolean;
  tier?: Tier;
}

export interface LivedIn {
  readonly enabled: boolean;
  /** how many pieces this home gets (plans on first use) */
  count(): number;
  pieces(): DecorPiece[];
  setEnabled(on: boolean, remember?: boolean): void;
  /** hide the decor without changing the switch (a scan is on show, an AI photo is being taken) */
  setSuppressed(on: boolean): void;
  onChange(cb: (enabled: boolean) => void): () => void;
  /** the decor group, or null until first switched on */
  group(): THREE.Object3D | null;
  dispose(): void;
}

export function createLivedIn(opts: LivedInOpts): LivedIn {
  let enabled = initialLivedIn(opts.storage, opts.defaultOn);
  let suppressed = false;
  let planned: DecorPiece[] | null = null;
  let built: BuiltDecor | null = null;
  const listeners = new Set<(on: boolean) => void>();

  const plan = (): DecorPiece[] => {
    if (planned) return planned;
    const all = opts.store.all();
    const real = all.filter((i) => i.source === 'real');
    // the grid without the buyer's own placed furniture: decor goes where the HOME is free, not where a trial bed happens to be
    const grid = opts.store.gridWithout(all.filter((i) => i.source !== 'real').map((i) => i.id));
    try {
      planned = planLivedIn({ layout: opts.layout, items: real, grid });
    } catch (err) {
      console.warn('[walkthru] lived-in decor could not be planned:', err);
      planned = [];
    }
    return planned;
  };

  const apply = (): void => {
    if (enabled && !built && plan().length > 0) {
      built = buildDecorGroup(plan(), opts.tier ?? 'medium');
      opts.parent.add(built.group);
      reconcile();
    }
    if (built) built.group.visible = enabled && !suppressed;
  };

  /** a piece the buyer has since put furniture over is hidden, not moved (nothing about the home changes) */
  const reconcile = (): void => {
    if (!built) return;
    const virtual = opts.store.all().filter((i) => i.source !== 'real');
    for (const p of plan()) {
      const g = built.byId.get(p.id);
      if (!g || p.place === 'surface') continue;
      const box = pieceBox(p);
      g.visible = !virtual.some((v) => (p.place !== 'wall' || v.heightM > p.y - 0.05) && boxesOverlap(box, v.box, 0.05));
    }
  };
  const offStore = opts.store.onChange(() => { if (built && enabled) reconcile(); });

  apply();
  return {
    get enabled() { return enabled; },
    count: () => plan().length,
    pieces: () => plan(),
    setEnabled(on, remember = true) {
      if (on === enabled) return;
      enabled = on;
      if (remember) writeLivedIn(opts.storage, on);
      apply();
      for (const cb of [...listeners]) cb(enabled);
    },
    setSuppressed(on) { suppressed = on; apply(); },
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    group: () => built?.group ?? null,
    dispose() { offStore(); built?.dispose(); built = null; listeners.clear(); },
  };
}

// ---------------------------------------------------------------- the one control

export interface RoomsNote { setDecorNote(text: string | null): void }

/**
 * Adds the "Lived-in" switch to the look sheet (a single row, inserted before its illustrative labels), and keeps the rooms sheet's
 * note in step. Returns a remover. Safe when there is no look sheet (the look could not start): the mode then just keeps its default.
 */
export function mountLivedInToggle(hudRoot: HTMLElement, lived: LivedIn, rooms?: RoomsNote | null): () => void {
  const sheet = hudRoot.querySelector<HTMLElement>('.wt-look-sheet');
  const sync = (): void => { rooms?.setDecorNote(lived.enabled ? LIVED_IN_LABEL : null); };
  sync();
  const off = lived.onChange(sync);
  if (!sheet) return () => { off(); };

  const row = document.createElement('label');
  row.className = 'wt-look-switch wt-lived-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.dataset.testid = 'look-lived-in';
  const text = document.createElement('span');
  const b = document.createElement('b');
  b.textContent = 'Lived-in';
  const small = document.createElement('small');
  small.textContent = lived.count() > 0 ? LIVED_IN_LABEL : 'Nothing to add in this home.';
  small.dataset.testid = 'look-label-decor';
  text.append(b, small);
  row.append(input, text);
  input.checked = lived.enabled;
  input.disabled = lived.count() === 0;
  input.addEventListener('change', () => { lived.setEnabled(input.checked); });
  const offSync = lived.onChange((on) => { input.checked = on; });
  // right under "True colours" (both are looks of the home), else before the illustrative labels, else at the end
  const trueColours = sheet.querySelector('[data-testid="look-true-colours"]')?.closest('label');
  const labels = sheet.querySelector('.wt-look-labels');
  if (trueColours?.parentElement === sheet) trueColours.after(row);
  else if (labels) sheet.insertBefore(row, labels);
  else sheet.appendChild(row);
  return () => { off(); offSync(); row.remove(); };
}
