// The floating panel's layout and hit testing. Pure: the panel is a picture on a plane in the world (panel.ts draws it), and the pointer's
// ray is turned into a pixel of that picture and then into a button here. No three, no DOM.
import { PANEL_H_M, PANEL_PX_PER_M, PANEL_W_M } from './config';

export const PANEL_W = Math.round(PANEL_W_M * PANEL_PX_PER_M);
export const PANEL_H = Math.round(PANEL_H_M * PANEL_PX_PER_M);

export interface Rect { x: number; y: number; w: number; h: number }
export interface PanelRoom { id: string; label: string; /** "12.4 m² · 133 sq ft", or why there is no size */ area: string; goable: boolean }
export interface PanelHome { key: string; label: string; sub: string }

export interface PanelModel {
  title: string;
  subtitle: string;
  rooms: PanelRoom[];
  homes: PanelHome[];
  currentHomeKey: string | null;
  currentRoomId: string | null;
  roomPage: number;
  homePage: number;
  /** a line in the footer: "Loading ...", or an error */
  status?: string | null;
}

export type ButtonAction =
  | { type: 'room'; id: string }
  | { type: 'home'; key: string }
  | { type: 'page'; list: 'rooms' | 'homes'; delta: -1 | 1 }
  | { type: 'exit' }
  | { type: 'close' };

export interface PanelButton {
  action: ButtonAction;
  rect: Rect;
  label: string;
  sub?: string;
  enabled: boolean;
  /** the room the viewer is in, or the home they are in */
  active: boolean;
}

export interface PanelLayout {
  w: number; h: number;
  buttons: PanelButton[];
  headings: { text: string; x: number; y: number }[];
  /** "page 1 of 2" labels, drawn between the pager buttons */
  pagers: { list: 'rooms' | 'homes'; text: string; x: number; y: number }[];
}

export const MARGIN = 36;
export const COL_W = 640;
export const COL_X = [MARGIN, PANEL_W - MARGIN - COL_W];
export const ROW_H = 64;
export const ROW_PITCH = 70;
export const ROWS_PER_PAGE = 7;
export const ROWS_Y = 168;
export const PAGER_Y = ROWS_Y + ROWS_PER_PAGE * ROW_PITCH + 8;
export const PAGER_H = 52;
export const FOOTER_Y = PANEL_H - 96;
export const FOOTER_H = 68;

export const pageCount = (n: number, per = ROWS_PER_PAGE): number => Math.max(1, Math.ceil(n / per));
export const clampPage = (page: number, n: number, per = ROWS_PER_PAGE): number => Math.min(pageCount(n, per) - 1, Math.max(0, Math.floor(page) || 0));

export function layoutPanel(m: PanelModel): PanelLayout {
  const buttons: PanelButton[] = [];
  const pagers: PanelLayout['pagers'] = [];
  const headings = [
    { text: 'Rooms in this home', x: COL_X[0], y: ROWS_Y - 22 },
    { text: 'Other homes', x: COL_X[1], y: ROWS_Y - 22 },
  ];
  const column = (list: 'rooms' | 'homes', x: number): void => {
    const n = list === 'rooms' ? m.rooms.length : m.homes.length;
    const page = clampPage(list === 'rooms' ? m.roomPage : m.homePage, n);
    const from = page * ROWS_PER_PAGE;
    for (let i = from; i < Math.min(n, from + ROWS_PER_PAGE); i++) {
      const rect = { x, y: ROWS_Y + (i - from) * ROW_PITCH, w: COL_W, h: ROW_H };
      if (list === 'rooms') {
        const r = m.rooms[i];
        buttons.push({ action: { type: 'room', id: r.id }, rect, label: r.label, sub: r.area, enabled: r.goable, active: r.id === m.currentRoomId });
      } else {
        const h = m.homes[i];
        const here = h.key === m.currentHomeKey;
        buttons.push({ action: { type: 'home', key: h.key }, rect, label: h.label, sub: here ? 'You are here' : h.sub, enabled: !here, active: here });
      }
    }
    const pages = pageCount(n);
    if (pages > 1) {
      const w = 190;
      buttons.push({ action: { type: 'page', list, delta: -1 }, rect: { x, y: PAGER_Y, w, h: PAGER_H }, label: 'Previous', enabled: page > 0, active: false });
      buttons.push({ action: { type: 'page', list, delta: 1 }, rect: { x: x + COL_W - w, y: PAGER_Y, w, h: PAGER_H }, label: 'Next', enabled: page < pages - 1, active: false });
      pagers.push({ list, text: `${page + 1} of ${pages}`, x: x + COL_W / 2, y: PAGER_Y + PAGER_H / 2 });
    }
  };
  column('rooms', COL_X[0]);
  column('homes', COL_X[1]);
  buttons.push({ action: { type: 'close' }, rect: { x: MARGIN, y: FOOTER_Y, w: 230, h: FOOTER_H }, label: 'Close', enabled: true, active: false });
  buttons.push({ action: { type: 'exit' }, rect: { x: PANEL_W - MARGIN - 300, y: FOOTER_Y, w: 300, h: FOOTER_H }, label: 'Exit VR', enabled: true, active: false });
  return { w: PANEL_W, h: PANEL_H, buttons, headings, pagers };
}

