// Owned by C3. Placeholder "empty app shell" from C0: builds a viewer inline. C3 replaces this file
// (the real viewer comes from engine/viewer.ts). Not browser-verified.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { PropertyFile } from '../types';

const params = new URLSearchParams(location.search);
const sceneId = params.get('scene') ?? 'test-flat-empty';
const container = document.getElementById('app') ?? document.body;
const msg = document.getElementById('msg');

async function loadProperty(): Promise<PropertyFile | null> {
  try {
    const res = await fetch(`/scenes/${sceneId}/property.json`);
    if (!res.ok) return null;
    return (await res.json()) as PropertyFile;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const property = await loadProperty();
  const splat = property?.splat;

  // Spark needs antialias off; plain scenes keep it on.
  const renderer = new THREE.WebGLRenderer({ antialias: !splat });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef0f3');
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(2, 3, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(2, 1, 2.5);
  controls.update();

  if (splat) {
    const spark = new SparkRenderer({ renderer });
    scene.add(spark);
    const mesh = new SplatMesh({ url: `/scenes/${sceneId}/${splat.file}` });
    const t = splat.transform;
    mesh.quaternion.set(t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3]);
    mesh.scale.setScalar(t.scale);
    mesh.position.set(t.position[0], t.position[1], t.position[2]);
    scene.add(mesh);
    if (msg) msg.textContent = `walkthru scaffold · scan overlay (${sceneId})`;
  } else {
    scene.add(new THREE.GridHelper(20, 20, 0x2f6bff, 0xb0b6c0));
    if (msg) msg.textContent = 'walkthru scaffold';
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  if (msg) msg.textContent = `walkthru scaffold (error: ${String(err)})`;
});
