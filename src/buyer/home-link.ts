// "All homes": a small round link in the walking HUD's button column back to the start page. Kept out of hud.ts so HUD changes
// elsewhere merge cleanly. The button column is top right, clear of the room chip (top left) and the prompt stack (bottom).
const HOME_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 11.2 12 4l8 7.2"/><path d="M6 10v9.5h4.5v-5.5h3v5.5H18V10"/></svg>';

export function mountHomeLink(hudRoot: HTMLElement): () => void {
  const a = document.createElement('a');
  a.className = 'wt-btn wt-home-link';
  a.dataset.testid = 'all-homes';
  a.dataset.ui = '1';
  a.href = '/';
  a.title = 'All homes';
  a.setAttribute('aria-label', 'All homes');
  a.innerHTML = HOME_ICON;
  const sub = document.createElement('span');
  sub.className = 'wt-btn-sub';
  sub.textContent = 'All homes';
  sub.style.whiteSpace = 'nowrap';
  a.appendChild(sub);
  (hudRoot.querySelector('.wt-buttons') ?? hudRoot).appendChild(a);
  return () => a.remove();
}
