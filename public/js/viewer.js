// Interactive 3D preview for STL / 3MF files, using three.js (served from node_modules).
// If it can't load, we quietly show a message instead.
import { h, fill } from './common.js';

const CDN = '/vendor/three';
let libs;
async function loadLibs() {
  libs ||= Promise.all([
    import(`${CDN}/build/three.module.js`),
    import(`${CDN}/examples/jsm/controls/OrbitControls.js`),
    import(`${CDN}/examples/jsm/loaders/STLLoader.js`),
    import(`${CDN}/examples/jsm/loaders/3MFLoader.js`),
  ]);
  return libs;
}

/**
 * Render a model into `container`.
 * @param {HTMLElement} container
 * @param {ArrayBuffer|Promise<ArrayBuffer>} buffer
 * @param {string} filename  used to pick the loader (.stl / .3mf)
 */
export async function mountViewer(container, buffer, filename) {
  container.classList.add('viewer');
  fill(container, h('div.viewer-msg', h('span.spinner')));
  let THREE, OrbitControls, STLLoader, ThreeMFLoader;
  try {
    const [three, oc, stl, tmf] = await loadLibs();
    THREE = three; OrbitControls = oc.OrbitControls; STLLoader = stl.STLLoader; ThreeMFLoader = tmf.ThreeMFLoader;
  } catch {
    fill(container, h('div.viewer-msg', '3D preview unavailable'));
    return;
  }

  let object;
  try {
    const data = await buffer;
    if (/\.3mf$/i.test(filename)) {
      object = new ThreeMFLoader().parse(data);
      // 3MF is Z-up; rotate so it sits on the "floor".
      object.rotation.x = -Math.PI / 2;
    } else {
      const geo = new STLLoader().parse(data);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0x2f7cf6, metalness: 0.05, roughness: 0.45 });
      object = new THREE.Mesh(geo, mat);
      object.rotation.x = -Math.PI / 2;
    }
  } catch (err) {
    console.warn(err);
    fill(container, h('div.viewer-msg', 'Couldn’t read this model for preview'));
    return;
  }

  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222222 : 0xbbbbbb, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const pivot = new THREE.Group();
  pivot.add(object);
  scene.add(pivot);

  // Center and scale to a unit-ish size.
  const box = new THREE.Box3().setFromObject(pivot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.position.y += size.y / 2;
  const radius = Math.max(size.x, size.y, size.z) || 1;

  const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
  camera.position.set(radius * 1.6, radius * 1.2, radius * 1.9);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, size.y / 2, 0);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.4;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  const grid = new THREE.GridHelper(radius * 3, 20, dark ? 0x555555 : 0xcccccc, dark ? 0x333333 : 0xe2e2e2);
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  scene.add(grid);

  const dims = `${size.x.toFixed(1)} × ${size.z.toFixed(1)} × ${size.y.toFixed(1)} mm`;
  fill(container, renderer.domElement, h('div.viewer-tip', `${dims} · drag to rotate`));

  const resize = () => {
    const w = container.clientWidth, ht = container.clientHeight;
    renderer.setSize(w, ht, false);
    camera.aspect = w / ht;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    if (!container.isConnected) { renderer.setAnimationLoop(null); renderer.dispose(); return; }
    controls.update();
    renderer.render(scene, camera);
  });
}
