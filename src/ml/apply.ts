// Owned by C10. SPEC 15.7: pure functions that turn the ML outputs into values of existing contracts.
// A drawing's or floor plan's scale still outranks any ML scale (SPEC 15.6): callers apply these only to unpinned things.
import type { LayoutProposal, Opening, RoomTag, SplatOverlay } from '../types';
import { polygonArea, polygonSelfIntersects } from '../core/geometry';
import { normalizeRoom } from '../core/layout-validate';
import { isIdentityTransform } from '../media/pins';
import { MAX_ML_CONFIDENCE, MAX_SCALE_SPREAD_PCT, validateProposalShape } from './outputs';
import type { MlCeilingFile, MlScaleFile } from './outputs';

export interface ScaleApplication { splat: SplatOverlay; applied: boolean; warning?: string }

/**
 * Sets `transform.scale` of an unpinned splat to the ML metres-per-unit.
 * Returns the splat unchanged, with a warning, when the splat is already pinned (transform is not the identity),
 * the spread is above MAX_SCALE_SPREAD_PCT, the model is not commercial-OK, or the value is not usable.
 */
export function applyMlScale(splat: SplatOverlay, scale: MlScaleFile): ScaleApplication {
  if (!scale.commercialOk) return { splat, applied: false, warning: `Depth scale from ${scale.model} not used: the model is not licensed for shipping.` };
  if (!isIdentityTransform(splat.transform)) return { splat, applied: false, warning: 'The scan is already lined up, so the depth-model scale was not applied.' };
  if (!(scale.spreadPct <= MAX_SCALE_SPREAD_PCT)) {
    return { splat, applied: false, warning: `Depth scale not used: frames disagree by ${scale.spreadPct.toFixed(1)}% (limit ${MAX_SCALE_SPREAD_PCT}%).` };
  }
  if (!(scale.metresPerUnit > 0) || !Number.isFinite(scale.metresPerUnit)) return { splat, applied: false, warning: 'Depth scale not used: the value is not a positive number.' };
  return { splat: { ...splat, transform: { ...splat.transform, scale: scale.metresPerUnit } }, applied: true };
}

export function splatWithMlScale(splat: SplatOverlay, scale: MlScaleFile): SplatOverlay {
  return applyMlScale(splat, scale).splat;
}

/**
 * A LayoutProposal safe to hand to the editor: shape validated, polygons normalised to positive area, bow-tie rooms
 * dropped (with a note), confidence capped at 0.4, wall height taken from the ceiling file when there is one.
 * Warnings go into `notes`, prefixed "ML check:".
 */
export function proposalFromMl(p: unknown, ceiling: MlCeilingFile | null): LayoutProposal {
  const raw = validateProposalShape(p);
  const notes = [...(raw.notes ?? [])];
  const rooms: RoomTag[] = [];
  const kept = new Set<string>();
  for (const r of raw.rooms) {
    if (r.polygon.length < 3 || r.edges.length !== r.polygon.length) { notes.push(`ML check: dropped ${r.label || r.id} (corners and edges do not match).`); continue; }
    if (polygonSelfIntersects(r.polygon)) { notes.push(`ML check: dropped ${r.label || r.id} (its outline crosses itself).`); continue; }
    if (Math.abs(polygonArea(r.polygon)) < 1e-6) { notes.push(`ML check: dropped ${r.label || r.id} (no area).`); continue; }
    rooms.push(normalizeRoom(r));
    kept.add(r.id);
  }
  const openings: Opening[] = [];
  for (const o of raw.openings) {
    const room = rooms.find((r) => r.id === o.roomId);
    if (!room || o.edge < 0 || o.edge >= room.polygon.length) { notes.push(`ML check: dropped opening ${o.id} (its wall is not there).`); continue; }
    openings.push(o);
  }
  const out: LayoutProposal = {
    version: 1, source: raw.source, rooms, openings, confidence: Math.min(MAX_ML_CONFIDENCE, Math.max(0, raw.confidence)), notes,
  };
  if (ceiling && ceiling.commercialOk) out.wallHeightM = ceiling.heightM;
  else if (raw.wallHeightM !== undefined) out.wallHeightM = raw.wallHeightM;
  if (raw.finishes) out.finishes = raw.finishes;
  return out;
}

/** "Depth model suggests 1 unit = 0.41 m (±6%)." for the Scan step's hints. */
export function mlScaleHint(scale: MlScaleFile): string {
  const unit = scale.metresPerUnit >= 0.1 ? scale.metresPerUnit.toFixed(2) : scale.metresPerUnit.toPrecision(2);
  return `Depth model suggests 1 unit = ${unit} m (±${Math.round(scale.spreadPct)}%).`;
}
