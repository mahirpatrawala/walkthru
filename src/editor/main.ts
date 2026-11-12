// Owned by C5. Placeholder from C0: C5 replaces this with the page frame and step registry.
const root = document.getElementById('editor');
const scene = new URLSearchParams(location.search).get('scene') ?? '';
if (root) root.textContent = `walkthru editor scaffold${scene ? ` (scene: ${scene})` : ''}`;
