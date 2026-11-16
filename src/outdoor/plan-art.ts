// The plan of an open-air space (SPEC 19.7): what the building map draws under the walls of a pool area or a garden: lawn as lawn, water as water
// (shallow end pale, deep end dark, steps lighter), paving, timber, paths, beds, the track, rubber, a covered verandah, the trees and palms as crowns.
// Pure: returns SVG text in metres (x east, z south), colours inline so it needs no stylesheet, ids unique per `idPrefix`.
import type { Vec2 } from '../types';
import { SPECIES } from './species';
import { plantsForTier, allHedges } from './plants';
import { rectD, rectW } from './types';
import type { GroundArea, OutdoorFile, PoolBasin } from './types';
import { stepRects } from './pool';

const n3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const pts = (p: Vec2[]): string => p.map((q) => `${n3(q.x)},${n3(q.z)}`).join(' ');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const PLAN_COLOUR: Record<GroundArea['finish'], string> = { lawn: '#A5C985', paving: '#DCD1BA', deck: '#B88C62', gravel: '#DDD4C2', bed: '#8F7357', path: '#C6C0B6', rubber: '#4B8A5A', track: '#BE6247' };

function poolArt(b: PoolBasin, idPrefix: string, at: (p: Vec2) => Vec2): string {
  const R = b.rect;
  const cor = [{ x: R.x0, z: R.z0 }, { x: R.x1, z: R.z0 }, { x: R.x1, z: R.z1 }, { x: R.x0, z: R.z1 }].map(at);
  const xs = cor.map((p) => p.x), zs = cor.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const alongX = b.shallowEnd === 'W' || b.shallowEnd === 'E';
  const flip = b.shallowEnd === 'E' || b.shallowEnd === 'S';
  const gid = `${idPrefix}-w-${b.id}`;
  const shallow = '#8FD3E6', deep = b.kids ? '#5FC2CF' : '#2F86B5';
  const ga = alongX ? (flip ? [1, 0, 0, 0] : [0, 0, 1, 0]) : (flip ? [0, 1, 0, 0] : [0, 0, 0, 1]);
  const cm = b.copingM;
  const out = [
    `<linearGradient id="${gid}" x1="${ga[0]}" y1="${ga[1]}" x2="${ga[2] || (alongX ? 1 : 0)}" y2="${ga[3] || (alongX ? 0 : 1)}"><stop offset="0" stop-color="${shallow}"/><stop offset="0.35" stop-color="${shallow}"/><stop offset="0.8" stop-color="${deep}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`,
    `<rect class="bm-coping" x="${n3(x0 - cm)}" y="${n3(z0 - cm)}" width="${n3(x1 - x0 + 2 * cm)}" height="${n3(z1 - z0 + 2 * cm)}" fill="#EFE7D6" stroke="#CDBFA6" stroke-width="0.05"/>`,
    `<rect class="bm-water" x="${n3(x0)}" y="${n3(z0)}" width="${n3(x1 - x0)}" height="${n3(z1 - z0)}" fill="url(#${gid})"/>`,
  ];
  for (const s of stepRects(b)) {
    const a = at({ x: s.rect.x0, z: s.rect.z0 }), c = at({ x: s.rect.x1, z: s.rect.z1 });
    out.push(`<rect class="bm-step" x="${n3(Math.min(a.x, c.x))}" y="${n3(Math.min(a.z, c.z))}" width="${n3(Math.abs(c.x - a.x))}" height="${n3(Math.abs(c.z - a.z))}" fill="#CDEBF3" stroke="#7FB8CC" stroke-width="0.04"/>`);
  }
  void rectW; void rectD;
  return out.join('');
}

/** the SVG fragment for the space's ground, water, planting and roofs; `at` carries a point of the scene frame to the plan (the space's placement) */
export function outdoorPlanArt(file: OutdoorFile, idPrefix: string, at: (p: Vec2) => Vec2 = (p) => p): string {
  const out: string[] = [`<g class="bm-outdoor" aria-hidden="true">`];
  for (const a of file.areas) {
    const poly = a.polygon.map(at);
    const holes = (a.holes ?? []).map((h) => h.map(at));
    const d = [poly, ...holes].map((p) => `M${p.map((q) => `${n3(q.x)} ${n3(q.z)}`).join(' L')} Z`).join(' ');
    const fill = a.colour && (a.finish === 'rubber' || a.finish === 'track') ? a.colour : PLAN_COLOUR[a.finish];
    out.push(`<path class="bm-ground bm-${a.finish}" d="${d}" fill="${esc(fill)}" fill-rule="evenodd"${a.finish === 'bed' || a.edgingM ? ` stroke="#6E5B47" stroke-width="0.06"` : ''}/>`);
  }
  for (const b of file.pools) out.push(poolArt(b, idPrefix, at));
  for (const r of file.roofs) {
    const a = at({ x: r.rect.x0, z: r.rect.z0 }), c = at({ x: r.rect.x1, z: r.rect.z1 });
    out.push(`<rect class="bm-roof" x="${n3(Math.min(a.x, c.x))}" y="${n3(Math.min(a.z, c.z))}" width="${n3(Math.abs(c.x - a.x))}" height="${n3(Math.abs(c.z - a.z))}" fill="#FFFFFF" fill-opacity="0.38" stroke="#9A8E7C" stroke-width="0.07" stroke-dasharray="0.4 0.25"/>`);
    for (const col of r.columns) { const p = at(col); out.push(`<rect x="${n3(p.x - 0.16)}" y="${n3(p.z - 0.16)}" width="0.32" height="0.32" fill="#8A7F72"/>`); }
  }
  for (const h of allHedges(file)) {
    const p = at({ x: h.x, z: h.z }), yaw = (h.yawDeg * Math.PI) / 180, dx = Math.sin(yaw) * h.lenM / 2, dz = Math.cos(yaw) * h.lenM / 2;
    out.push(`<line x1="${n3(p.x - dx)}" y1="${n3(p.z - dz)}" x2="${n3(p.x + dx)}" y2="${n3(p.z + dz)}" stroke="#2F6A35" stroke-width="${n3(h.widthM)}" stroke-linecap="round"/>`);
  }
  // the plants: crowns of trees and palms, dots for shrubs
  for (const p of plantsForTier(file, 'high')) {
    const sp = SPECIES[p.species], q = at({ x: p.x, z: p.z });
    const big = sp.form === 'palm' || sp.form === 'crown' || sp.form === 'umbrella';
    const r = big ? sp.crownR * (p.scale ?? 1) * (sp.form === 'palm' ? 0.55 : 0.8) : Math.max(0.25, sp.crownR * (p.scale ?? 1) * 0.55);
    out.push(`<circle class="bm-plant" cx="${n3(q.x)}" cy="${n3(q.z)}" r="${n3(r)}" fill="${big ? '#3F7A3A' : sp.flower ?? '#4F8A3A'}" fill-opacity="${big ? 0.7 : 0.8}" stroke="${big ? '#2B5A2A' : 'none'}" stroke-width="0.06"/>`);
  }
  out.push('</g>');
  return out.join('');
}
