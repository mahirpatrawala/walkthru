// Owned by C3. The rooms sheet (SPEC 2.1): every room with its area, then the carpet area.
import { carpetAreaM2 } from '../core/layout-geom';
import { polygonArea } from '../core/geometry';
import { formatArea } from '../core/units';
import type { Layout } from '../types';
import { el } from './hud';

export const ROOMS_FOOTER = 'Sizes from the floor plan. Colours approximate (from phone video).';

export interface RoomsSummary {
  rows: { id: string; label: string; sqft: number; m2: string; text: string }[];
  carpet: { sqft: number; m2: string; text: string };
  /** "Carpet area (rooms, excluding balcony): 267 sq ft · 24.8 m²" */
  carpetLine: string;
  footer: string;
}

export function roomsSummary(layout: Layout): RoomsSummary {
  const rows = layout.rooms.map((r) => {
    const a = formatArea(polygonArea(r.polygon));
    return { id: r.id, label: r.label, sqft: a.sqft, m2: a.m2, text: a.text };
  });
  const carpet = formatArea(carpetAreaM2(layout));
  return {
    rows, carpet,
    carpetLine: `Carpet area (rooms, excluding balcony): ${carpet.text}`,
    footer: ROOMS_FOOTER,
  };
}

export interface RoomsSheet { open(): void; close(): void; toggle(): void; isOpen(): boolean }

export function createRoomsSheet(parent: HTMLElement, layout: Layout, onClose: () => void): RoomsSheet {
  const s = roomsSummary(layout);
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
    el('span', 'wt-room-area', r.text, row);
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
