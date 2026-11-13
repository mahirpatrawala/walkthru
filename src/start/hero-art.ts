// The start page's hero picture: a stylised isometric flat in warm light, drawn here as inline SVG (no image file, no image model,
// no three.js, so the start page stays fast). A sofa under a sunny window, a bed, a rug, a tulsi plant, a walker on a dashed
// path from the door, and a measuring line: "sizes from the floor plan". Everything is generated from a few boxes and planes.
// Decorative only: the SVG is aria-hidden and carries no claim about any real home.

const S = 46;                 // pixels per metre-ish unit
const OX = 232, OY = 150;     // screen position of the room's back corner on the floor
const COS = 0.866, SIN = 0.5;

/** Isometric projection: x runs right and down, y runs left and down, z is up. */
const P = (x: number, y: number, z: number): [number, number] => [OX + (x - y) * COS * S, OY + (x + y) * SIN * S - z * S];
const pts = (list: [number, number][]): string => list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
const poly = (list: [number, number, number][], fill: string, extra = ''): string => `<polygon points="${pts(list.map(([x, y, z]) => P(x, y, z)))}" fill="${fill}" ${extra}/>`;

/** Lighter above 1 (towards white), darker below 1 (towards a warm brown, so shade stays warm instead of going grey). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const dark = [122, 74, 46];
  const c = (v: number, i: number): number => Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f + dark[i] * (1 - f) * 0.45);
  return `#${rgb.map((v, i) => Math.max(0, Math.min(255, c(v, i))).toString(16).padStart(2, '0')).join('')}`;
}

/** A box: its top, its +y face (lit by the window) and its +x face (in shade). */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, fill: string): string {
  return (
    poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], shade(fill, 0.95)) +
    poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], shade(fill, 0.78)) +
    poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], shade(fill, 1.1))
  );
}

/** a rectangle on the wall plane y = c (u along x, v up) */
const wallY = (c: number, u0: number, u1: number, v0: number, v1: number, fill: string, extra = ''): string => poly([[u0, c, v0], [u1, c, v0], [u1, c, v1], [u0, c, v1]], fill, extra);
/** a rectangle on the wall plane x = c (u along y, v up) */
const wallX = (c: number, u0: number, u1: number, v0: number, v1: number, fill: string, extra = ''): string => poly([[c, u0, v0], [c, u1, v0], [c, u1, v1], [c, u0, v1]], fill, extra);
const ring = (cx: number, cz: number, c: number, r: number, fill: string, n = 24): string =>
  poly(Array.from({ length: n }, (_, i): [number, number, number] => [cx + Math.cos((i / n) * Math.PI * 2) * r, c, cz + Math.sin((i / n) * Math.PI * 2) * r]), fill);

