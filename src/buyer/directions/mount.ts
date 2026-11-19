// The walk's direction aids (SPEC 22.1, 22.2), mounted in the HUD of a space whose north is known (and only then): a compass dial that turns with the
// camera (a tap opens the sheet), two lines on the identity card (the door and the balcony), and the Directions sheet: the facing of the main door, the
// balconies and every room, and, where the building has switched it on, the Vastu checklist. Everything it makes goes with `dispose()`.
import * as THREE from 'three';
import type { FacingReading } from '../../core/facing';

import type { NorthRef } from '../../core/north';
import { VASTU_NOTE, summaryLine, vastuReport } from '../../core/vastu';
import type { RuleResult, VastuReport } from '../../core/vastu';
import type { FurnitureItem, Layout } from '../../types';
import type { Viewer } from '../../engine/viewer';
import { el } from '../hud';
import { cardLines, dialState, facingLines } from './model';
import './directions.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface DirectionsDeps {
  /** the HUD root */
  parent: HTMLElement;
  viewer: Viewer;
  layout: Layout;
  north: NorthRef;
  reading: FacingReading;
  /** the furniture as it stands now (a bed the buyer moved counts where it is) */
  furniture(): readonly FurnitureItem[];
  onFurnitureChange(cb: () => void): (() => void) | void;
  /** the Vastu checklist is allowed here at all: a flat (a home), not a corridor or a lobby */
  vastuAllowed: boolean;
  /** the view modes: the dial steps aside in the plan (which draws its own north arrow) */
  viewMode(): 'walk' | 'doll' | 'plan';
  /** a sample building says its orientation is a demonstration value */
  sample: boolean;
  /** the walker stands still while the sheet is open */
  block(on: boolean): void;
}

