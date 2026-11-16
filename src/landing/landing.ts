// The landing page (bare `/`): a dark hero that says what walkthru does for a builder, with the featured building drawn from its own
// files (hero-model.ts, hero-canvas.ts), then the "Projects" band, which holds the gallery of buildings and homes exactly as the
// start page draws it (src/start/start.ts renders into the band). No three.js here: the walk is its own lazy chunk.
import './landing.css';
import { BRAND_MARK } from '../brand/mark';
import { fetchBuilding, fetchScene } from '../building/load';
import type { SceneInfo } from '../building/load';
import { buildingUrl } from '../building/url';
import { FEATURED_BUILDING_ID, contactHref } from './config';
import { buildHeroBuilding } from './hero-building';
import { buildHeroModel, heroSceneIds } from './hero-model';
import { mountHeroArt } from './hero-canvas';

export const LANDING_TITLE = 'walkthru · We make your project impossible to ignore';
export const PROJECTS_ID = 'projects';
export const HOW_ID = 'how-it-works';
const HERO_THEME = '#17110E';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// three small line icons for the facts strip (fixed drawings, no page text)
const ICON = {
  ruler: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 16.5 16.5 3 21 7.5 7.5 21zM7 12.5l2 2M10 9.5l2 2M13 6.5l2 2"/></svg>',
  brand: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20V9l8-5 8 5v11zM9 20v-6h6v6M9 10.5h6"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></svg>',
};
const UNDERLINE = '<svg class="wl-stroke" viewBox="0 0 600 22" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M5 10.5C96 4.200 214 3.100 318 5.200 420 7.200 512 6.400 595 4.800 486 9.600 372 11.800 246 16.500"/></svg>';

/** "What you get": real pictures of the product (public/landing, captured from the running app by tools/landing-shots). */
const SHOTS: { file: string; w: number; h: number; title: string; text: string; alt: string; wide?: boolean }[] = [
  { file: 'brand', w: 1280, h: 800, wide: true, title: 'Your brand, not ours', text: 'Your logo, your colour and your project’s name on every screen. Ours can be a small credit, or off.', alt: 'The entrance lobby in the 3D walk. The card at the top left carries a demonstration developer’s logo and name, and the buttons are in its colour.' },
  { file: 'tour', w: 1280, h: 800, wide: true, title: 'A guided tour', text: 'One tap, and the home is walked room by room, each room named as you arrive.', alt: 'A furnished room in the 3D walk during the tour, with the tour’s card naming the room.' },
  { file: 'doll', w: 1120, h: 700, title: 'Doll house', text: 'The whole flat from above with the ceiling off, furniture and all.', alt: 'A furnished flat seen from above as a doll house, every room open.' },
  { file: 'plan', w: 1280, h: 800, title: 'Plan view', text: 'The floor plan with room names and sizes, one tap from the walk.', alt: 'The floor plan of a flat with room names and sizes.' },
  { file: 'map', w: 1440, h: 900, title: 'The whole building', text: 'Every level and every flat on one map. Pick a place and walk in.', alt: 'The building’s map page: its levels, and the plan of one level with its four flats.' },
  { file: 'pool', w: 1280, h: 800, title: 'Clubhouse and pool', text: 'The amenities are walked like any room: the pool deck, the gym, the halls.', alt: 'The pool deck of the clubhouse level in the 3D walk.' },
  { file: 'materials', w: 1280, h: 800, title: 'Realistic materials', text: 'Wood, stone and fabric from photographed material maps.', alt: 'A kitchen in the 3D walk with photographed wood and stone materials.' },
  { file: 'clean', w: 1600, h: 900, title: 'Made for the sales-room screen', text: 'On a big screen the controls step away, and the home is the picture.', alt: 'A living room filling the screen with the controls hidden.' },
];

export interface Landing {
  /** the dark hero: made once and kept, so its picture does not start again when the list below is redrawn */
  hero: HTMLElement;
  /** "How it works" and "What you get", between the hero and the band (made once) */
  story: HTMLElement;
  /** the closing band under the projects (made once) */
  closing: HTMLElement;
  /** a fresh "Projects" band for the gallery to render into */
  band(): HTMLElement;
  /** call after the band is in the page: follows `/#projects` */
  settle(root: HTMLElement): void;
}

