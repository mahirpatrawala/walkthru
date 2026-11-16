// The lift's floor panel: every level the lift serves with what is on it, the one you are on marked. Choosing one rides the lift there.
import './building.css';
import type { BuildingFile, Lift } from './types';

export interface LiftPanel { close(): void }

export function openLiftPanel(parent: HTMLElement, o: { building: BuildingFile; lift: Lift; here: string; onChoose(levelId: string): void; onClose(): void }): LiftPanel {
  const back = document.createElement('div');
  back.className = 'wb-lift-back';
  back.dataset.ui = '1';
  back.dataset.testid = 'lift-panel';
  const card = document.createElement('div');
  card.className = 'wb-lift';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `${o.lift.name}: choose a floor`);
  back.appendChild(card);
  const head = document.createElement('div');
  head.className = 'wb-lift-head';
  const h2 = document.createElement('h2');
  h2.textContent = `${o.lift.name}: which floor?`;
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'wb-lift-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Close');
  head.append(h2, x);
  const sub = document.createElement('p');
  sub.className = 'wb-lift-sub';
  sub.textContent = `Car ${o.lift.car.widthM.toFixed(1)} × ${o.lift.car.depthM.toFixed(1)} m, door ${o.lift.car.doorM.toFixed(1)} m.`;
  card.append(head, sub);
  const served = o.building.levels.filter((l) => o.lift.serves.includes(l.id)).reverse();
  for (const lv of served) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'wb-floor'; b.dataset.level = lv.id;
    const num = document.createElement('span'); num.className = 'wb-floor-num'; num.textContent = lv.short;
    const txt = document.createElement('span'); txt.className = 'wb-floor-text';
    const name = document.createElement('span'); name.className = 'wb-floor-name'; name.textContent = lv.label;
    const sum = document.createElement('span'); sum.className = 'wb-floor-sum'; sum.textContent = lv.summary;
    txt.append(name, sum);
    b.append(num, txt);
    if (lv.id === o.here) { b.disabled = true; const here = document.createElement('span'); here.className = 'wb-floor-here'; here.textContent = 'You are here'; b.appendChild(here); }
    b.addEventListener('click', () => { if (lv.id !== o.here) { close(); o.onChoose(lv.id); } });
    card.appendChild(b);
  }
  let open = true;
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); o.onClose(); } };
  function close(): void {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey, true);
    back.remove();
  }
  window.addEventListener('keydown', onKey, true);
  x.addEventListener('click', () => { close(); o.onClose(); });
  back.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  back.addEventListener('click', (e) => { if (e.target === back) { close(); o.onClose(); } });
  parent.appendChild(back);
  (card.querySelector('.wb-floor:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
  return { close };
}