export function heroSvg(): string {
  const W = 7.2, D = 5.0, H = 2.7, T = 0.24;
  const out: string[] = [];
  const add = (s: string): void => { out.push(s); };

  // the sky behind: a soft arch, a low sun, a few dots
  add('<defs>' +
    '<linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFE3E2"/><stop offset="1" stop-color="#FBEBC6"/></linearGradient>' +
    '<linearGradient id="hs-beam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE3A1" stop-opacity=".7"/><stop offset="1" stop-color="#FFE3A1" stop-opacity=".12"/></linearGradient>' +
    '</defs>');
  add('<path d="M44 452V238a236 236 0 0 1 472 0V452z" fill="#F6DDD2" opacity=".6"/>');
  add('<path d="M70 452V240a210 210 0 0 1 420 0V452z" fill="#FAEBC8" opacity=".75"/>');
  add('<circle cx="468" cy="92" r="26" fill="#E3A33A"/><circle cx="468" cy="92" r="38" fill="none" stroke="#E3A33A" stroke-width="2" opacity=".5" stroke-dasharray="3 7"/>');
  for (const [x, y, r] of [[78, 150, 3], [96, 118, 2], [520, 190, 2.5], [44, 250, 2]] as const) add(`<circle cx="${x}" cy="${y}" r="${r}" fill="#B2472B" opacity=".5"/>`);

  // floor slab and floor
  add(poly([[0, D, 0], [W, D, 0], [W, D, -0.34], [0, D, -0.34]], '#B98550'));
  add(poly([[W, 0, 0], [W, D, 0], [W, D, -0.34], [W, 0, -0.34]], '#9C6B3D'));
  add(poly([[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], '#EBD0A2'));
  for (let i = 1; i < 9; i++) {
    const x = (W * i) / 9;
    add(`<polyline points="${pts([P(x, 0, 0), P(x, D, 0)])}" stroke="#D9B887" stroke-width="1" fill="none"/>`);
  }
  for (let j = 1; j < 6; j++) {
    const y = (D * j) / 6;
    add(`<polyline points="${pts([P(0, y, 0), P(W, y, 0)])}" stroke="#D9B887" stroke-width="1" fill="none"/>`);
  }

  // the two back walls, inside faces to us
  add(box(0, W, 0, T, 0, H, '#F6E4C6'));
  add(box(0, T, T, D, 0, H, '#FBE9CB'));
  // dado band along the bottom of both walls
  add(wallY(T, T, W, 0, 0.1, '#C9955E'));
  add(wallX(T, T, D, 0, 0.1, '#B8844F'));

  // the window on the sofa wall, with morning light falling across the floor
  const wx0 = 1.0, wx1 = 3.6, wz0 = 0.95, wz1 = 2.3;
  add(poly([[wx0 + 0.1, T, 0], [wx1 + 0.1, T, 0], [wx1 + 1.9, T + 2.9, 0], [wx0 + 1.9, T + 2.9, 0]], 'url(#hs-beam)'));
  add(wallY(T, wx0, wx1, wz0, wz1, 'url(#hs-sky)'));
  add(poly([[wx0 + 0.25, T, 1.25], [wx0 + 0.6, T, 1.62], [wx0 + 0.95, T, 1.25]], '#9DC9C6'));
  add(ring(wx1 - 0.55, wz1 - 0.42, T, 0.2, '#F4B24D'));
  add(`<polyline points="${pts([P(wx0, T, wz0), P(wx1, T, wz0), P(wx1, T, wz1), P(wx0, T, wz1), P(wx0, T, wz0)])}" stroke="#7B4A2B" stroke-width="3" fill="none" stroke-linejoin="round"/>`);
  add(`<polyline points="${pts([P((wx0 + wx1) / 2, T, wz0), P((wx0 + wx1) / 2, T, wz1)])}" stroke="#7B4A2B" stroke-width="2.4" fill="none"/>`);
  // curtains, open, with folds
  for (const [c0, c1] of [[0.62, 1.12], [3.5, 4.0]] as const) {
    add(wallY(T + 0.06, c0, c1, 0.12, 2.5, '#C4623F'));
    for (let k = 1; k < 4; k++) add(`<polyline points="${pts([P(c0 + ((c1 - c0) * k) / 4, T + 0.06, 0.12), P(c0 + ((c1 - c0) * k) / 4, T + 0.06, 2.5)])}" stroke="#A8502F" stroke-width="1.3" fill="none"/>`);
  }
  add(`<polyline points="${pts([P(0.5, T + 0.08, 2.5), P(4.12, T + 0.08, 2.5)])}" stroke="#7B4A2B" stroke-width="3" stroke-linecap="round" fill="none"/>`);

  // the door and a picture on the short wall
  add(wallX(T, 1.35, 2.45, 0, 2.15, '#FFF1D2'));
  add(wallX(T + 0.04, 1.35, 2.45, 0, 2.15, '#1E6B73', 'opacity=".96"'));
  add(wallX(T + 0.05, 1.45, 2.35, 1.25, 2.05, '#17545B'));
  add(poly([[T + 0.07, 2.28, 1.0], [T + 0.07, 2.36, 1.0], [T + 0.07, 2.36, 1.08], [T + 0.07, 2.28, 1.08]], '#E3A33A'));
  add(wallX(T, 3.1, 4.3, 1.35, 2.25, '#7A4B2A'));
  add(wallX(T + 0.02, 3.17, 4.23, 1.42, 2.18, '#F7E2B8'));
  add(poly([[T + 0.03, 3.17, 1.42], [T + 0.03, 4.23, 1.42], [T + 0.03, 4.23, 1.72], [T + 0.03, 3.9, 1.84], [T + 0.03, 3.6, 1.7], [T + 0.03, 3.3, 1.8]], '#2E7D84'));
  add(poly(Array.from({ length: 16 }, (_, i): [number, number, number] => [T + 0.04, 3.62 + Math.cos((i / 16) * 6.283) * 0.17, 1.95 + Math.sin((i / 16) * 6.283) * 0.17]), '#E8793A'));
  // a clock above the bed
  add(ring(5.55, 2.0, T, 0.3, '#3B2A20'));
  add(ring(5.55, 2.0, T + 0.01, 0.26, '#FFF6E6'));
  add(`<polyline points="${pts([P(5.55, T + 0.02, 2.0), P(5.55, T + 0.02, 2.2), ])}" stroke="#2A2724" stroke-width="2.2" stroke-linecap="round" fill="none"/>`);
  add(`<polyline points="${pts([P(5.55, T + 0.02, 2.0), P(5.7, T + 0.02, 1.93)])}" stroke="#2A2724" stroke-width="2.2" stroke-linecap="round" fill="none"/>`);

  // a dhurrie rug
  add(poly([[1.1, 1.3, 0.012], [3.9, 1.3, 0.012], [3.9, 3.7, 0.012], [1.1, 3.7, 0.012]], '#C4623F'));
  add(poly([[1.22, 1.42, 0.014], [3.78, 1.42, 0.014], [3.78, 3.58, 0.014], [1.22, 3.58, 0.014]], '#F4E6CB'));
  add(poly([[1.36, 1.56, 0.016], [3.64, 1.56, 0.016], [3.64, 3.44, 0.016], [1.36, 3.44, 0.016]], '#2E7D84'));
  add(poly([[2.5, 1.85, 0.018], [3.2, 2.5, 0.018], [2.5, 3.15, 0.018], [1.8, 2.5, 0.018]], '#E3A33A', 'opacity=".9"'));

  // bed, headboard on the long wall, with a striped throw
  add(box(4.5, 6.5, T, T + 2.15, 0, 0.36, '#A8683A'));
  add(box(4.5, 6.5, T, T + 0.14, 0.36, 1.2, '#8A5530'));
  add(box(4.56, 6.44, T + 0.14, T + 2.1, 0.36, 0.6, '#FBF3E4'));
  add(box(4.7, 5.42, T + 0.2, T + 0.72, 0.6, 0.74, '#FFFFFF'));
  add(box(5.58, 6.3, T + 0.2, T + 0.72, 0.6, 0.74, '#FFFFFF'));
  add(box(4.56, 6.44, T + 1.25, T + 2.1, 0.6, 0.66, '#B2472B'));
  add(poly([[4.56, T + 1.55, 0.665], [6.44, T + 1.55, 0.665], [6.44, T + 1.68, 0.665], [4.56, T + 1.68, 0.665]], '#E3A33A'));
  add(box(4.8, 5.2, T + 0.5, T + 0.86, 0.74, 1.02, '#2E7D84'));
  // bedside table and lamp
  add(box(6.62, 7.05, T, T + 0.5, 0, 0.5, '#F7EFE0'));
  add(box(6.78, 6.9, T + 0.18, T + 0.3, 0.5, 0.78, '#C79A3C'));
  add(box(6.7, 6.98, T + 0.1, T + 0.38, 0.78, 1.04, '#FFE6A8'));

  // sofa under the window: seat, back, arms, cushions
  add(box(1.15, 3.55, T, T + 0.3, 0, 1.0, '#2B7F88'));
  add(box(1.15, 3.55, T + 0.3, T + 1.0, 0, 0.46, '#2B7F88'));
  add(box(1.15, 1.4, T + 0.3, T + 1.0, 0.46, 0.7, '#236A72'));
  add(box(3.3, 3.55, T + 0.3, T + 1.0, 0.46, 0.7, '#236A72'));
  add(box(1.55, 2.0, T + 0.42, T + 0.7, 0.46, 0.86, '#C4623F'));
  add(box(2.9, 3.28, T + 0.42, T + 0.7, 0.46, 0.8, '#E3A33A'));
  // low table on the rug, with a brass tray
  add(box(1.4, 2.5, 2.1, 2.8, 0.28, 0.34, '#8A5530'));
  for (const [x, y] of [[1.45, 2.15], [2.4, 2.15], [1.45, 2.7], [2.4, 2.7]] as const) add(box(x, x + 0.06, y, y + 0.06, 0, 0.28, '#6B4226'));
  add(box(1.7, 2.2, 2.3, 2.6, 0.34, 0.37, '#C79A3C'));

  // a tulsi in a terracotta pot by the short wall
  const [px, py] = P(0.75, 3.7, 0);
  add(`<ellipse cx="${px}" cy="${py + 4}" rx="22" ry="9" fill="#000" opacity=".12"/>`);
  add(`<path d="M${px - 15} ${py - 28}h30l-5 28h-20z" fill="#B5573A"/><ellipse cx="${px}" cy="${py - 28}" rx="15" ry="5" fill="#C96B4B"/>`);
  for (const [dx, dy, r, c] of [[-9, -52, 15, '#3F7D3A'], [9, -56, 15, '#5A9A47'], [0, -70, 16, '#2F6A35'], [-14, -68, 12, '#6BA84F'], [14, -70, 12, '#3F7D3A']] as const) add(`<circle cx="${px + dx}" cy="${py + dy}" r="${r}" fill="${c}"/>`);

  // the walk: a dashed path from the door and a walker on the rug
  add(`<polyline points="${pts([P(T + 0.15, 1.9, 0.03), P(1.4, 1.9, 0.03), P(2.6, 3.3, 0.03), P(3.7, 3.65, 0.03)])}" stroke="#B2472B" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" fill="none"/>`);
  const [wx, wy] = P(4.1, 3.75, 0);
  add(`<ellipse cx="${wx}" cy="${wy + 2}" rx="17" ry="7" fill="#000" opacity=".16"/>`);
  add(`<path d="M${wx - 7} ${wy - 34}l-1 34h6l3-30 3 30h6l-1-34z" fill="#26324F"/>`);
  add(`<path d="M${wx - 11} ${wy - 66}q11-6 22 0l2 32h-26z" fill="#E8793A"/>`);
  add(`<path d="M${wx - 13} ${wy - 62}l-6 24 6 1 5-20zM${wx + 13} ${wy - 62}l6 24-6 1-5-20z" fill="#D9693A"/>`);
  add(`<circle cx="${wx}" cy="${wy - 76}" r="8.5" fill="#B27849"/><path d="M${wx - 9} ${wy - 78}q1-10 9-10t9 10q-8-4-18 0z" fill="#2B211C"/>`);

  // the measuring line along the front edge: sizes come from the plan
  const [a0x, a0y] = P(0, D + 0.55, 0), [a1x, a1y] = P(W, D + 0.55, 0);
  add(`<line x1="${a0x}" y1="${a0y}" x2="${a1x}" y2="${a1y}" stroke="#1E6B73" stroke-width="2.4" stroke-linecap="round"/>`);
  for (const [tx, ty] of [[a0x, a0y], [a1x, a1y]] as const) add(`<line x1="${tx - 7}" y1="${ty - 4}" x2="${tx + 7}" y2="${ty + 4}" stroke="#1E6B73" stroke-width="2.4" stroke-linecap="round"/>`);
  const mx = (a0x + a1x) / 2, my = (a0y + a1y) / 2;
  add(`<g transform="translate(${mx} ${my}) rotate(30)"><rect x="-40" y="-13" width="80" height="26" rx="13" fill="#FFFDF8" stroke="#1E6B73" stroke-width="2"/><text x="0" y="6" text-anchor="middle" font-family="Bricolage Grotesque, system-ui, sans-serif" font-weight="700" font-size="15" fill="#17545B">7.2 m</text></g>`);

  return `<svg class="ws-hero-svg" viewBox="0 0 560 470" role="img" aria-label="Illustration of a flat in warm morning light, with a sofa under a window, a bed, a rug, a plant and a person walking in" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
}