export function createLanding(go: (url: string) => void): Landing {
  const tower = buildingUrl({ building: FEATURED_BUILDING_ID, space: null });
  const spa = (a: HTMLAnchorElement): void => {
    a.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(a.getAttribute('href') ?? '/');
    });
  };

  const hero = h('header', 'wl-hero');
  hero.dataset.testid = 'landing-hero';

  const nav = h('nav', 'wl-nav', undefined, hero);
  nav.setAttribute('aria-label', 'walkthru');
  const brand = h('span', 'wt-brand', undefined, nav);
  brand.innerHTML = `${BRAND_MARK}<span>walkthru</span>`; // a fixed string from src/brand/mark.ts
  const contact = contactHref();
  const navEnd = h('div', 'wl-nav-end', undefined, nav);
  if (contact) {
    const talk = h('a', 'wl-navlink', 'Talk to us', navEnd);
    talk.href = contact;
    talk.dataset.testid = 'landing-contact';
  }
  const navBtn = h('a', 'wl-navbtn', 'Walk a project', navEnd);
  navBtn.href = tower;
  navBtn.dataset.testid = 'landing-nav-walk';
  spa(navBtn);

  const grid = h('div', 'wl-grid', undefined, hero);
  const copy = h('div', 'wl-copy wl-copy-top', undefined, grid);
  h('p', 'wl-label', 'White-labelled 3D walkthroughs for real-estate developers', copy);
  const h1 = h('h1', undefined, undefined, copy);
  h('span', 'wl-line', 'We make your project', h1);
  h1.appendChild(document.createTextNode(' '));
  const em = h('span', 'wl-line wl-em', undefined, h1);
  h('span', undefined, 'impossible to ignore', em);
  em.insertAdjacentHTML('beforeend', UNDERLINE);

  // the building stands between the headline and the paragraph on a phone, and beside both on a wide screen
  const art = h('div', 'wl-art', undefined, grid);
  art.dataset.testid = 'landing-art';
  const hint = h('p', 'wl-hint', 'Drag to rotate', art);
  hint.setAttribute('aria-hidden', 'true');

  const more = h('div', 'wl-copy wl-copy-more', undefined, grid);
  h('p', 'wl-lead', 'We turn your project’s drawings and brochure into a building your buyers can walk through, under your own brand. AI reads the plans and our team assembles and checks every floor, so a buyer can picture their home before it exists and your sales team can show it instead of describing it.', more);
  const actions = h('div', 'wl-actions', undefined, more);
  const primary = h('a', 'wl-btn is-primary', 'Walk a sample project', actions);
  primary.href = tower;
  primary.dataset.testid = 'landing-walk';
  spa(primary);
  const scrollTo = (id: string) => (e: Event): void => {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  };
  const secondary = h('a', 'wl-btn', 'See how it works', actions);
  secondary.href = `#${HOW_ID}`;
  secondary.dataset.testid = 'landing-how';
  secondary.addEventListener('click', scrollTo(HOW_ID));

  void (async () => {
    try {
      const b = await fetchBuilding(FEATURED_BUILDING_ID);
      const scenes = new Map<string, SceneInfo>();
      await Promise.all(heroSceneIds(b).map(async (id) => { try { scenes.set(id, await fetchScene(id)); } catch { /* a missing space is left out of the picture */ } }));
      const model = buildHeroModel(b, scenes);
      if (model.levels.every((l) => l.spaces.length === 0)) return;
      const building = buildHeroBuilding(b, scenes, model);
      if (building.storeys.length === 0) return;
      const label = `A model of ${b.name}, ${b.levels.length} levels, being built floor by floor from its drawings. ${model.facts.map((f) => f.text).join('. ')}. Drag to turn it, or use the arrow keys; plus and minus zoom; Home puts it back.`;
      mountHeroArt(art, building, { reducedMotion: reducedMotion(), facts: model.facts, label, hint });
      art.classList.add('is-ready');
    } catch { /* the page stands without its picture */ }
  })();

  const facts = h('ul', 'wl-facts', undefined, hero);
  for (const [icon, text] of [[ICON.brand, 'Under your brand'], [ICON.ruler, 'Built from your drawings, with AI'], [ICON.link, 'Lobby to flat, clubhouse and pool in one walk']] as const) {
    const li = h('li', undefined, undefined, facts);
    li.innerHTML = icon; // a fixed drawing
    h('span', undefined, text, li);
  }
  if (!reducedMotion()) requestAnimationFrame(() => hero.classList.add('is-in'));
  else hero.classList.add('is-in', 'is-still');

  // ---- how it works, what you get
  const story = h('div', 'wl-story');
  const how = h('section', 'wl-sec', undefined, story);
  how.id = HOW_ID;
  how.setAttribute('aria-labelledby', 'wl-how-title');
  h('p', 'wl-label', 'How it works', how);
  h('h2', undefined, 'You send the drawings. We build the building.', how).id = 'wl-how-title';
  h('p', 'wl-sec-lead', 'It is a service, done for you. There is no software for your team to learn.', how);
  const steps = h('ol', 'wl-steps', undefined, how);
  for (const [title, text] of [
    ['You send the drawings and the brochure', 'Floor plans, the amenity plan and the brochure you already print. Nothing has to be redrawn for us.'],
    ['AI reads the plans, and we build and check', 'Our plan reader takes the rooms and their sizes off the drawings. Our team assembles the lobby, the lifts, every flat type and the clubhouse, and checks each floor against the plans.'],
    ['You get a link under your brand', 'Your logo, your colour, your project’s name. Put it on the screen in your sales room and on your website.'],
  ] as const) {
    const li = h('li', undefined, undefined, steps);
    h('h3', undefined, title, li);
    h('p', undefined, text, li);
  }
  const what = h('section', 'wl-sec', undefined, story);
  what.setAttribute('aria-labelledby', 'wl-what-title');
  h('p', 'wl-label', 'What you get', what);
  h('h2', undefined, 'Everything a buyer asks to see, in one walk', what).id = 'wl-what-title';
  h('p', 'wl-sec-lead', 'These are pictures of the product itself, taken from the sample project.', what);
  const shots = h('ul', 'wl-shots', undefined, what);
  for (const sh of SHOTS) {
    const li = h('li', sh.wide ? 'is-wide' : undefined, undefined, shots);
    const fig = h('figure', undefined, undefined, li);
    const img = h('img', undefined, undefined, fig);
    img.src = `/landing/${sh.file}.webp`;
    img.width = sh.w; img.height = sh.h;
    img.loading = 'lazy'; img.decoding = 'async';
    img.alt = sh.alt;
    const cap = h('figcaption', undefined, undefined, fig);
    h('h3', undefined, sh.title, cap);
    h('p', undefined, sh.text, cap);
  }

  // ---- the closing band
  const closing = h('footer', 'wl-closing');
  const cWrap = h('div', 'wl-closing-in', undefined, closing);
  const ch = h('h2', undefined, undefined, cWrap);
  h('span', 'wl-line', 'We make your project', ch);
  ch.appendChild(document.createTextNode(' '));
  h('span', 'wl-line', 'impossible to ignore', ch);
  h('p', 'wl-lead', 'Walk the sample tower: the lobby, the lift, a flat and the pool, carrying a demonstration brand where yours would be.', cWrap);
  const cActions = h('div', 'wl-actions', undefined, cWrap);
  const again = h('a', 'wl-btn is-primary', 'Walk a sample project', cActions);
  again.href = tower;
  again.dataset.testid = 'landing-walk-closing';
  spa(again);
  if (contact) {
    const talk = h('a', 'wl-btn', 'Talk to us', cActions);
    talk.href = contact;
    talk.dataset.testid = 'landing-contact-closing';
  }
  const foot = h('p', 'wl-foot', undefined, closing);
  const fb = h('span', 'wt-brand', undefined, foot);
  fb.innerHTML = `${BRAND_MARK}<span>walkthru</span>`; // a fixed string from src/brand/mark.ts
  h('span', undefined, 'White-labelled 3D walkthroughs for real-estate developers', foot);

  return {
    hero,
    story,
    closing,
    band() {
      const band = h('section', 'wl-projects');
      band.id = PROJECTS_ID;
      band.dataset.testid = 'landing-projects-band';
      band.setAttribute('aria-labelledby', 'wl-projects-title');
      const head = h('div', 'wl-projects-head', undefined, band);
      const title = h('h2', undefined, 'Projects', head);
      title.id = 'wl-projects-title';
      h('p', undefined, 'Sample projects you can open and walk right now.', head);
      return band;
    },
    settle(root) {
      const id = location.hash.slice(1);
      if (id === PROJECTS_ID || id === HOW_ID) document.getElementById(id)?.scrollIntoView({ block: 'start' });
      else root.scrollTop = 0;
    },
  };
}

/** The browser's bar takes the hero's colour while the landing page is up, and the paper colour everywhere else. */
export function setLandingTheme(on: boolean): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  if (!meta.dataset.paper) meta.dataset.paper = meta.content;
  meta.content = on ? HERO_THEME : meta.dataset.paper;
}
