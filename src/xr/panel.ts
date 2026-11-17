// The floating panel: rooms of this home, other homes, Exit VR. A picture on a plane in the world, opened in front of the viewer and left where it opened
// (a panel that follows the head is uncomfortable). The layout and the hit test are pure (panel-layout.ts); this file draws and places it.
import * as THREE from 'three';
import { PANEL_DISTANCE_M, PANEL_H_M, PANEL_PX_PER_M, PANEL_RAY_M, PANEL_W_M } from './config';
import { CanvasMesh, CARD, FONT, OCHRE, TERRACOTTA, fit, roundRect } from './canvas-mesh';
import { clampPage, hitButton, homesOfTab, layoutPanel, panelPlacement, rayToPanelPixel } from './panel-layout';
import type { ButtonAction, PanelButton, PanelLayout, PanelModel } from './panel-layout';
import type { V3 } from './teleport';

export class VrPanel {
  readonly group = new THREE.Group();
  private readonly pic: CanvasMesh;
  private readonly dot: THREE.Mesh;
  private readonly dotGeo = new THREE.SphereGeometry(0.012, 10, 8);
  private readonly dotMat = new THREE.MeshBasicMaterial({ color: OCHRE, toneMapped: false, depthTest: false, transparent: true });
  private model: PanelModel;
  private layout: PanelLayout;
  private hover: PanelButton | null = null;
  private place = panelPlacement({ x: 0, y: 1.6, z: 0 }, 0, -1, PANEL_DISTANCE_M);
  private opened = false;

  constructor(initial: PanelModel) {
    this.model = initial;
    this.layout = layoutPanel(initial);
    this.pic = new CanvasMesh(PANEL_W_M, PANEL_H_M, Math.round(PANEL_W_M * PANEL_PX_PER_M), Math.round(PANEL_H_M * PANEL_PX_PER_M), { renderOrder: 920 });
    this.group.name = 'vr-panel';
    this.group.add(this.pic.mesh);
    this.dot = new THREE.Mesh(this.dotGeo, this.dotMat);
    this.dot.renderOrder = 930;
    this.dot.visible = false;
    this.group.add(this.dot);
    this.group.visible = false;
    this.redraw();
  }

  get isOpen(): boolean { return this.opened; }
  get current(): PanelModel { return this.model; }
  get placementNow(): ReturnType<typeof panelPlacement> { return this.place; }
  get layoutNow(): PanelLayout { return this.layout; }

  /** The model changes (a new home, a status line, a page): the panel is laid out and drawn again. */
  update(patch: Partial<PanelModel>): void {
    this.model = { ...this.model, ...patch };
    this.model.roomPage = clampPage(this.model.roomPage, this.model.rooms.length);
    this.model.homePage = clampPage(this.model.homePage, homesOfTab(this.model).length);
    this.layout = layoutPanel(this.model);
    this.hover = null;
    this.redraw();
  }

  /** Opens it `PANEL_DISTANCE_M` in front of the head, facing it. */
  show(head: V3, forward: V3): void {
    this.place = panelPlacement(head, forward.x, forward.z, PANEL_DISTANCE_M);
    this.group.position.set(this.place.centre.x, this.place.centre.y, this.place.centre.z);
    this.group.rotation.set(0, this.place.yaw, 0);
    this.group.updateMatrixWorld(true);
    this.group.visible = true;
    this.opened = true;
    this.hover = null;
    this.redraw();
  }

  hide(): void {
    this.opened = false;
    this.group.visible = false;
    this.dot.visible = false;
    this.hover = null;
  }

  /** Points a ray at the panel. Returns the button under it (or null) and moves the pointer dot. Hover changes redraw. */
  pointAt(ray: { origin: V3; dir: V3 }): { button: PanelButton | null; hit: V3; distM: number } | null {
    if (!this.opened) return null;
    const r = rayToPanelPixel(ray, this.place, PANEL_RAY_M);
    if (!r) { this.dot.visible = false; this.setHover(null); return null; }
    const button = hitButton(this.layout, r.px, r.py);
    const u = r.px / PANEL_PX_PER_M - PANEL_W_M / 2;
    const v = PANEL_H_M / 2 - r.py / PANEL_PX_PER_M;
    this.dot.position.set(u, v, 0.004);
    this.dot.visible = true;
    this.setHover(button && button.enabled ? button : null);
    const hit = { x: ray.origin.x + ray.dir.x * r.distM, y: ray.origin.y + ray.dir.y * r.distM, z: ray.origin.z + ray.dir.z * r.distM };
    return { button, hit, distM: r.distM };
  }

