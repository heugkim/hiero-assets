// U2 runtime spike - scroll + forced perspective + 3-state light cross-fade.
// THROWAWAY feasibility code (plan U2). Proves the riskiest runtime mechanics
// before any real assets exist. Not production; not embedded in Framer yet.
//
// Three risks this proves:
//   1. A single scroll-driven uBlend cross-fades 3 baked lightmaps inside a PBR
//      (MeshStandardMaterial) material via onBeforeCompile, with NO ghosting.
//   2. Smooth scroll (Lenis + GSAP ScrollTrigger) holds ~60fps.
//   3. A short camera dolly + +/-10deg pointer-look over a pre-tapered set reads
//      as a long monumental walk without the forced-perspective trick breaking.

import * as THREE from 'three';

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const Lenis = window.Lenis?.default || window.Lenis;   // UMD builds vary on .default

// ---- Tunables (the "walk length / camera motion" open question is resolved here) ----
const CONFIG = {
  tubeNearR: 7.0,     // wide end radius (where the camera lives)
  tubeFarR: 1.4,      // narrow end radius (forced-perspective vanishing)
  tubeLen: 64,        // total tube length down -Z
  camStartZ: 4.0,     // camera just inside the wide end
  dolly: 12.0,        // SAFE forward travel. Tube is 64 long; 12 keeps the camera
                      // in the wide half so the taper always reads as "more tunnel".
                      // Push this in the URL (?dolly=30) to find where the trick breaks.
  maxLook: 10 * Math.PI / 180,  // +/-10deg pointer-look
  lookEase: 0.06,     // pointer-look smoothing
  progEase: 0.10,     // scroll-progress smoothing (on top of GSAP scrub)
  fogDensity: 0.018,
};
// URL overrides for empirical tuning (e.g. ?dolly=30&far=0.6&look=18)
const qs = new URLSearchParams(location.search);
if (qs.has('dolly')) CONFIG.dolly = parseFloat(qs.get('dolly'));
if (qs.has('far')) CONFIG.tubeFarR = parseFloat(qs.get('far'));
if (qs.has('look')) CONFIG.maxLook = parseFloat(qs.get('look')) * Math.PI / 180;

const hud = document.getElementById('hud');
const canvas = document.getElementById('world');

// ---- Tier 3 floor: bail to static wordmark if WebGL2 is unavailable ----
function detectWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch (e) { return false; }
}
if (!detectWebGL2()) {
  document.getElementById('fallback').style.display = 'flex';
  hud.innerHTML = '<span class="warn">no WebGL2 - static fallback (Tier 3)</span>';
  throw new Error('no webgl2');
}

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Renderer ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const isMobile = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
const DPR_CAP = isMobile ? 1.5 : 2.0;           // pixel-ratio caps from HeroText3D history
renderer.setPixelRatio(Math.min(devicePixelRatio, DPR_CAP));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
// Fog included to confirm it composes with the blend shader (full fog-as-loader is U5).
scene.fog = new THREE.FogExp2(0x0a0a12, CONFIG.fogDensity);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, CONFIG.camStartZ);   // default camera faces -Z, down the tube

// Faint direct light so normals/edges read; the lightmaps carry the mood + the cross-fade.
scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const key = new THREE.DirectionalLight(0xffffff, 0.35);
key.position.set(-4.5, 3, 4);
scene.add(key);