/** The button under a pixel of the panel's picture, or null. A disabled button is still "under" the pixel (it can show it is disabled) but `enabled` is false. */
export function hitButton(layout: PanelLayout, px: number, py: number): PanelButton | null {
  for (const b of layout.buttons) {
    const r = b.rect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return b;
  }
  return null;
}

/**
 * Where a ray meets the panel's plane, as a pixel of its picture. The panel is the rectangle centred on `centre`, in the plane whose horizontal axis is
 * `right` (a unit vector in the floor plane, pointing to the viewer's right as they face it) and whose normal is the horizontal `normal` (pointing at the
 * viewer). Vertical is +Y. Null when the ray points away, runs parallel, or meets the plane further than `maxM` away or outside the rectangle.
 */
export function rayToPanelPixel(
  ray: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } },
  panel: { centre: { x: number; y: number; z: number }; right: { x: number; z: number }; normal: { x: number; z: number } },
  maxM = 8,
): { px: number; py: number; distM: number } | null {
  const denom = ray.dir.x * panel.normal.x + ray.dir.z * panel.normal.z;
  if (denom > -1e-6) return null; // pointing away from the front face, or along it
  const t = ((panel.centre.x - ray.origin.x) * panel.normal.x + (panel.centre.z - ray.origin.z) * panel.normal.z) / denom;
  if (t < 0 || t > maxM) return null;
  const hx = ray.origin.x + ray.dir.x * t - panel.centre.x;
  const hy = ray.origin.y + ray.dir.y * t - panel.centre.y;
  const hz = ray.origin.z + ray.dir.z * t - panel.centre.z;
  const u = hx * panel.right.x + hz * panel.right.z; // metres to the right of the centre
  if (Math.abs(u) > PANEL_W_M / 2 || Math.abs(hy) > PANEL_H_M / 2) return null;
  return { px: (u + PANEL_W_M / 2) * PANEL_PX_PER_M, py: (PANEL_H_M / 2 - hy) * PANEL_PX_PER_M, distM: t };
}

/** The placement of a panel opened in front of the viewer: `distM` ahead of the head along its heading, a little below eye level, facing back at the head. */
export function panelPlacement(head: { x: number; y: number; z: number }, headingX: number, headingZ: number, distM: number): { centre: { x: number; y: number; z: number }; right: { x: number; z: number }; normal: { x: number; z: number }; yaw: number } {
  const l = Math.hypot(headingX, headingZ) || 1;
  const fx = headingX / l, fz = headingZ / l;
  // looking along (fx, fz), the viewer's right hand is (-fz, fx) in x/z with y up and z toward the viewer's back (three's frame)
  const right = { x: -fz, z: fx };
  const normal = { x: -fx, z: -fz };
  return {
    centre: { x: head.x + fx * distM, y: Math.max(1.0, head.y - 0.12), z: head.z + fz * distM },
    right, normal,
    yaw: Math.atan2(normal.x, normal.z),
  };
}
