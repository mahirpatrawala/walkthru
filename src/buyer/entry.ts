// The one script index.html loads. It decides between the start page (a gallery of homes, no three.js) and the walk
// (`?scene=<id>`, which pulls in three.js and the rest as a lazy chunk). Keep this file tiny and free of heavy imports.
const scene = new URLSearchParams(location.search).get('scene')?.trim();
if (scene) void import('./main');
else void import('../start/start').then((m) => m.mountStart());
