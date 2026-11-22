// "3D model credits": the visible attribution CC BY 4.0 asks for (src/look/credits.ts reads every lock file of the build). A small link at the foot
// of the identity card (top left; it is there whenever the card is), and a sheet that lists each asset with its title, author, source and
// licence. Quiet by design: nothing shows until the card is opened, and the sheet only when asked.
import { creditLine, isAttribution, loadCredits } from '../look/credits';
import type { Credit } from '../look/credits';

const CSS = `
.wt-credits-link { order: 10; align-self: flex-start; margin: calc(6 * var(--wt-u, 1px)) 0 0; padding: 0; border: 0; background: none; color: var(--wt-glass-faint, rgba(255,255,255,.7));
  font: inherit; font-size: calc(11 * var(--wt-u, 1px)); font-weight: 500; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; pointer-events: auto; }
.wt-credits-link:hover { color: var(--wt-glass-text, #fff); }
.wt-credits { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(10, 12, 16, 0.45); pointer-events: auto; }
.wt-credits[hidden] { display: none; }
.wt-credits-card { width: min(640px, 100%); max-height: min(80vh, 720px); display: flex; flex-direction: column; border-radius: 14px; background: #FBFAF7; color: #1D1F23;
  box-shadow: 0 18px 50px rgba(0,0,0,.35); font-family: var(--wt-font, system-ui, sans-serif); }
.wt-credits-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 10px; border-bottom: 1px solid #E6E2DA; }
.wt-credits-head h2 { margin: 0; font-size: 16px; font-weight: 650; }
.wt-credits-x { width: 36px; height: 36px; border: 0; border-radius: 18px; background: #EFECE6; color: #1D1F23; font-size: 18px; line-height: 1; cursor: pointer; }
.wt-credits-body { overflow: auto; padding: 10px 18px 16px; font-size: 13px; line-height: 1.45; }
.wt-credits-body p { margin: 6px 0 10px; color: #555A63; }
.wt-credits-body h3 { margin: 14px 0 6px; font-size: 13px; font-weight: 650; }
.wt-credits-body ul { margin: 0; padding: 0 0 0 18px; }
.wt-credits-body li { margin: 0 0 6px; overflow-wrap: anywhere; }
.wt-credits-body a { color: #1F5FA8; }
.wt-credits-lic { color: #555A63; }
`;

function ensureCss(doc: Document): void {
  if (doc.getElementById('wt-credits-css')) return;
  const s = doc.createElement('style');
  s.id = 'wt-credits-css';
  s.textContent = CSS;
  doc.head.appendChild(s);
}

function item(doc: Document, c: Credit): HTMLLIElement {
  const li = doc.createElement('li');
  li.dataset.testid = 'credit';
  li.title = creditLine(c);
  const a = doc.createElement('a');
  a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.textContent = c.title;
  li.append(a, doc.createTextNode(` by ${c.author}. `));
  const lic = doc.createElement('span');
  lic.className = 'wt-credits-lic';
  if (c.licenceUrl) {
    const la = doc.createElement('a');
    la.href = c.licenceUrl; la.target = '_blank'; la.rel = 'noopener noreferrer';
    la.textContent = c.licence;
    lic.append(la);
  } else lic.textContent = c.licence;
  li.append(lic);
  return li;
}

/** Fills the sheet's body with the credits: the CC BY assets (credit required), then the CC0 ones (no credit needed, listed anyway). */
export function renderCredits(body: HTMLElement, list: Credit[]): void {
  const doc = body.ownerDocument;
  body.textContent = '';
  const intro = doc.createElement('p');
  intro.textContent = 'Some furniture, fittings and materials in this walkthrough are free 3D models and textures by other artists, adapted (resized to the drawn sizes, simplified, recoloured). Sizes always come from the drawing.';
  body.append(intro);
  const groups: [string, Credit[]][] = [
    ['Creative Commons Attribution (CC BY)', list.filter((c) => isAttribution(c.licence))],
    ['Public domain (CC0) and other free assets', list.filter((c) => !isAttribution(c.licence))],
  ];
  for (const [title, cs] of groups) {
    if (cs.length === 0) continue;
    const h = doc.createElement('h3');
    h.textContent = `${title} (${cs.length})`;
    const ul = doc.createElement('ul');
    for (const c of cs) ul.append(item(doc, c));
    body.append(h, ul);
  }
  if (list.length === 0) {
    const p = doc.createElement('p');
    p.textContent = 'No downloaded assets are listed in this build.';
    body.append(p);
  }
}

/** Puts the link in the identity card (or the HUD root when there is none) and wires the sheet. Returns the remover. */
export function mountCreditsLink(hudRoot: HTMLElement, load: () => Promise<Credit[]> = () => loadCredits()): () => void {
  const doc = hudRoot.ownerDocument;
  ensureCss(doc);
  const link = doc.createElement('button');
  link.type = 'button';
  link.className = 'wt-credits-link';
  link.dataset.testid = 'credits-link';
  link.textContent = '3D model credits';
  (hudRoot.querySelector('.wt-id') ?? hudRoot).appendChild(link);

  const sheet = doc.createElement('div');
  sheet.className = 'wt-credits';
  sheet.hidden = true;
  sheet.dataset.testid = 'credits';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '3D model credits');
  const card = doc.createElement('div');
  card.className = 'wt-credits-card';
  const head = doc.createElement('div');
  head.className = 'wt-credits-head';
  const h2 = doc.createElement('h2');
  h2.textContent = '3D model credits';
  const x = doc.createElement('button');
  x.type = 'button'; x.className = 'wt-credits-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
  head.append(h2, x);
  const body = doc.createElement('div');
  body.className = 'wt-credits-body';
  body.textContent = 'Loading…';
  card.append(head, body);
  sheet.append(card);
  doc.body.appendChild(sheet);

  let loaded: Promise<void> | null = null;
  const close = (): void => { sheet.hidden = true; link.focus(); };
  const open = (): void => {
    sheet.hidden = false;
    x.focus();
    loaded ??= load().then((list) => renderCredits(body, list), () => { body.textContent = 'The credits could not be loaded.'; loaded = null; });
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !sheet.hidden) { e.stopPropagation(); close(); } };
  link.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  x.addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  // keys pressed in the sheet are not walking keys
  sheet.addEventListener('keydown', (e) => e.stopPropagation());
  doc.addEventListener('keydown', onKey, true);
  return () => { doc.removeEventListener('keydown', onKey, true); link.remove(); sheet.remove(); };
}
