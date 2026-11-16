// "All homes": the link in the HUD's top right corner back to the start page (a lone home; a building has its own "Building" button there).
// Kept out of hud.ts so HUD changes elsewhere merge cleanly.
const HOME_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 11.2 12 4l8 7.2"/><path d="M6 10v9.5h4.5v-5.5h3v5.5H18V10"/></svg>';

export function mountHomeLink(hudRoot: HTMLElement, label = 'All homes'): () => void {
  const a = document.createElement('a');
  a.className = 'wt-btn wt-home-link';
  a.dataset.testid = 'all-homes';
  a.dataset.ui = '1';
  a.href = '/';
  a.title = label;
  a.setAttribute('aria-label', label);
  a.innerHTML = HOME_ICON;
  const text = document.createElement('span');
  text.className = 'wt-tool-label';
  text.textContent = label;
  a.appendChild(text);
  (hudRoot.querySelector('.wt-exit') ?? hudRoot).appendChild(a);
  return () => a.remove();
}
