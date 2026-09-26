import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { M } from './manim.js';

/**
 * Renderer, camera, controls and the CSS2D label layer. From FLUX's createScene, less the number
 * plane: the P&ID is a flat schematic, so the camera looks straight down −z and rotation is locked
 * unless a lab asks for it (`orbit: true`).
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(M.bg, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(1.2, 0, 14);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = false;
  controls.target.set(1.2, 0, 0);
  controls.update();

  const labels = new CSS2DRenderer();
  labels.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labels.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  labels.domElement.id = 'label-layer';
  canvas.parentElement.appendChild(labels.domElement);

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, controls, labels };
}
