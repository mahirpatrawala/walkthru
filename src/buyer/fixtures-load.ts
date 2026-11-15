// The drawing's sanitary and kitchen fixtures, from proposal-extras.json (optional). Missing, HTML or broken means none.
import { SCENE_ID_RE } from '../start/manifest';
import { FIXTURE_PIECE } from '../core/fixtures';
import type { FixtureClass, SceneFixture } from '../core/fixtures';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The fixtures of a parsed proposal-extras.json: only records with a known class and a place, sizes only when both are positive. */
export function fixturesFromExtras(extras: unknown): SceneFixture[] {
  const list = (extras as { fixtures?: unknown } | null)?.fixtures;
  if (!Array.isArray(list)) return [];
  const out: SceneFixture[] = [];
  const seen = new Set<string>();
  for (const f of list as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object') continue;
    const cls = f.cls as FixtureClass;
    const at = f.at as { x?: unknown; z?: unknown } | undefined;
    if (typeof f.id !== 'string' || !f.id || seen.has(f.id) || !(cls in FIXTURE_PIECE) || !at || !isNum(at.x) || !isNum(at.z)) continue;
    const size = f.sizeM as { w?: unknown; d?: unknown } | undefined;
    seen.add(f.id);
    out.push({
      id: f.id, cls, at: { x: at.x, z: at.z },
      ...(size && isNum(size.w) && isNum(size.d) && size.w > 0 && size.d > 0 ? { sizeM: { w: size.w, d: size.d } } : {}),
      ...(isNum(f.yawDeg) ? { yawDeg: f.yawDeg } : {}),
    });
  }
  return out;
}

export async function fetchFixtures(sceneId: string): Promise<SceneFixture[]> {
  try {
    if (!SCENE_ID_RE.test(sceneId)) return [];
    const r = await fetch(`/scenes/${sceneId}/proposal-extras.json`, { cache: 'no-cache' });
    const t = r.ok ? await r.text() : '';
    if (t && !/^\s*</.test(t)) return fixturesFromExtras(JSON.parse(t));
  } catch { /* optional */ }
  return [];
}
