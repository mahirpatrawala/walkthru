// Share the walk view (SPEC 2.7.5): a link that reopens the same place and view. The place is already in the address (`?scene=` or
// `?building=&space=`); this adds the walker's spot and heading (`at=x,z,yaw`), the walk camera (`cam=first|third`), the view mode
// (`view=walk|doll|plan`, when the views module is there) and, for a lone home the viewer has rearranged, the existing My layout code.
// No backend: the link is the whole thing. Pure rules here; the DOM-free `shareWalk` talks to the Web Share API or the clipboard.

export type ShareCam = 'first' | 'third';
export interface ShareState {
  /** the address as it is now */
  href: string;
  /** where the walker stands (scene frame, metres) and the heading of the view, degrees */
  at: { x: number; z: number; yawDeg: number };
  cam: ShareCam;
  /** the views module's mode, when there is one */
  view?: 'walk' | 'doll' | 'plan';
  /** the My layout code, when the viewer changed the home (already encoded by `shareUrl` in my-layout.ts), else null */
  withLayout?: ((href: string) => string) | null;
  /** the set view the walker stands at (SPEC 2.10), when they stand at one */
  vp?: string | null;
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

export function buildShareUrl(s: ShareState): string {
  const u = new URL(s.href);
  u.searchParams.set('at', `${r2(s.at.x)},${r2(s.at.z)},${Math.round(((s.at.yawDeg % 360) + 360) % 360)}`);
  u.searchParams.set('cam', s.cam);
  if (s.view && s.view !== 'walk') u.searchParams.set('view', s.view); else u.searchParams.delete('view');
  if (s.vp) u.searchParams.set('vp', s.vp); else u.searchParams.delete('vp');
  // a link for someone else: not the display's own settings (a kiosk's loop, a pinned chrome, the debug switch)
  for (const k of ['debug', 'kiosk', 'idle', 'chrome', 'autohide']) u.searchParams.delete(k);
  const out = u.toString();
  return s.withLayout ? s.withLayout(out) : out;
}

export interface SharedSpot { at: { x: number; z: number; yawDeg: number } | null; cam: ShareCam | null; view: 'walk' | 'doll' | 'plan' | null }

/** Reads `at`, `cam` and `view` from a query string. Anything malformed or out of range is dropped (the walk then starts as it normally does). */
export function parseShare(search: string): SharedSpot {
  const q = new URLSearchParams(search);
  let at: SharedSpot['at'] = null;
  const m = /^(-?\d{1,4}(?:\.\d{1,3})?),(-?\d{1,4}(?:\.\d{1,3})?),(-?\d{1,4})$/.exec((q.get('at') ?? '').trim());
  if (m) {
    const x = Number(m[1]), z = Number(m[2]), yaw = Number(m[3]);
    if (Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(yaw) && Math.abs(x) < 2000 && Math.abs(z) < 2000) at = { x, z, yawDeg: ((yaw % 360) + 360) % 360 };
  }
  const cam = q.get('cam');
  const view = q.get('view');
  return { at, cam: cam === 'first' || cam === 'third' ? cam : null, view: view === 'walk' || view === 'doll' || view === 'plan' ? view : null };
}

export type ShareResult = 'shared' | 'copied' | 'failed';

/** Web Share where it exists and a finger is the pointer (a tablet), the clipboard everywhere else. */
export async function shareWalk(url: string, title: string, env: { share?: (d: { title: string; url: string }) => Promise<void>; coarse: boolean; write?: (t: string) => Promise<void> }): Promise<ShareResult> {
  if (env.share && env.coarse) {
    try { await env.share({ title, url }); return 'shared'; } catch (e) { if ((e as { name?: string })?.name === 'AbortError') return 'shared'; /* fall through to the clipboard */ }
  }
  try { if (env.write) { await env.write(url); return 'copied'; } } catch { /* fall through */ }
  return 'failed';
}

/** The page's own environment for `shareWalk`. */
export function pageShareEnv(): Parameters<typeof shareWalk>[2] {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* no matchMedia */ }
  return {
    share: nav && typeof nav.share === 'function' ? (d) => nav.share(d) : undefined,
    coarse,
    write: nav?.clipboard ? (t) => nav.clipboard.writeText(t) : undefined,
  };
}