// ---- Lightmaps (the three baked states, stand-in gradients for the spike) ----
const texLoader = new THREE.TextureLoader();
let loaded = 0;
const onTex = () => { loaded++; if (loaded === 3) start(); };
function lm(url) {
  const t = texLoader.load(url, onTex, undefined, (e) => {
    hud.innerHTML = '<span class="warn">lightmap load failed: ' + url + '</span>';
    console.error(e);
  });
  t.colorSpace = THREE.SRGBColorSpace;
  t.channel = 0;                 // use the primary UV set (Box/Cylinder uv) -> vLightMapUv
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
const lmDusk = lm('./lightmaps/lm-dusk.png');   // state A (uBlend 0.0)
const lmNight = lm('./lightmaps/lm-night.png');  // state B (uBlend 0.5)
const lmDawn = lm('./lightmaps/lm-dawn.png');   // state C (uBlend 1.0)

// Fog colours per state (lerped by blend) - cheap polish, confirms fog tracks the walk.
const fogA = new THREE.Color(0x241307), fogB = new THREE.Color(0x05060f), fogC = new THREE.Color(0x1a2630);

// ---- The cross-fade material (shared by all baked surfaces) ----
// Live uniform refs we keep so per-frame uBlend updates reach the compiled shader.
const blendU = {
  uLightMapB: { value: lmNight },
  uLightMapC: { value: lmDawn },
  uBlend: { value: 0 },
};
let injectOK = false;

function makeBlendMaterial(color) {
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.0, side: THREE.BackSide,
  });
  mat.lightMap = lmDusk;          // state A is the built-in lightMap slot
  mat.lightMapIntensity = 1.35;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLightMapB = blendU.uLightMapB;
    shader.uniforms.uLightMapC = blendU.uLightMapC;
    shader.uniforms.uBlend = blendU.uBlend;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform sampler2D uLightMapB;
       uniform sampler2D uLightMapC;
       uniform float uBlend;`
    );
    // onBeforeCompile gives us the shader with #include directives NOT yet expanded,
    // so we replace the *directive* and reproduce the r171 chunk with the lightmap
    // fetch swapped for a 3-way blend. Two segments: A->B over [0,0.5], B->C over
    // [0.5,1]. Same vLightMapUv for all three => no ghosting.
    const target = '#include <lights_fragment_maps>';
    const repl = `
      #if defined( RE_IndirectDiffuse )
        #ifdef USE_LIGHTMAP
          vec4 _lmA = texture2D( lightMap, vLightMapUv );
          vec4 _lmB = texture2D( uLightMapB, vLightMapUv );
          vec4 _lmC = texture2D( uLightMapC, vLightMapUv );
          vec4 _lmAB = mix( _lmA, _lmB, clamp( uBlend * 2.0, 0.0, 1.0 ) );
          vec4 _lmBC = mix( _lmB, _lmC, clamp( ( uBlend - 0.5 ) * 2.0, 0.0, 1.0 ) );
          vec4 lightMapTexel = mix( _lmAB, _lmBC, step( 0.5, uBlend ) );
          vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
          irradiance += lightMapIrradiance;
        #endif
        #if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
          iblIrradiance += getIBLIrradiance( geometryNormal );
        #endif
      #endif
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        #ifdef USE_ANISOTROPY
          radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
        #else
          radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
        #endif
        #ifdef USE_CLEARCOAT
          clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
        #endif
      #endif`;
    if (shader.fragmentShader.includes(target)) {
      shader.fragmentShader = shader.fragmentShader.replace(target, repl);
      injectOK = true;
    } else {
      console.error('U2: lightmap inject target not found - three chunk drifted.');
    }
  };
  return mat;
}

// ---- Geometry: a pre-tapered square tube = forced-perspective corridor ----
function buildWorld() {
  const wall = makeBlendMaterial(0x9a9aa2);
  // 4 radial segments = square tube; many height segments give UV variation along depth.
  const tubeGeo = new THREE.CylinderGeometry(
    CONFIG.tubeFarR, CONFIG.tubeNearR, CONFIG.tubeLen, 4, 24, true
  );
  const tube = new THREE.Mesh(tubeGeo, wall);
  tube.rotation.x = Math.PI / 2;     // lay the axis along Z (narrow end toward -Z)
  tube.rotation.y = Math.PI / 4;     // turn the diamond into floor/ceiling/left/right
  tube.position.z = CONFIG.camStartZ - CONFIG.tubeLen / 2;
  scene.add(tube);

  // Ribs: short ring bands hugging the wall at intervals - depth cue + parallax for the look.
  const ribMat = makeBlendMaterial(0x3a3a44);
  const ribCount = 7;
  for (let i = 1; i <= ribCount; i++) {
    const t = i / (ribCount + 1);                  // 0..1 along the tube
    const r = THREE.MathUtils.lerp(CONFIG.tubeNearR, CONFIG.tubeFarR, t) * 1.005;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.5, 4, 1, true), ribMat
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = Math.PI / 4;
    ring.position.z = CONFIG.camStartZ - t * CONFIG.tubeLen;
    scene.add(ring);
  }

  // Three "stepping stone" floor markers at the copy-moment depths.
  const stoneDepths = [0.17, 0.46, 0.74];
  for (const t of stoneDepths) {
    const r = THREE.MathUtils.lerp(CONFIG.tubeNearR, CONFIG.tubeFarR, t);
    const stone = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.16, 24),
      new THREE.MeshBasicMaterial({ color: 0x5b6b7a, transparent: true, opacity: 0.5 })
    );
    stone.rotation.x = -Math.PI / 2;
    stone.position.set(0, -r * 0.96, CONFIG.camStartZ - t * CONFIG.tubeLen);
    scene.add(stone);
  }

  // Warm doorway at the far end - the "pull" now that the mark is hidden (open question).
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.tubeFarR * 1.1, CONFIG.tubeFarR * 1.7),
    new THREE.MeshBasicMaterial({ color: 0xffb066, fog: true })
  );
  door.position.set(0, 0, CONFIG.camStartZ - CONFIG.tubeLen * 0.98);
  scene.add(door);
}