export interface MountedDirections {
  /** the building's setting arrived (or changed): show or hide the checklist */
  setVastu(on: boolean): void;
  dispose(): void;
  debug: { sheetOpen(): boolean; open(): void; close(): void; vastu(): VastuReport | null; dialBearing(): number | null };
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

const SOURCE_NOTE: Record<NorthRef['source'], string> = {
  drawing: 'North is read from the drawing.',
  builder: 'North is as the builder set it.',
};

export function mountDirections(d: DirectionsDeps): MountedDirections {
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let vastuOn = false;

  // ---- the dial
  const dial = el('button', 'wt-compass wt-glass', undefined, d.parent);
  dial.type = 'button';
  dial.dataset.ui = '1';
  dial.dataset.testid = 'compass';
  const svg = svgEl('svg', { viewBox: '-50 -50 100 100', 'aria-hidden': 'true', focusable: 'false' }, dial);
  const ring = svgEl('g', { class: 'wt-compass-ring' }, svg);
  svgEl('circle', { r: '42', class: 'wt-compass-rim' }, ring);
  for (let i = 0; i < 8; i++) svgEl('line', { x1: '0', y1: i % 2 ? '-42' : '-42', x2: '0', y2: i % 2 ? '-37' : '-34', class: 'wt-compass-tick', transform: `rotate(${i * 45})` }, ring);
  for (const [i, letter] of ['N', 'E', 'S', 'W'].entries()) {
    const t = svgEl('text', { x: '0', y: '-22', 'text-anchor': 'middle', 'dominant-baseline': 'central', class: `wt-compass-l${letter === 'N' ? ' is-n' : ''}`, transform: `rotate(${i * 90})` }, ring);
    // keep each letter upright against the ring's own turn only at rest: it turns with the ring, as a real card does
    t.textContent = letter;
  }
  svgEl('path', { d: 'M0 -49 L5.5 -40 L-5.5 -40 Z', class: 'wt-compass-pointer' }, svg);
  const read = el('span', 'wt-compass-read', undefined, dial);
  read.setAttribute('aria-hidden', 'true');

  const v = new THREE.Vector3();
  let lastBearing = Number.NaN;
  let bearingNow: number | null = null;
  const tick = (): void => {
    if (disposed) return;
    const mode = d.viewMode();
    const show = mode !== 'plan';
    if (dial.hidden === show) dial.hidden = !show;
    if (!show) return;
    d.viewer.camera.getWorldDirection(v);
    const s = dialState(d.north, { x: v.x, z: v.z });
    if (!s) return;
    bearingNow = s.bearing;
    // a turn under half a degree is not redrawn (the dial is read, not measured)
    if (Math.abs(((s.bearing - lastBearing + 540) % 360) - 180) < 0.5) return;
    lastBearing = s.bearing;
    ring.setAttribute('transform', `rotate(${(-s.bearing).toFixed(1)})`);
    read.textContent = s.label;
    dial.setAttribute('aria-label', `Compass: you are looking ${s.label}. Open the directions of this flat`);
  };
  cleanups.push(d.viewer.onFrame(tick));
  tick();

  // ---- the identity card's lines
  const card = d.parent.querySelector<HTMLElement>('.wt-id .wt-id-text');
  const cardBox = el('div', 'wt-id-dir', undefined, card ?? undefined);
  cardBox.dataset.testid = 'identity-directions';
  const lines = cardLines(d.reading);
  for (const l of lines) el('div', 'wt-id-dir-line', l, cardBox);
  const vastuLine = el('div', 'wt-id-dir-line', undefined, cardBox);
  vastuLine.hidden = true;
  const open = el('button', 'wt-id-dir-btn', undefined, cardBox);
  open.type = 'button'; open.dataset.ui = '1'; open.dataset.testid = 'directions-open';
  open.textContent = 'Directions';
  cardBox.hidden = !card;
  cleanups.push(() => cardBox.remove());

  // ---- the sheet
  const back = el('div', 'wt-rooms wt-dir-sheet', undefined, d.parent);
  back.dataset.testid = 'directions-sheet';
  back.hidden = true;
  const sheet = el('div', 'wt-rooms-card', undefined, back);
  const head = el('div', 'wt-rooms-head', undefined, sheet);
  el('h2', undefined, 'Directions', head);
  const x = el('button', 'wt-x', '×', head);
  x.type = 'button'; x.setAttribute('aria-label', 'Close');
  const body = el('div', 'wt-dir-body', undefined, sheet);

  let report: VastuReport | null = null;
  const render = (): void => {
    body.replaceChildren();
    el('p', 'wt-dir-src', `${SOURCE_NOTE[d.north.source]}${d.sample ? ' This is a sample building: its orientation is a demonstration value.' : ''}`, body);
    const list = el('div', 'wt-dir-list', undefined, body);
    list.dataset.testid = 'facing-list';
    for (const l of facingLines(d.reading)) {
      const row = el('div', 'wt-room-row', undefined, list);
      el('span', undefined, l.what, row);
      el('span', 'wt-room-area', l.text, row);
    }
    report = vastuOn && d.vastuAllowed ? vastuReport(d.layout, d.furniture(), d.north) : null;
    vastuLine.hidden = !report;
    if (report) vastuLine.textContent = `Vastu checklist: ${summaryLine(report)}`;
    if (report) renderVastu(body, report);
  };

  const group = (parent: HTMLElement, title: string, rows: RuleResult[], cls: string): void => {
    if (!rows.length) return;
    el('h3', `wt-dir-h ${cls}`, title, parent);
    for (const r of rows) {
      const row = el('div', `wt-dir-rule ${cls}`, undefined, parent);
      el('b', undefined, r.title, row);
      el('span', undefined, r.detail, row);
    }
  };
  function renderVastu(parent: HTMLElement, r: VastuReport): void {
    const box = el('div', 'wt-dir-vastu', undefined, parent);
    box.dataset.testid = 'vastu-checklist';
    el('h3', 'wt-dir-title', 'Vastu checklist', box);
    el('p', 'wt-dir-count', summaryLine(r), box).dataset.testid = 'vastu-count';
    group(box, 'Does not match', r.mismatches, 'is-miss');
    group(box, 'Not checked', r.notChecked, 'is-skip');
    group(box, 'Matches', r.results.filter((y) => y.verdict === 'match'), 'is-ok');
    el('p', 'wt-rooms-foot', VASTU_NOTE, box);
  }

  const setOpen = (on: boolean): void => {
    if (disposed || back.hidden === !on) return;
    back.hidden = !on;
    d.block(on);
    if (on) render();
  };
  open.addEventListener('click', (e) => { e.stopPropagation(); setOpen(true); open.blur(); });
  dial.addEventListener('click', (e) => { e.stopPropagation(); setOpen(true); dial.blur(); });
  x.addEventListener('click', () => setOpen(false));
  back.addEventListener('click', (e) => { if (e.target === back) setOpen(false); });
  const onKey = (e: KeyboardEvent): void => { if (!back.hidden && e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
  window.addEventListener('keydown', onKey, true);
  cleanups.push(() => window.removeEventListener('keydown', onKey, true));
  const offFur = d.onFurnitureChange(() => { if (!back.hidden) render(); });
  if (offFur) cleanups.push(offFur);
  cleanups.push(() => { back.remove(); dial.remove(); });

  return {
    setVastu(on) { vastuOn = on; render(); },
    dispose() {
      if (disposed) return;
      if (!back.hidden) d.block(false);
      disposed = true;
      for (const fn of cleanups.splice(0)) { try { fn(); } catch (err) { console.warn('[walkthru] directions clean-up step failed', err); } }
    },
    debug: { sheetOpen: () => !back.hidden, open: () => setOpen(true), close: () => setOpen(false), vastu: () => report, dialBearing: () => bearingNow },
  };
}
