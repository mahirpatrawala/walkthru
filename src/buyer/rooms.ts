// Owned by C3. The rooms sheet (SPEC 2.1): every room with its area, then the carpet area.
import { carpetAreaM2 } from '../core/layout-geom';
import { polygonArea } from '../core/geometry';
import { formatArea } from '../core/units';
import type { Layout } from '../types';
import { el } from './hud';
import type { UnverifiedRooms } from './store';
import { PARTIAL_NOTE } from './store';

/** The footer when some colour was sampled from phone video (SPEC 2.1). */
export const ROOMS_FOOTER = 'Sizes from the floor plan. Colours approximate (from phone video).';
/** Honesty: with no sampled colour the walls, floor and tile pattern are placeholders, so the note must not claim a video. */
export const ROOMS_FOOTER_DEFAULT = 'Sizes from the floor plan. Colours and floor tiles are placeholders, not from the home.';

/** The fine print under the sizes: names a phone video only when the colours really came from one. */
export function sizesNote(layout: Layout): string {
  return layout.finishes?.source === 'sampled' ? ROOMS_FOOTER : ROOMS_FOOTER_DEFAULT;
}

export interface RoomsSummary {
  rows: { id: string; label: string; sqft: number; m2: string; text: string; partial: boolean; reason?: string }[];
  carpet: { sqft: number; m2: string; text: string };
  /** "Carpet area (rooms, excluding balcony): 267 sq ft · 24.8 m²" */
  carpetLine: string;
  footer: string;
}

export function roomsSummary(layout: Layout, unverified: UnverifiedRooms = {}): RoomsSummary {
  const rows = layout.rooms.map((r) => {
    const a = formatArea(polygonArea(r.polygon));
    const note = unverified[r.id];
    return { id: r.id, label: r.label, sqft: a.sqft, m2: a.m2, text: r.partial ? PARTIAL_NOTE : note ? `Not measured (${note})` : a.text, partial: !!r.partial, ...(r.partial ? { reason: r.partial.reason } : {}) };
  });
  const carpet = formatArea(carpetAreaM2(layout));
  const flagged = (r: Layout['rooms'][number]): boolean => !!unverified[r.id] || !!r.partial;
  const anyUnverified = layout.rooms.some(flagged);
  return {
    rows, carpet,
    carpetLine: anyUnverified
      ? `Carpet area: can't be confirmed. ${layout.rooms.filter(flagged).map((r) => r.label).join(', ')} not measured on the drawing.`
      : `Carpet area (rooms, excluding balcony): ${carpet.text}`,
    footer: sizesNote(layout),
  };
}

export interface RoomsSheet { open(): void; close(): void; toggle(): void; isOpen(): boolean }

export function createRoomsSheet(
  parent: HTMLElement, layout: Layout, onClose: () => void, unverified: UnverifiedRooms = {},
): RoomsSheet {
  const s = roomsSummary(layout, unverified);
  const back = el('div', 'wt-rooms', undefined, parent);
  back.dataset.testid = 'rooms-sheet';
  back.hidden = true;
  const card = el('div', 'wt-rooms-card', undefined, back);
  const head = el('div', 'wt-rooms-head', undefined, card);
  el('h2', undefined, 'Rooms', head);
  const x = el('button', 'wt-x', '×', head);
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  for (const r of s.rows) {
    const row = el('div', 'wt-room-row', undefined, card);
    el('span', undefined, r.label, row);
    const area = el('span', 'wt-room-area', r.text, row);
    if (r.partial) {
      row.classList.add('is-partial'); area.classList.add('is-partial');
      if (r.reason) el('div', 'wt-room-why', r.reason, card);
    }
  }
  el('p', 'wt-carpet', s.carpetLine, card);
  el('p', 'wt-rooms-foot', s.footer, card);

  const close = (): void => {
    if (back.hidden) return;
    back.hidden = true;
    onClose();
  };
  x.addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  window.addEventListener('keydown', (e) => { if (!back.hidden && e.key === 'Escape') { e.stopPropagation(); close(); } }, true);
  return {
    open() { back.hidden = false; },
    close,
    toggle() { if (back.hidden) back.hidden = false; else close(); },
    isOpen: () => !back.hidden,
  };
}
