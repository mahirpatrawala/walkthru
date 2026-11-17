// The pool's two readouts in the walk (SPEC 19.3): a pill that follows the walker near the water ("Depth here 1.2 m") and the walkway verdict of the
// deck, and the depth card they open. The walker cannot walk on water: at the coping the pill says so. DOM only; the maths is in pool.ts, walkway.ts and depth-card.ts.
import type { FurnitureItem, Vec2 } from '../types';
import { PEOPLE_PRESETS, depthCardModel } from './depth-card';
import type { Person } from './pool';
import { depthAt, inRect } from './pool';
import type { PoolBasin, Roof } from './types';
import { WALKWAY_MIN_OBSTACLE_M, walkwayNote, walkwayReport } from './walkway';
import type { WalkObstacle, WalkwayReport } from './walkway';
import { pointInPolygon } from '../core/geometry';

export interface PoolUiDeps {
  host: HTMLElement;
  pools: readonly PoolBasin[];
  roofs: readonly Roof[];
  room: Vec2[];
  walker: { position(): Vec2; heightCm(): number };
  items(): FurnitureItem[];
  onItemsChange(cb: () => void): () => void;
  /** the walk is blocked while the card is open */
  block(on: boolean): void;
}

/** the pieces on the deck that stop a person walking (a piece lower than 25 cm does not) and the roof columns */
export function deckObstacles(items: readonly FurnitureItem[], roofs: readonly Roof[]): WalkObstacle[] {
  const out: WalkObstacle[] = items.filter((i) => i.heightM >= WALKWAY_MIN_OBSTACLE_M && !i.catalogId?.startsWith('pool-changing')).map((i) => ({ box: i.box, heightM: i.heightM, label: `the ${i.label.toLowerCase()}` }));
  for (const r of roofs) for (const c of r.columns) out.push({ box: { cx: c.x, cz: c.z, w: 0.32, d: 0.32, yawDeg: 0 }, heightM: r.heightM, label: 'a roof column' });
  return out;
}

/** the nearest basin to a point, the distance from it to the water's edge, and the water's depth at the nearest point of the edge */
export function nearestWater(pools: readonly PoolBasin[], p: Vec2): { basin: PoolBasin; distM: number; depthM: number } | null {
  let best: { basin: PoolBasin; distM: number; depthM: number } | null = null;
  for (const b of pools) {
    const r = b.rect;
    const qx = Math.min(r.x1 - 0.05, Math.max(r.x0 + 0.05, p.x)), qz = Math.min(r.z1 - 0.05, Math.max(r.z0 + 0.05, p.z));
    const dist = inRect(r, p.x, p.z) ? 0 : Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.z0 - p.z, 0, p.z - r.z1));
    const d = depthAt(b, qx, qz);
    if (d !== null && (!best || dist < best.distM)) best = { basin: b, distM: dist, depthM: d };
  }
  return best;
}

export interface PoolUi {
  update(dt: number): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  walkway(): WalkwayReport;
  /** the pill's text now, for tests */
  pillText(): string;
  dispose(): void;
}