// ---- Scroll wiring: Lenis (smooth) + GSAP ScrollTrigger (scrub) ----
let scrollProgress = 0;     // target from scroll
let renderProgress = 0;     // eased value the render loop actually uses
function initScroll() {
  const lenis = new Lenis({ lerp: 0.10, wheelMultiplier: 1.0, smoothWheel: true });
  window.__lenis = lenis;   // debug hook: lets a headless driver exercise the real scroll path
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.create({
    trigger: '#scroll', start: 'top top', end: 'bottom bottom',
    scrub: 0.8,
    onUpdate: (self) => { scrollProgress = self.progress; },
  });
}

// ---- Pointer look ----
const look = { tx: 0, ty: 0, x: 0, y: 0 };
if (!prefersReducedMotion) {
  addEventListener('pointermove', (e) => {
    look.tx = (e.clientX / innerWidth - 0.5) * 2;    // -1..1
    look.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
}

// ---- Copy overlays: triangular opacity windows = faked station "holds" ----
const copies = [...document.querySelectorAll('.copy')].map((el) => ({
  el, peak: parseFloat(el.dataset.peak), w: 0.11,
}));
function updateCopy(p) {
  for (const c of copies) {
    const d = Math.abs(p - c.peak);
    const o = Math.max(0, 1 - d / c.w);
    c.el.style.opacity = o.toFixed(3);
    c.el.style.transform = `translateY(${(8 * (1 - o)).toFixed(1)}px)`;
  }
}

// ---- Render loop + FPS meter ----
let last = performance.now(), fpsAccum = 0, fpsFrames = 0, fps = 0, fpsMin = 999;
let paused = false;
document.addEventListener('visibilitychange', () => { paused = document.hidden; });

const tmpFog = new THREE.Color();
function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { last = now; return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  // FPS (sampled twice a second; track a running min to catch stalls)
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = fpsFrames / fpsAccum;
    if (now > 2000) fpsMin = Math.min(fpsMin, fps);   // ignore warmup
    fpsAccum = 0; fpsFrames = 0;
  }

  // Ease scroll progress (smooth even between scroll events) -> dolly + blend.
  renderProgress += (scrollProgress - renderProgress) * Math.min(1, CONFIG.progEase * dt * 60);
  const p = renderProgress;

  camera.position.z = CONFIG.camStartZ - p * CONFIG.dolly;

  look.x += (look.tx - look.x) * Math.min(1, CONFIG.lookEase * dt * 60);
  look.y += (look.ty - look.y) * Math.min(1, CONFIG.lookEase * dt * 60);
  camera.rotation.y = -look.x * CONFIG.maxLook;   // yaw
  camera.rotation.x = -look.y * CONFIG.maxLook;   // pitch

  blendU.uBlend.value = p;

  // Fog colour tracks the state (A->B->C).
  if (p < 0.5) tmpFog.copy(fogA).lerp(fogB, p * 2);
  else tmpFog.copy(fogB).lerp(fogC, (p - 0.5) * 2);
  scene.fog.color.copy(tmpFog);

  updateCopy(p);
  renderer.render(scene, camera);

  // HUD
  const stateName = p < 0.25 ? 'dusk' : p < 0.6 ? 'deep night' : 'frost dawn';
  const fpsClass = fps >= 55 ? 'ok' : fps >= 40 ? '' : 'warn';
  hud.innerHTML =
    `<b>U2 spike</b>  ${isMobile ? 'mobile' : 'desktop'} dpr${renderer.getPixelRatio().toFixed(1)}\n` +
    `fps    <span class="${fpsClass}">${fps.toFixed(0)}</span>  (min ${fpsMin < 999 ? fpsMin.toFixed(0) : '-'})\n` +
    `scroll ${(p * 100).toFixed(0)}%\n` +
    `uBlend ${p.toFixed(3)}  ${stateName}\n` +
    `dolly  z ${camera.position.z.toFixed(2)} / -${CONFIG.dolly}\n` +
    `inject ${injectOK ? '<span class="ok">ok</span>' : '<span class="warn">FAILED</span>'}`;
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, DPR_CAP));
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize, { passive: true });

let started = false;
function start() {
  if (started) return; started = true;
  buildWorld();
  initScroll();
  if (prefersReducedMotion) {
    document.getElementById('hint').textContent =
      'reduced-motion: pointer-look disabled (would yield to Vigil tier in production)';
  }
  requestAnimationFrame(frame);
}
