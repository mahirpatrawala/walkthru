// SPEC 16.6.12: no skin and no trousers through the cloth, in any clip pose, from behind, the side and the front at 0.9 to 3.5 m. The people are really
// skinned here (the clip library retargeted onto each shipped GLB, three's own skinning) and looked at the way a camera would:
//   - the skin that was well inside a garment at the bind pose, and the whole trunk below the neck, must not be visible from any of seven viewpoints in any pose
//     (a ray from the viewpoint to the middle of the triangle meets cloth or other skin first); that is a tear, a gap at the waist, skin standing out of a sleeve
//   - the same for the trousers under a kurti, a tunic or a T-shirt (they came through the hem of a kurti when she walked)
//   - the neck band is a thin strip lying on the top (its lower edge came through the top at the breastbone and showed as white slivers at the back of the neck)
// It failed on the bodies shipped before 16.6.12: the man's shirt showed 84 to 122 cm2 of waist, elbow and shoulder in the jog and when seated, the woman 62, the
// elder 53 in the jog, and the child's T-shirt and shorts 14. The limits are what the fixed bodies reach, with a margin for the lower tier.
import { describe, expect, it } from 'vitest';
import { BODIES, CHAR_DIR, Soup, exposedSkin, interior, loadPosed, mustCover, mustCoverBottom, skinCover } from './helpers/people-skin';
import type { Body, Posed } from './helpers/people-skin';
import fs from 'node:fs';
import path from 'node:path';

const have = BODIES.every((b) => fs.existsSync(path.join(CHAR_DIR, `person-${b}.glb`)) && fs.existsSync(path.join(CHAR_DIR, `person-${b}-low.glb`))) && fs.existsSync(path.join(CHAR_DIR, 'clips.glb'));

/** [clip, frames over its length], as src/look/people.ts plays them (Sitting_Enter runs once, so its frames are spread over it) */
const CLIPS: [string, number][] = [
  ['Idle_Loop', 1], ['Walk_Loop', 6], ['Jog_Fwd_Loop', 8], ['Sitting_Idle_Loop', 1], ['Sitting_Enter', 4], ['Turn_Step', 3], ['Reach_Forward', 4],
  ['Walk_Formal_Loop', 4], ['Idle_FoldArms_Loop', 3], ['Lie_Pose', 1],
];
const timeOf = (p: Posed, clip: string, i: number, n: number): number => (clip === 'Sitting_Enter' ? (p.duration(clip) * (i + 1)) / n * 0.999 : (p.duration(clip) * i) / n);

/** Worst exposed area (cm2) of the skin and of the trousers over every pose of every clip, and where. */
/** Clips in which the hem of a top that is worn out (a kurti, a tunic, a T-shirt) stays where it is: there trousers must not show through the middle of the front and the back from 1.2 cm above the hem (the child's shorts came through the hem as a row of teeth). In a jog or sitting down the hem lifts, as cloth does. */
const STATIC = new Set(['Idle_Loop', 'Turn_Step', 'Idle_FoldArms_Loop', 'Lie_Pose']);

function exposure(p: Posed, tucked: boolean): { skin: number; skinAt: string; trousers: number; trousersAt: string } {
  p.pose(null);
  const restS = skinCover(p);
  const maskS = { cov: mustCover(p, restS, 2) };
  const OUT = ['top', 'wrap', 'trim'];
  const restB = skinCover(p, 'bottom', OUT);
  const maskB = { cov: mustCoverBottom(p, restB, 1, false) };
  const maskBs = { cov: mustCoverBottom(p, restB, 1, !tucked) };
  const r = { skin: 0, skinAt: '', trousers: 0, trousersAt: '' };
  for (const [clip, n] of CLIPS) {
    for (let i = 0; i < n; i++) {
      p.pose(clip, timeOf(p, clip, i, n));
      const a = exposedSkin(p, maskS);
      const b = exposedSkin(p, STATIC.has(clip) ? maskBs : maskB, undefined, 'bottom', OUT);
      let sa = 0, ba = 0;
      for (let k = 0; k < a.views.length; k++) if (a.views[k]) sa += a.now.area[k];
      for (let k = 0; k < b.views.length; k++) if (b.views[k]) ba += b.now.area[k];
      if (sa * 1e4 > r.skin) { r.skin = sa * 1e4; r.skinAt = `${clip} ${i}`; }
      if (ba * 1e4 > r.trousers) { r.trousers = ba * 1e4; r.trousersAt = `${clip} ${i}`; }
    }
  }
  return r;
}