const CSS = `
.wto-pill { position: absolute; left: 50%; bottom: calc(18px + var(--wt-safe-b, 0px)); transform: translateX(-50%); display: flex; gap: 8px; align-items: center; z-index: 5; pointer-events: none; max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center; }
.wto-pill.wto-top { bottom: auto; top: calc(64px + var(--wt-safe-t, 0px)); }
.wto-pill button { pointer-events: auto; min-height: 44px; padding: 8px 16px; border: 0; border-radius: 999px; background: var(--wt-card, #fff); color: var(--wt-ink, #2B211C); box-shadow: var(--wt-shadow, 0 2px 12px rgba(0,0,0,.2)); font: 600 14px/1.25 var(--wt-display, system-ui); cursor: pointer; text-align: left; }
.wto-pill .wto-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; background: #3E9A4E; vertical-align: 1px; }
.wto-pill .wto-bad .wto-dot { background: #C93A2E; } .wto-pill .wto-warn .wto-dot { background: #E0A12C; } .wto-pill .wto-info .wto-dot { background: #9AA7B0; }
.wto-card { position: absolute; left: 50%; bottom: calc(12px + var(--wt-safe-b, 0px)); transform: translateX(-50%); width: min(440px, calc(100vw - 20px)); max-height: calc(100% - 90px); overflow-y: auto; z-index: 8; box-sizing: border-box; padding: 14px 16px 14px; background: var(--wt-card, #fff); border-radius: 16px; box-shadow: var(--wt-shadow, 0 4px 24px rgba(0,0,0,.3)); font-family: var(--wt-display, system-ui); color: var(--wt-ink, #2B211C); pointer-events: auto; -webkit-overflow-scrolling: touch; }
.wto-card h3 { margin: 0 34px 6px 0; font-size: 17px; }
.wto-x { position: absolute; right: 8px; top: 8px; width: 36px; height: 36px; border: 0; border-radius: 50%; background: rgba(0,0,0,.07); font-size: 20px; cursor: pointer; }
.wto-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.wto-chips button { min-height: 36px; padding: 4px 12px; border: 1.5px solid #2F6F97; border-radius: 999px; background: #fff; color: #1F4E6B; font: 600 13px var(--wt-display, system-ui); cursor: pointer; }
.wto-chips button.is-on { background: #2F6F97; color: #fff; }
.wto-card svg { width: 100%; height: auto; display: block; background: linear-gradient(#EAF4F8, #F7F1E6 34%); border-radius: 10px; }
.wto-head { font-size: 15px; font-weight: 700; margin: 8px 0 4px; line-height: 1.35; }
.wto-card p { margin: 4px 0; font-size: 13.5px; line-height: 1.4; }
.wto-card .wto-note { font-size: 12px; color: #6A5E55; margin: 3px 0; }
.wto-walk { margin: 8px 0 2px; padding: 8px 10px; border-radius: 10px; font-size: 13px; background: #EAF5EC; } .wto-walk.wto-bad { background: #FBE6E3; } .wto-walk.wto-warn { background: #FBF0D8; } .wto-walk.wto-info { background: #EEF1F3; }
`;

