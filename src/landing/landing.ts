// The landing page (bare `/`): a dark hero that says what walkthru does for a builder, with the featured building drawn from its own
// files (hero-model.ts, hero-canvas.ts), then the "Projects" band, which holds the gallery of buildings and homes exactly as the
// start page draws it (src/start/start.ts renders into the band). No three.js here: the walk is its own lazy chunk.
import './landing.css';
import { BRAND_MARK } from '../brand/mark';
import { fetchBuilding, fetchScene } from '../building/load';
import type { SceneInfo } from '../building/load';
import { buildingUrl } from '../building/url';
import { FEATURED_BUILDING_ID } from './config';
import { buildHeroModel, heroSceneIds } from './hero-model';
import { mountHeroArt } from './hero-canvas';

export const LANDING_TITLE = 'walkthru · We make your project impossible to ignore';
export const PROJECTS_ID = 'projects';
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
  browser: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 9.5h18M6 7.3h.01M8.6 7.3h.01"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></svg>',
};
const UNDERLINE = '<svg class="wl-stroke" viewBox="0 0 600 22" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M5 10.5C96 4.200 214 3.100 318 5.200 420 7.200 512 6.400 595 4.800 486 9.600 372 11.800 246 16.500"/></svg>';

export interface Landing {
  /** the dark hero: made once and kept, so its picture does not start again when the list below is redrawn */
  hero: HTMLElement;
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
  const navBtn = h('a', 'wl-navbtn', 'Walk a project', nav);
  navBtn.href = tower;
  navBtn.dataset.testid = 'landing-nav-walk';
  spa(navBtn);

  const grid = h('div', 'wl-grid', undefined, hero);
  const copy = h('div', 'wl-copy', undefined, grid);
  h('p', 'wl-label', 'Real-time 3D walkthroughs for real-estate projects', copy);
  const h1 = h('h1', undefined, undefined, copy);
  h('span', 'wl-line', 'We make your project', h1);
  h1.appendChild(document.createTextNode(' '));
  const em = h('span', 'wl-line wl-em', undefined, h1);
  h('span', undefined, 'impossible to ignore', em);
  em.insertAdjacentHTML('beforeend', UNDERLINE);
  h('p', 'wl-lead', 'For builders’ sales rooms and websites. We build your whole project from your drawings, so a buyer can walk from the lobby to their own flat. It runs in any browser, with no app to install.', copy);
  const actions = h('div', 'wl-actions', undefined, copy);
  const primary = h('a', 'wl-btn is-primary', 'Walk a sample project', actions);
  primary.href = tower;
  primary.dataset.testid = 'landing-walk';
  spa(primary);
  const secondary = h('a', 'wl-btn', 'See the projects', actions);
  secondary.href = `#${PROJECTS_ID}`;
  secondary.dataset.testid = 'landing-projects';
  secondary.addEventListener('click', (e) => {
    const band = document.getElementById(PROJECTS_ID);
    if (!band) return;
    e.preventDefault();
    band.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${PROJECTS_ID}`);
  });

  const art = h('div', 'wl-art', undefined, grid);
  art.dataset.testid = 'landing-art';
  void (async () => {
    try {
      const b = await fetchBuilding(FEATURED_BUILDING_ID);
      const scenes = new Map<string, SceneInfo>();
      await Promise.all(heroSceneIds(b).map(async (id) => { try { scenes.set(id, await fetchScene(id)); } catch { /* a missing space is left out of the picture */ } }));
      const model = buildHeroModel(b, scenes);
      if (model.levels.every((l) => l.spaces.length === 0)) return;
      const summary = model.facts.map((f) => f.text).join('. ');
      art.setAttribute('role', 'img');
      art.setAttribute('aria-label', `A line drawing of ${b.name}, its ${b.levels.length} levels stacked. ${summary}.`);
      mountHeroArt(art, model, { reducedMotion: reducedMotion() });
      art.classList.add('is-ready');
    } catch { /* the page stands without its picture */ }
  })();

  const facts = h('ul', 'wl-facts', undefined, hero);
  for (const [icon, text] of [[ICON.ruler, 'Sizes from your drawings'], [ICON.browser, 'Runs in the browser, no install'], [ICON.link, 'Flats, lobby, clubhouse and pool in one link']] as const) {
    const li = h('li', undefined, undefined, facts);
    li.innerHTML = icon; // a fixed drawing
    h('span', undefined, text, li);
  }
  if (!reducedMotion()) requestAnimationFrame(() => hero.classList.add('is-in'));
  else hero.classList.add('is-in', 'is-still');

  return {
    hero,
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
      if (location.hash === `#${PROJECTS_ID}`) document.getElementById(PROJECTS_ID)?.scrollIntoView({ block: 'start' });
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