  private setHover(b: PanelButton | null): void {
    const same = (!b && !this.hover) || (!!b && !!this.hover && JSON.stringify(b.action) === JSON.stringify(this.hover.action));
    if (same) return;
    this.hover = b;
    this.redraw();
  }

  /** What a press on a button does to the panel's own state; the caller handles the rest (a teleport, a swap, exit). Returns the action for the caller. */
  press(b: PanelButton): ButtonAction | null {
    if (!b.enabled) return null;
    if (b.action.type === 'tab') { this.update({ homeTab: b.action.tab, homePage: 0 }); return null; }
    if (b.action.type === 'page') {
      const a = b.action;
      if (a.list === 'rooms') this.update({ roomPage: this.model.roomPage + a.delta });
      else this.update({ homePage: this.model.homePage + a.delta });
      return null;
    }
    return b.action;
  }

  private redraw(): void {
    const L = this.layout, m = this.model, hov = this.hover;
    this.pic.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(31, 24, 20, 0.94)';
      roundRect(ctx, 0, 0, w, h, 44); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 253, 248, 0.18)'; ctx.lineWidth = 3;
      roundRect(ctx, 2, 2, w - 4, h - 4, 42); ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CARD; ctx.font = `800 56px ${FONT}`; ctx.textAlign = 'left';
      ctx.fillText(fit(ctx, m.title, w - 72 - 20), 36, 52);
      ctx.fillStyle = 'rgba(255, 253, 248, 0.62)'; ctx.font = `500 30px ${FONT}`;
      ctx.fillText(fit(ctx, m.subtitle, w - 72), 36, 108);
      for (const hd of L.headings) { ctx.fillStyle = OCHRE; ctx.font = `700 30px ${FONT}`; ctx.fillText(hd.text.toUpperCase(), hd.x, hd.y); }
      for (const b of L.buttons) this.drawButton(ctx, b, !!hov && JSON.stringify(hov.action) === JSON.stringify(b.action));
      for (const p of L.pagers) { ctx.fillStyle = 'rgba(255, 253, 248, 0.6)'; ctx.font = `600 30px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(p.text, p.x, p.y); }
      if (m.status) {
        ctx.textAlign = 'center'; ctx.fillStyle = OCHRE; ctx.font = `600 28px ${FONT}`;
        ctx.fillText(fit(ctx, m.status, w - 700), w / 2, L.h - 62);
      }
    });
  }

  private drawButton(ctx: CanvasRenderingContext2D, b: PanelButton, hover: boolean): void {
    const r = b.rect;
    const exit = b.action.type === 'exit';
    ctx.textAlign = 'left';
    roundRect(ctx, r.x, r.y, r.w, r.h, 16);
    ctx.fillStyle = hover ? TERRACOTTA : exit ? 'rgba(178, 71, 43, 0.28)' : b.active ? 'rgba(30, 107, 115, 0.42)' : 'rgba(255, 253, 248, 0.09)';
    ctx.fill();
    if (b.active) { ctx.strokeStyle = OCHRE; ctx.lineWidth = 3; roundRect(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, 15); ctx.stroke(); }
    ctx.fillStyle = b.enabled ? CARD : 'rgba(255, 253, 248, 0.34)';
    const centred = b.action.type === 'exit' || b.action.type === 'close' || b.action.type === 'page' || b.action.type === 'tab';
    if (centred) {
      ctx.textAlign = 'center'; ctx.font = `700 ${b.action.type === 'page' ? 31 : b.action.type === 'tab' ? 32 : 36}px ${FONT}`;
      ctx.fillText(b.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
      return;
    }
    // the second line of words takes the room it needs (up to 300 px) and the name takes the rest
    ctx.font = `500 28px ${FONT}`;
    const subW = b.sub ? Math.min(300, Math.ceil(ctx.measureText(b.sub).width)) : 0;
    ctx.font = `700 35px ${FONT}`;
    ctx.fillText(fit(ctx, b.label, r.w - 52 - subW), r.x + 20, r.y + r.h / 2 + 1);
    if (b.sub) {
      ctx.textAlign = 'right'; ctx.font = `500 28px ${FONT}`;
      ctx.fillStyle = b.enabled ? 'rgba(255, 253, 248, 0.72)' : 'rgba(255, 253, 248, 0.38)';
      ctx.fillText(fit(ctx, b.sub, subW), r.x + r.w - 20, r.y + r.h / 2 + 1);
    }
  }

  dispose(): void {
    this.pic.dispose();
    this.dotGeo.dispose();
    this.dotMat.dispose();
    this.group.removeFromParent();
  }
}