export function mountPoolUi(d: PoolUiDeps): PoolUi {
  const style = document.createElement('style');
  style.textContent = CSS;
  style.dataset.wtKeep = '1';
  d.host.appendChild(style);
  const pill = document.createElement('div');
  pill.className = 'wto-pill';
  pill.dataset.ui = '1';
  const depthBtn = document.createElement('button');
  depthBtn.type = 'button'; depthBtn.dataset.testid = 'pool-depth'; depthBtn.hidden = true;
  const walkBtn = document.createElement('button');
  walkBtn.type = 'button'; walkBtn.dataset.testid = 'pool-walkway'; walkBtn.hidden = false;
  pill.append(depthBtn, walkBtn);
  d.host.appendChild(pill);
  let card: HTMLElement | null = null;
  let person: Person = PEOPLE_PRESETS[0];
  let usePerson: 'me' | string = 'me';
  let report = compute();
  let near: ReturnType<typeof nearestWater> = null;

  function compute(): WalkwayReport { return walkwayReport(d.pools, d.room, deckObstacles(d.items(), d.roofs)); }
  // the layout as it loaded is the sample's own: where its walkway is short (a deck too narrow for 1.2 m) that is information, not an alarm; the
  // moment the visitor moves a piece the pill speaks plainly again. The card keeps the honest numbers either way.
  const layoutKey = (): string => JSON.stringify(d.items().map((i) => [i.id, i.box.cx, i.box.cz, i.box.yawDeg]));
  const loadedKey = layoutKey();
  const sampleOwn = (): boolean => layoutKey() === loadedKey;
  const verdictClass = (): string => (report.verdict === 'clear' ? '' : sampleOwn() ? 'wto-info' : report.verdict === 'tight' ? 'wto-warn' : 'wto-bad');
  const off = d.onItemsChange(() => { report = compute(); paintWalk(); if (card) render(); });
  function paintWalk(): void {
    walkBtn.className = verdictClass();
    walkBtn.innerHTML = `<span class="wto-dot"></span>${esc(report.verdict !== 'clear' && sampleOwn() ? walkwayNote(report) : report.short)}`;
    walkBtn.title = report.message;
    walkBtn.hidden = d.pools.filter((p) => !p.kids).length === 0;
  }
  paintWalk();
  walkBtn.addEventListener('click', () => { open(); });

  const me = (): Person => ({ id: 'me', label: 'You', heightCm: Math.round(d.walker.heightCm()) });
  const chosen = (): Person => (usePerson === 'me' ? me() : (PEOPLE_PRESETS.find((p) => p.id === usePerson) ?? PEOPLE_PRESETS[0]));

  function render(): void {
    if (!card) return;
    const p = chosen();
    const b = (near?.basin ?? d.pools[0]);
    const other = p.id === 'me' ? PEOPLE_PRESETS[1] : p.id === 'child' ? PEOPLE_PRESETS[0] : PEOPLE_PRESETS[1];
    const m = depthCardModel(b, p, other, near ? near.depthM : null);
    card.innerHTML = `<button class="wto-x" type="button" aria-label="Close">&times;</button><h3>${esc(m.title)}</h3>
      <div class="wto-chips" role="group" aria-label="Person">${[{ id: 'me', label: `You, ${me().heightCm} cm` }, ...PEOPLE_PRESETS.map((q) => ({ id: q.id, label: `${q.label}, ${q.heightCm} cm` }))].map((c) => `<button type="button" data-p="${c.id}" class="${c.id === usePerson ? 'is-on' : ''}">${esc(c.label)}</button>`).join('')}</div>
      ${m.svg}
      <div class="wto-head">${esc(m.headline)}</div>
      ${m.here ? `<p>${esc(m.here)}</p>` : ''}
      ${m.rows.map((r) => `<p><b>${esc(r.label)}.</b> ${esc(r.text)}</p>`).join('')}
      <div class="wto-walk ${verdictClass()}">${esc(report.message)}</div>
      <details><summary class="wto-note">Typical guidance, not code</summary>${m.notes.map((n) => `<p class="wto-note">${esc(n)}</p>`).join('')}</details>
      <p class="wto-note">Wading in is not built: the walker stops at the coping. The water is a plain model of a pool, not a real one.</p>`;
    card.querySelector('.wto-x')?.addEventListener('click', close);
    card.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((el) => el.addEventListener('click', () => { usePerson = el.dataset.p ?? 'me'; person = chosen(); render(); }));
  }
  function open(): void {
    if (card || d.pools.length === 0) return;
    card = document.createElement('div');
    card.className = 'wto-card'; card.dataset.ui = '1'; card.dataset.testid = 'pool-card';
    d.host.appendChild(card);
    d.block(true);
    render();
  }
  function close(): void { if (!card) return; card.remove(); card = null; d.block(false); }

  depthBtn.addEventListener('click', open);
  let acc = 0;
  return {
    update(dt) {
      acc += dt;
      if (acc < 0.15) return;
      acc = 0;
      // while furnishing, the tray covers the bottom: the verdicts move up under the mode bar, where the piece being placed is judged against the walkway
      pill.classList.toggle('wto-top', !!d.host.querySelector('.wtf-tray, .wtf-panel, .wtf-bar'));
      near = nearestWater(d.pools, d.walker.position());
      const inRoom = pointInPolygon(d.walker.position(), d.room);
      if (!near || !inRoom || near.distM > 3.2) { depthBtn.hidden = true; return; }
      depthBtn.hidden = false;
      const edge = near.distM < 0.6;
      depthBtn.innerHTML = `<span class="wto-dot" style="background:#2F8FB5"></span>${edge ? `The water's edge: ${near.depthM.toFixed(1)} m deep. You cannot walk into it. See depth` : `Water ${near.depthM.toFixed(1)} m deep. See depth`}`;
      if (card) render();
    },
    open, close, isOpen: () => !!card, walkway: () => report, pillText: () => `${depthBtn.hidden ? '' : depthBtn.textContent} | ${walkBtn.textContent}`,
    dispose() { off(); close(); pill.remove(); style.remove(); void person; },
  };
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