// cm2 of skin (or trousers) visible where cloth must be, in the worst pose. (A pose is about 6 000 cm2 of cloth; these are a few thumbnails.)
const LIMIT: Record<string, { skin: number; trousers: number }> = {
  '': { skin: 8, trousers: 10 },
  '-low': { skin: 26, trousers: 12 },
};

describe.skipIf(!have)('the cloth stays on the body in every pose (16.6.12)', () => {
  for (const tier of ['', '-low']) {
    for (const body of BODIES) {
      it(`${body}${tier}: no skin or trousers visible through the cloth in idle, walk, jog, sit, lie, reach, fold and turn`, async () => {
        const p = await loadPosed(body, tier);
        const r = exposure(p, body === 'man');   // (the man's shirt is tucked: his trousers are worn over it)
        const lim = LIMIT[tier];
        expect(r.skin, `skin visible through the cloth: ${r.skin.toFixed(1)} cm2 (${r.skinAt})`).toBeLessThanOrEqual(lim.skin);
        expect(r.trousers, `trousers visible through the top: ${r.trousers.toFixed(1)} cm2 (${r.trousersAt})`).toBeLessThanOrEqual(lim.trousers);
      }, 120000);
    }
  }

  it('the interior of a covered region is smaller than the region (the test ignores a cuff or a hem that slides, not a hole)', async () => {
    const p = await loadPosed('man');
    p.pose(null);
    const rest = skinCover(p);
    const inner = interior(p, rest.cov, 2);
    const n = (a: Uint8Array) => a.reduce((x, y) => x + y, 0);
    expect(n(rest.cov)).toBeGreaterThan(2000);
    expect(n(inner)).toBeLessThan(n(rest.cov));
    expect(n(inner)).toBeGreaterThan(n(rest.cov) * 0.5);
  });

  for (const body of ['woman', 'elder', 'child'] as Body[]) {
    for (const tier of ['', '-low']) {
      it(`${body}${tier}: the neck band lies on the top, a thin strip a few millimetres off it, in every pose`, async () => {
        const p = await loadPosed(body, tier);
        const worst = { bind: [Infinity, 0] as [number, number], pose: 0 };
        const dist = (): number[] => {
          const top = new Soup(p.positions('top'));
          top.add(p.parts.get('top')!.index);
          top.build();
          const tp = p.positions('trim');
          const d: number[] = [];
          for (let i = 0; i < tp.length / 3; i++) {
            const q = top.nearest(tp[i * 3], tp[i * 3 + 1], tp[i * 3 + 2], 0.05);
            d.push(q ? q[0] : 0.05);
          }
          return d;
        };
        p.pose(null);
        const d0 = dist();
        worst.bind = [Math.min(...d0), Math.max(...d0)];
        for (const [clip, n] of CLIPS) for (let i = 0; i < n; i++) { p.pose(clip, timeOf(p, clip, i, n)); worst.pose = Math.max(worst.pose, ...dist()); }
        // at rest: every vertex of the band is 1 to 8 mm from the cloth under it; in motion the cloth can fold under it, but it never stands off it by more than 3 cm
        // (the low tier's top is simplified to a fifth, so its band may touch the cloth and stand a little farther off it)
        expect(worst.bind[0], `closest ${worst.bind[0]}`).toBeGreaterThan(tier ? 0 : 0.001);
        expect(worst.bind[1], `farthest ${worst.bind[1]}`).toBeLessThan(tier ? 0.012 : 0.009);
        expect(worst.pose).toBeLessThan(0.03);
      }, 120000);
    }
  }
});
