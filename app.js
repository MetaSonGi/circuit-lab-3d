// 3D 논리회로 랩 — three.js 장면, 상호작용, 패널 UI
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as S from './sim.js';

const BOARD = { w: 24, d: 15 };
const C = { neon: 0x00e5a0, violet: 0xa06bff, amber: 0xffb020, accent: 0x4f7cff, red: 0xff5470, off: 0x34405e, pin: 0x46557a };
const PIN_Y = 0.35;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const $ = (id) => document.getElementById(id);

try { await document.fonts.ready; } catch { /* ignore */ }

// ---------- renderer / scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b16);
scene.fog = new THREE.Fog(0x070b16, 45, 100);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0x8aa6ff, 0x0a0f1e, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(10, 24, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -14, near: 1, far: 60 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0xa06bff, 0.6);
rim.position.set(-14, 8, -12);
scene.add(rim);

// board
const slab = new THREE.Mesh(
  new THREE.BoxGeometry(BOARD.w, 0.8, BOARD.d),
  new THREE.MeshStandardMaterial({ color: 0x141c30, roughness: 0.75, metalness: 0.1 }),
);
slab.position.y = -0.4;
slab.receiveShadow = true;
scene.add(slab);
const edge = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: C.accent, transparent: true, opacity: 0.55 }));
edge.position.copy(slab.position);
scene.add(edge);
{
  const holeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 8);
  const xs = [], zs = [];
  for (let x = -(BOARD.w / 2 - 1); x <= BOARD.w / 2 - 1; x++) xs.push(x);
  for (let z = -Math.floor(BOARD.d / 2 - 1.5); z <= BOARD.d / 2 - 1.5; z++) zs.push(z);
  const holes = new THREE.InstancedMesh(holeGeo, new THREE.MeshBasicMaterial({ color: 0x05070d }), xs.length * zs.length);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const x of xs) for (const z of zs) { m.makeTranslation(x, 0.005, z); holes.setMatrixAt(i++, m); }
  scene.add(holes);
  const rail = (z, color) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w - 2, 0.02, 0.08),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
    r.position.set(0, 0.01, z);
    scene.add(r);
  };
  const rz = BOARD.d / 2;
  rail(-(rz - 0.75), C.red); rail(-(rz - 0.4), C.accent); rail(rz - 0.75, C.red); rail(rz - 0.4, C.accent);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: 0x090e1d, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.82;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(160, 80, 0x1a2848, 0x101a33);
  grid.position.y = -0.8;
  scene.add(grid);
}

// ---------- textures ----------
const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
function gateTex(type) {
  return canvasTex('gate:' + type, 256, 192, (g, w, h) => {
    g.fillStyle = '#8b98b8';
    g.beginPath(); g.arc(22, 22, 7, 0, Math.PI * 2); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#d6def5';
    g.font = `800 ${type.length > 3 ? 62 : 74}px Pretendard, sans-serif`;
    g.fillText(type, w / 2, 82);
    g.fillStyle = '#00e5a0';
    g.font = '600 36px Consolas, monospace';
    g.fillText(S.PARTS[type].expr, w / 2, 148);
  });
}
function labelTex(text, color) {
  return canvasTex('label:' + text + color, 128, 64, (g, w, h) => {
    g.fillStyle = 'rgba(7,11,22,0.82)';
    g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 14); g.fill(); g.stroke();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 34px Pretendard, sans-serif';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

// ---------- part views ----------
const G = {
  pin: new THREE.SphereGeometry(0.2, 16, 12),
  leg: new THREE.CylinderGeometry(0.045, 0.045, 1, 8),
  gate: new THREE.BoxGeometry(2.2, 0.55, 1.6),
  gateTop: new THREE.PlaneGeometry(2.0, 1.4),
  swBase: new THREE.BoxGeometry(1.8, 0.4, 1.4),
  lever: new THREE.CylinderGeometry(0.1, 0.12, 0.8, 12),
  cap: new THREE.SphereGeometry(0.2, 16, 12),
  ledBase: new THREE.BoxGeometry(1.2, 0.35, 1.2),
  dome: new THREE.SphereGeometry(0.42, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
  strip: new THREE.BoxGeometry(0.9, 0.06, 0.06),
  pulse: new THREE.SphereGeometry(0.1, 10, 8),
};
const legMat = new THREE.MeshStandardMaterial({ color: 0xb8c2d8, metalness: 0.9, roughness: 0.3 });

const partViews = new Map();
const wireViews = new Map();
let pickables = [];

function addPin(group, refs, kind, pin, x, z, bodyEdge) {
  const mat = new THREE.MeshStandardMaterial({ color: C.pin, roughness: 0.35, metalness: 0.4, emissive: 0x000000 });
  const mesh = new THREE.Mesh(G.pin, mat);
  mesh.position.set(x, PIN_Y, z);
  mesh.castShadow = true;
  group.add(mesh);
  const len = Math.abs(x - bodyEdge);
  const leg = new THREE.Mesh(G.leg, legMat);
  leg.scale.y = len;
  leg.rotation.z = Math.PI / 2;
  leg.position.set((x + bodyEdge) / 2, PIN_Y, z);
  group.add(leg);
  refs.pins.push({ mesh, mat, kind, pin, local: new THREE.Vector3(x, PIN_Y, z) });
}

function makeLabel(group, text, color, y) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(text, color), transparent: true, depthWrite: false }));
  sp.scale.set(1.3, 0.65, 1);
  sp.position.y = y;
  group.add(sp);
  return sp;
}

function makePartView(p) {
  const def = S.PARTS[p.type];
  const group = new THREE.Group();
  const refs = { pins: [], bodies: [] };
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d111c, roughness: 0.45, metalness: 0.25, emissive: 0x000000 });
  refs.bodyMat = bodyMat;
  const body = (geo, mat, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    refs.bodies.push(m);
    return m;
  };

  if (S.GATES.includes(p.type)) {
    body(G.gate, bodyMat, 0.425);
    const top = new THREE.Mesh(G.gateTop, new THREE.MeshBasicMaterial({ map: gateTex(p.type), transparent: true }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.702;
    group.add(top);
    const zs = def.inputs === 1 ? [0] : [-0.45, 0.45];
    zs.forEach((z, i) => addPin(group, refs, 'in', i, -1.45, z, -1.1));
    addPin(group, refs, 'out', 0, 1.45, 0, 1.1);
  } else if (p.type === 'SWITCH') {
    bodyMat.color.set(0x161e33);
    body(G.swBase, bodyMat, 0.2);
    const pivot = new THREE.Group();
    pivot.position.y = 0.4;
    const lever = new THREE.Mesh(G.lever, legMat);
    lever.position.y = 0.4;
    lever.castShadow = true;
    const capMat = new THREE.MeshStandardMaterial({ color: 0x3a3320, emissive: C.amber, emissiveIntensity: 0 });
    const cap = new THREE.Mesh(G.cap, capMat);
    cap.position.y = 0.8;
    pivot.add(lever, cap);
    group.add(pivot);
    refs.bodies.push(lever, cap);
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: C.amber, emissiveIntensity: 0 });
    const strip = new THREE.Mesh(G.strip, stripMat);
    strip.position.set(0, 0.25, 0.71);
    group.add(strip);
    Object.assign(refs, { pivot, capMat, stripMat, lever: 0 });
    addPin(group, refs, 'out', 0, 1.3, 0, 0.9);
    makeLabel(group, p.label, p.locked ? '#a06bff' : '#ffb020', 1.75);
  } else if (p.type === 'LED') {
    bodyMat.color.set(0x161e33);
    body(G.ledBase, bodyMat, 0.175);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x0c3326, emissive: C.neon, emissiveIntensity: 0.06, roughness: 0.2, transparent: true, opacity: 0.92 });
    const dome = body(G.dome, domeMat, 0.35);
    Object.assign(refs, { domeMat, dome });
    addPin(group, refs, 'in', 0, -1.0, 0, -0.6);
    makeLabel(group, p.label, p.locked ? '#a06bff' : '#00e5a0', 1.55);
  }

  refs.bodies.forEach((b) => { b.userData.pick = { type: 'part', id: p.id }; });
  refs.pins.forEach((pn) => { pn.mesh.userData.pick = { type: 'pin', part: p.id, pin: pn.pin, kind: pn.kind }; });
  group.position.set(p.x, 0, p.z);
  scene.add(group);
  return { group, refs, part: p };
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.material && o.material !== legMat) {
      if (o.isSprite) o.material.dispose();
      else if (!o.material.map) o.material.dispose();
    }
  });
  scene.remove(group);
}

function pinWorld(ref) {
  const v = partViews.get(ref.part);
  const pn = v?.refs.pins.find((p) => p.kind === ref.kind && p.pin === ref.pin);
  return pn ? v.group.position.clone().add(pn.local) : new THREE.Vector3();
}

// ---------- wires ----------
function wireCurve(a, b) {
  const d = a.distanceTo(b);
  const h = 0.7 + d * 0.13;
  const dx = Math.max(1.2, Math.abs(b.x - a.x) * 0.45);
  return new THREE.CubicBezierCurve3(a.clone(),
    new THREE.Vector3(a.x + dx, a.y + h, a.z),
    new THREE.Vector3(b.x - dx, b.y + h, b.z), b.clone());
}

const pulseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.0, 3.0, 2.0) });

function buildWire(w) {
  const a = pinWorld({ ...w.from, kind: 'out' });
  const b = pinWorld({ ...w.to, kind: 'in' });
  const curve = wireCurve(a, b);
  let v = wireViews.get(w.id);
  if (!v) {
    const mat = new THREE.MeshStandardMaterial({ color: C.off, roughness: 0.45, metalness: 0.2, emissive: 0x000000 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.castShadow = true;
    mesh.userData.pick = { type: 'wire', id: w.id };
    scene.add(mesh);
    const pulses = [0, 1, 2].map(() => { const s = new THREE.Mesh(G.pulse, pulseMat); s.visible = false; scene.add(s); return s; });
    v = { mesh, mat, pulses, val: 0 };
    wireViews.set(w.id, v);
  }
  v.mesh.geometry.dispose();
  v.mesh.geometry = new THREE.TubeGeometry(curve, 48, 0.075, 8, false);
  v.curve = curve;
  v.len = curve.getLength();
}

function removeWireView(id) {
  const v = wireViews.get(id);
  if (!v) return;
  scene.remove(v.mesh, ...v.pulses);
  v.mesh.geometry.dispose();
  v.mat.dispose();
  wireViews.delete(id);
}

// temp wire while connecting
const tempMat = new THREE.MeshStandardMaterial({ color: C.violet, emissive: C.violet, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });
const tempWire = new THREE.Mesh(new THREE.BufferGeometry(), tempMat);
tempWire.visible = false;
scene.add(tempWire);
function updateTemp(fromRef, target, snapped) {
  const a = pinWorld(fromRef);
  const [o, i] = fromRef.kind === 'out' ? [a, target] : [target, a];
  tempWire.geometry.dispose();
  tempWire.geometry = new THREE.TubeGeometry(wireCurve(o, i), 40, 0.06, 6, false);
  tempMat.color.set(snapped ? C.neon : C.violet);
  tempMat.emissive.set(snapped ? C.neon : C.violet);
  tempWire.visible = true;
}
function hideTemp() { tempWire.visible = false; }

// ---------- state ----------
let mode = store.get('cl3d.mode') === 'sandbox' ? 'sandbox' : 'mission';
let missionIdx = Math.min(S.MISSIONS.length - 1, Math.max(0, parseInt(store.get('cl3d.mission') || '0', 10) || 0));
let progress = new Set();
try { progress = new Set(JSON.parse(store.get('cl3d.progress') || '[]')); } catch { /* ignore */ }
let circuit = S.createCircuit();
let selected = null;
let dirty = true;
let lastSim = null;

const mission = () => S.MISSIONS[missionIdx];
const saveKey = () => (mode === 'sandbox' ? 'cl3d.sandbox' : 'cl3d.m.' + mission().id);
let saveTimer = 0;
function changed() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(saveKey(), S.serialize(circuit)), 250);
}

function loadCircuit() {
  const raw = store.get(saveKey());
  let c = null;
  if (raw) { try { c = S.deserialize(raw); } catch { c = null; } }
  if (mode === 'mission') {
    const m = mission();
    const ok = c && m.inputs.every((l) => c.parts.some((p) => p.type === 'SWITCH' && p.label === l && p.locked))
      && m.outputs.every((l) => c.parts.some((p) => p.type === 'LED' && p.label === l && p.locked));
    if (!ok) c = S.buildMission(m);
  }
  return c || S.createCircuit();
}

// full rebuild of views from circuit
function syncAll() {
  for (const v of partViews.values()) disposeGroup(v.group);
  partViews.clear();
  for (const id of [...wireViews.keys()]) removeWireView(id);
  for (const p of circuit.parts) partViews.set(p.id, makePartView(p));
  for (const w of circuit.wires) buildWire(w);
  refreshPickables();
  select(null);
  dirty = true;
}

function syncDiff() {
  const ids = new Set(circuit.parts.map((p) => p.id));
  for (const [id, v] of partViews) if (!ids.has(id)) { disposeGroup(v.group); partViews.delete(id); }
  for (const p of circuit.parts) if (!partViews.has(p.id)) partViews.set(p.id, makePartView(p));
  const wids = new Set(circuit.wires.map((w) => w.id));
  for (const id of [...wireViews.keys()]) if (!wids.has(id)) removeWireView(id);
  for (const w of circuit.wires) if (!wireViews.has(w.id)) buildWire(w);
  refreshPickables();
}

function refreshPickables() {
  pickables = [];
  for (const v of partViews.values()) { pickables.push(...v.refs.bodies); v.refs.pins.forEach((p) => pickables.push(p.mesh)); }
  for (const v of wireViews.values()) pickables.push(v.mesh);
}

function rebuildWiresFor(partId) {
  for (const w of circuit.wires) if (w.from.part === partId || w.to.part === partId) buildWire(w);
}

// ---------- placement ----------
const footprint = (t) => (t === 'SWITCH' ? { w: 3.2, d: 2 } : t === 'LED' ? { w: 2.8, d: 1.8 } : { w: 3.8, d: 2.2 });
function inBounds(t, x, z) {
  const f = footprint(t);
  return Math.abs(x) <= BOARD.w / 2 - f.w / 2 && Math.abs(z) <= BOARD.d / 2 - f.d / 2 - 0.4;
}
function overlaps(t, x, z, ignoreId) {
  const f = footprint(t);
  return circuit.parts.some((p) => {
    if (p.id === ignoreId) return false;
    const g = footprint(p.type);
    return Math.abs(p.x - x) < (f.w + g.w) / 2 && Math.abs(p.z - z) < (f.d + g.d) / 2;
  });
}
function freeSpot(t) {
  for (let r = 0; r < 16; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (inBounds(t, dx, dz) && !overlaps(t, dx, dz)) return { x: dx, z: dz };
    }
  }
  return null;
}

function addPartFromPalette(type) {
  const spot = freeSpot(type);
  if (!spot) { toast('보드에 빈 자리가 없어요', true); return; }
  const p = S.addPart(circuit, type, spot.x, spot.z);
  syncDiff();
  select({ type: 'part', id: p.id });
  const v = partViews.get(p.id);
  if (v && !reduceMotion) { v.group.position.y = 2.5; v.drop = 0; }
  changed();
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PIN_Y);
function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pick(e) {
  setRay(e);
  const bonus = { pin: 0.6, part: 0.25, wire: 0 };
  let best = null;
  for (const h of ray.intersectObjects(pickables, false)) {
    const p = h.object.userData.pick;
    if (!p) continue;
    const score = h.distance - bonus[p.type];
    if (!best || score < best.score) best = { ...p, score };
  }
  return best;
}
function groundPoint(e) {
  setRay(e);
  const v = new THREE.Vector3();
  return ray.ray.intersectPlane(ground, v) ? v : null;
}
const canLink = (a, b) => a && b && b.type === 'pin' && a.kind !== b.kind && a.part !== b.part;
const samePin = (a, b) => a && b && a.part === b.part && a.pin === b.pin && a.kind === b.kind;

let drag = null;
let pending = null;
let down = { x: 0, y: 0 };
let hoverPinMesh = null;

function setHoverPin(hit) {
  const mesh = hit?.type === 'pin'
    ? partViews.get(hit.part)?.refs.pins.find((p) => p.kind === hit.kind && p.pin === hit.pin)?.mesh : null;
  if (mesh === hoverPinMesh) return;
  if (hoverPinMesh) hoverPinMesh.scale.setScalar(1);
  hoverPinMesh = mesh;
  if (mesh) mesh.scale.setScalar(1.45);
}

function tryConnect(a, b) {
  if (a.part === b.part) { toast('같은 부품끼리는 연결할 수 없어요', true); return; }
  if (a.kind === b.kind) { toast(a.kind === 'out' ? '출력 핀은 입력 핀(왼쪽)에 연결하세요' : '입력 핀은 출력 핀(오른쪽)에 연결하세요', true); return; }
  S.connect(circuit, a, b);
  syncDiff();
  changed();
}

// registered before OrbitControls so we can disable it for part/pin drags
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.clientX, y: e.clientY };
  const hit = pick(e);
  if (pending) {
    const from = pending;
    pending = null;
    hideTemp();
    if (hit?.type === 'pin') {
      if (!samePin(from, hit)) tryConnect(from, hit);
      controls.enabled = false;
      drag = { kind: 'none' };
      return;
    }
  }
  if (!hit) { select(null); return; }
  controls.enabled = false;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  if (hit.type === 'pin') {
    drag = { kind: 'wire', from: hit, moved: false };
  } else if (hit.type === 'part') {
    const p = S.getPart(circuit, hit.id);
    const pt = groundPoint(e);
    drag = { kind: 'part', part: p, off: pt ? { x: pt.x - p.x, z: pt.z - p.z } : { x: 0, z: 0 }, moved: false };
    select({ type: 'part', id: p.id });
  } else {
    drag = { kind: 'none' };
    select({ type: 'wire', id: hit.id });
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) drag.moved = true;
    if (drag.kind === 'wire' && drag.moved) {
      const hit = pick(e);
      const snap = canLink(drag.from, hit);
      const target = snap ? pinWorld(hit) : groundPoint(e);
      if (target) updateTemp(drag.from, target, snap);
      setHoverPin(snap ? hit : null);
    } else if (drag.kind === 'part' && drag.moved) {
      const pt = groundPoint(e);
      const p = drag.part;
      if (pt) {
        const nx = Math.round(pt.x - drag.off.x), nz = Math.round(pt.z - drag.off.z);
        if ((nx !== p.x || nz !== p.z) && inBounds(p.type, nx, nz) && !overlaps(p.type, nx, nz, p.id)) {
          p.x = nx; p.z = nz;
          partViews.get(p.id).group.position.set(nx, 0, nz);
          rebuildWiresFor(p.id);
          changed();
        }
      }
    }
    return;
  }
  const hit = pick(e);
  if (pending) {
    const snap = canLink(pending, hit);
    const target = snap ? pinWorld(hit) : groundPoint(e);
    if (target) updateTemp(pending, target, snap);
    setHoverPin(snap ? hit : null);
  } else {
    setHoverPin(hit);
  }
  canvas.style.cursor = hit ? (hit.type === 'pin' ? 'crosshair' : 'pointer') : 'grab';
});

function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  controls.enabled = true;
  if (d.kind === 'wire') {
    const hit = cancelled ? null : pick(e);
    if (hit?.type === 'pin' && !samePin(hit, d.from)) { hideTemp(); tryConnect(d.from, hit); }
    else if (!d.moved && !cancelled) {
      pending = d.from;
      const pt = groundPoint(e);
      if (pt) updateTemp(pending, pt, false);
      toast(d.from.kind === 'out' ? '연결할 입력 핀을 누르세요' : '연결할 출력 핀을 누르세요');
    } else hideTemp();
    setHoverPin(null);
  } else if (d.kind === 'part' && !d.moved && !cancelled && d.part.type === 'SWITCH') {
    d.part.on = !d.part.on;
    select(null);
    changed();
  }
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
canvas.addEventListener('dblclick', (e) => {
  const hit = pick(e);
  if (hit?.type === 'wire') { S.removeWire(circuit, hit.id); syncDiff(); select(null); changed(); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.38;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

// ---------- camera ----------
function camHome() {
  const portrait = camera.aspect < 1;
  // portrait: look along the board from the output side so signals flow top → bottom
  return portrait ? new THREE.Vector3(30, 34, 0.01) : new THREE.Vector3(0, 29, 26);
}
let camTween = null;
function resetCamera(instant) {
  const to = camHome();
  if (instant || reduceMotion) { camera.position.copy(to); controls.target.set(0, 0, 0); return; }
  camTween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: to };
}

// ---------- selection ----------
function select(sel) {
  if (selected?.type === 'part') { const v = partViews.get(selected.id); if (v) v.refs.bodyMat.emissive.set(0x000000); }
  selected = sel;
  if (sel?.type === 'part') { const v = partViews.get(sel.id); if (v) { v.refs.bodyMat.emissive.set(C.violet); v.refs.bodyMat.emissiveIntensity = 0.12; } }
  dirty = true;
  const bar = $('selbar');
  if (!sel) { bar.hidden = true; return; }
  bar.hidden = false;
  if (sel.type === 'wire') {
    $('selName').textContent = '전선';
    $('btnDelete').disabled = false;
  } else {
    const p = S.getPart(circuit, sel.id);
    const name = S.GATES.includes(p.type) ? `${p.type} 게이트` : `${S.PARTS[p.type].name} ${p.label}`;
    $('selName').textContent = p.locked ? `${name} · 미션 고정` : name;
    $('btnDelete').disabled = !!p.locked;
  }
}
function deleteSelected() {
  if (!selected) return;
  if (selected.type === 'wire') S.removeWire(circuit, selected.id);
  else {
    const p = S.getPart(circuit, selected.id);
    if (!p || p.locked) { toast('미션 스위치·LED는 지울 수 없어요', true); return; }
    S.removePart(circuit, p.id);
  }
  select(null);
  syncDiff();
  changed();
}
$('btnDelete').addEventListener('click', deleteSelected);

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); }
  else if (e.key === 'Escape') { pending = null; hideTemp(); select(null); }
  else if (e.key === 'r' || e.key === 'R') resetCamera();
});

// ---------- simulation → visuals ----------
const offColor = new THREE.Color(C.off);
function applySim() {
  lastSim = S.simulate(circuit);
  for (const v of partViews.values()) {
    const id = v.part.id;
    const ins = lastSim.ins.get(id) || [];
    const outs = lastSim.out.get(id) || [];
    for (const pn of v.refs.pins) {
      const val = pn.kind === 'in' ? ins[pn.pin] : outs[pn.pin];
      pn.mat.emissive.set(val ? C.neon : 0x000000);
      pn.mat.emissiveIntensity = val ? 2.2 : 0;
      pn.mat.color.set(val ? C.neon : C.pin);
    }
    if (v.part.type === 'LED') {
      v.refs.domeMat.emissiveIntensity = ins[0] ? 3.2 : 0.06;
      v.refs.domeMat.color.set(ins[0] ? 0x40ffc8 : 0x0c3326);
    }
    if (v.part.type === 'SWITCH') {
      v.refs.capMat.emissiveIntensity = v.part.on ? 2.6 : 0;
      v.refs.stripMat.emissiveIntensity = v.part.on ? 2.4 : 0;
    }
  }
  for (const w of circuit.wires) {
    const v = wireViews.get(w.id);
    if (!v) continue;
    v.val = lastSim.wire.get(w.id) || 0;
    const sel = selected?.type === 'wire' && selected.id === w.id;
    if (sel) { v.mat.color.set(C.amber); v.mat.emissive.set(C.amber); v.mat.emissiveIntensity = 0.7; }
    else if (v.val) { v.mat.color.set(C.neon); v.mat.emissive.set(C.neon); v.mat.emissiveIntensity = 1.25; }
    else { v.mat.color.copy(offColor); v.mat.emissive.set(0x000000); }
    v.pulses.forEach((s) => { s.visible = !!v.val; });
  }
  renderPanel();
}

// ---------- panel ----------
const cell = (v, extra = '') => `<td class="v${v} ${extra}">${v}</td>`;
function renderPanel() {
  const table = $('truth');
  const state = $('ttState');
  const note = $('ttNote');
  if (mode === 'mission') {
    const m = mission();
    const res = S.checkMission(circuit, m);
    const okRows = res.rows.filter((r) => r.ok).length;
    let html = '<tr>' + m.inputs.map((l) => `<th>${l}</th>`).join('')
      + m.outputs.map((l, i) => `<th class="out${i ? '' : ' sep'}">${l}</th>`).join('') + '<th class="sep"></th></tr>';
    for (const r of res.rows) {
      html += `<tr class="${r.current ? 'current' : ''}">` + r.bits.map((b) => cell(b)).join('')
        + r.outs.map((v, i) => `<td class="v${v}${i ? '' : ' sep'}">${v}${v !== r.expected[i] ? `<span class="exp">→${r.expected[i]}</span>` : ''}</td>`).join('')
        + `<td class="sep ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</td></tr>`;
    }
    table.innerHTML = html;
    state.textContent = `${okRows}/${res.rows.length} 일치`;
    state.className = 'badge ' + (res.pass ? 'ok' : okRows ? 'bad' : '');
    const notes = [];
    if (res.violations.length) notes.push(`⚠ 이 미션에서 쓸 수 없는 부품: ${res.violations.join(', ')}`);
    if (!res.stable) notes.push('⚠ 신호가 계속 바뀌는 피드백 루프가 있어요');
    notes.push(`파란 줄은 지금 스위치 상태 · 게이트 ${res.gateCount}개 사용`);
    note.textContent = notes.join('\n');
    note.style.whiteSpace = 'pre-line';
  } else {
    const tt = S.truthTable(circuit);
    if (!tt.inputs.length || !tt.outputs.length) {
      table.innerHTML = '';
      state.textContent = '대기';
      state.className = 'badge';
      note.textContent = '스위치와 LED를 놓고 연결하면 진리표가 자동으로 만들어집니다.';
      return;
    }
    let html = '<tr>' + tt.inputs.map((l) => `<th>${l}</th>`).join('')
      + tt.outputs.map((l, i) => `<th class="out${i ? '' : ' sep'}">${l}</th>`).join('') + '</tr>';
    for (const r of tt.rows) {
      html += `<tr class="${r.current ? 'current' : ''}">` + r.bits.map((b) => cell(b)).join('')
        + r.outs.map((v, i) => cell(v, i ? '' : 'sep')).join('') + '</tr>';
    }
    table.innerHTML = html;
    state.textContent = `입력 ${tt.inputs.length} · 출력 ${tt.outputs.length}`;
    state.className = 'badge ok';
    const total = circuit.parts.filter((p) => p.type === 'SWITCH').length;
    note.textContent = (tt.stable ? '' : '⚠ 피드백 루프 때문에 값이 안정되지 않아요. ')
      + (total > 5 ? '스위치는 앞의 5개(A~E)까지만 표에 나옵니다. ' : '') + '파란 줄은 지금 스위치 상태입니다.';
  }
}

function renderMissionInfo() {
  const m = mission();
  $('mNum').textContent = String(missionIdx + 1).padStart(2, '0');
  $('mTitle').textContent = m.title;
  $('mGoal').textContent = m.goal;
  $('mDesc').textContent = m.desc;
  const limited = m.parts.length < S.GATES.length;
  $('mAllowed').textContent = limited ? `사용 가능: ${m.parts.join(' · ')}` : '';
  $('missionList').innerHTML = S.MISSIONS.map((mm, i) =>
    `<button class="m-chip${i === missionIdx ? ' active' : ''}${progress.has(mm.id) ? ' done' : ''}" data-i="${i}" title="${mm.title}">${i + 1}</button>`).join('');
  $('missionList').querySelectorAll('.m-chip').forEach((b) => b.addEventListener('click', () => {
    missionIdx = +b.dataset.i;
    store.set('cl3d.mission', String(missionIdx));
    openMode();
  }));
}

function renderPalette() {
  const types = mode === 'sandbox' ? ['SWITCH', 'LED', ...S.GATES] : mission().parts;
  const sub = { SWITCH: '입력 ON/OFF', LED: '출력 표시', AND: '둘 다 1', OR: '하나라도 1', NOT: '뒤집기', NAND: 'AND의 반대', NOR: 'OR의 반대', XOR: '서로 다르면 1', XNOR: '같으면 1' };
  const ico = { SWITCH: '⏻', LED: '●' };
  $('partList').innerHTML = types.map((t) =>
    `<button class="part-btn" data-type="${t}"><span class="ico">${ico[t] || '▭'}</span><span>${S.GATES.includes(t) ? t : S.PARTS[t].name}<small>${sub[t]}</small></span></button>`).join('');
  $('partList').querySelectorAll('.part-btn').forEach((b) => b.addEventListener('click', () => addPartFromPalette(b.dataset.type)));
}

function openMode() {
  document.body.classList.toggle('mode-mission', mode === 'mission');
  document.body.classList.toggle('mode-sandbox', mode === 'sandbox');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  $('sheetLabel').textContent = mode === 'mission' ? '미션' : '진리표';
  pending = null; hideTemp();
  circuit = loadCircuit();
  syncAll();
  renderPalette();
  if (mode === 'mission') renderMissionInfo();
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  if (mode === t.dataset.mode) return;
  mode = t.dataset.mode;
  store.set('cl3d.mode', mode);
  openMode();
}));

$('btnCheck').addEventListener('click', () => {
  const m = mission();
  const res = S.checkMission(circuit, m);
  if (res.pass) {
    const first = !progress.has(m.id);
    progress.add(m.id);
    store.set('cl3d.progress', JSON.stringify([...progress]));
    renderMissionInfo();
    celebrate();
    const left = S.MISSIONS.length - progress.size;
    toast(`🎉 미션 통과! ${m.title}` + (left ? ` · 남은 미션 ${left}개` : ' · 모든 미션 완료!'));
    if (first && left && missionIdx < S.MISSIONS.length - 1) setTimeout(() => toast('다음 미션 번호를 눌러 이어서 도전하세요'), 2600);
  } else if (res.violations.length) {
    toast(`${res.violations.join(', ')} 부품은 이 미션에서 쓸 수 없어요`, true);
  } else if (!res.stable) {
    toast('피드백 루프 때문에 값이 안정되지 않아요', true);
  } else {
    const bad = res.rows.filter((r) => !r.ok).length;
    toast(`진리표 ${bad}줄이 아직 달라요 (✗ 표시)`, true);
  }
});

$('btnClear').addEventListener('click', () => {
  if (!confirm(mode === 'mission' ? '이 미션의 회로를 처음 상태로 되돌릴까요?' : '보드를 모두 비울까요?')) return;
  circuit = mode === 'mission' ? S.buildMission(mission()) : S.createCircuit();
  syncAll();
  changed();
});
$('btnExample').addEventListener('click', () => {
  if (circuit.parts.length && !confirm('지금 회로를 반가산기 예제로 바꿀까요?')) return;
  circuit = S.exampleCircuit();
  syncAll();
  changed();
  toast('반가산기 예제 — 스위치 A·B를 눌러 보세요');
});
$('btnCam').addEventListener('click', () => resetCamera());
$('btnHelp').addEventListener('click', () => $('help').showModal());
$('sheetToggle').addEventListener('click', () => $('side').classList.toggle('open'));

let toastTimer = 0;
function toast(msg, warn = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast' + (warn ? ' warn' : ''); }, 2400);
}

// ---------- celebration particles ----------
let burst = null;
function celebrate() {
  if (reduceMotion) return;
  const origins = circuit.parts.filter((p) => p.type === 'LED').map((p) => new THREE.Vector3(p.x, 0.8, p.z));
  if (!origins.length) origins.push(new THREE.Vector3(0, 1, 0));
  const n = 90 * origins.length;
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    const o = origins[i % origins.length];
    pos.set([o.x, o.y, o.z], i * 3);
    vel.push(new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 6, (Math.random() - 0.5) * 7));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.28, color: new THREE.Color(0.4, 3, 2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  if (burst) { scene.remove(burst.points); burst.points.geometry.dispose(); burst.points.material.dispose(); }
  burst = { points: new THREE.Points(geo, mat), vel, t: 0 };
  scene.add(burst.points);
}

// ---------- resize / loop ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  // keep the board centred in the gap between the palette (left) and the side panel (right)
  const shift = w > 760 ? Math.round((314 - 146) / 2) : 0;
  if (shift) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
let wasPortrait = null;
addEventListener('resize', () => {
  resize();
  const portrait = camera.aspect < 1;
  if (wasPortrait !== null && portrait !== wasPortrait) resetCamera(true);
  wasPortrait = portrait;
});
resize();
resetCamera(true);
wasPortrait = camera.aspect < 1;

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt * 1.6);
    const k = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.p0, camTween.p1, k);
    controls.target.lerpVectors(camTween.t0, new THREE.Vector3(), k);
    if (camTween.t >= 1) camTween = null;
  }
  controls.update();
  if (dirty) { dirty = false; applySim(); }

  for (const v of partViews.values()) {
    if (v.drop !== undefined) {
      v.drop += dt * 3;
      const k = Math.min(1, v.drop);
      v.group.position.y = 2.5 * (1 - k) * (1 - k) + (k < 1 ? Math.abs(Math.sin(k * Math.PI)) * 0.15 * (1 - k) : 0);
      if (k >= 1) { v.group.position.y = 0; delete v.drop; }
    }
    if (v.refs.pivot) {
      const target = v.part.on ? -0.5 : 0.5;
      v.refs.lever += (target - v.refs.lever) * Math.min(1, dt * 14);
      v.refs.pivot.rotation.z = v.refs.lever;
    }
  }
  for (const v of wireViews.values()) {
    if (!v.val || !v.curve) continue;
    const speed = reduceMotion ? 1.5 : 5;
    v.pulses.forEach((s, k) => {
      const u = ((time * speed) / v.len + k / 3) % 1;
      s.position.copy(v.curve.getPointAt(u));
    });
  }
  if (burst) {
    burst.t += dt;
    const arr = burst.points.geometry.attributes.position.array;
    burst.vel.forEach((vel, i) => {
      vel.y -= 9.8 * dt;
      arr[i * 3] += vel.x * dt; arr[i * 3 + 1] += vel.y * dt; arr[i * 3 + 2] += vel.z * dt;
    });
    burst.points.geometry.attributes.position.needsUpdate = true;
    burst.points.material.opacity = Math.max(0, 1 - burst.t / 1.6);
    if (burst.t > 1.6) { scene.remove(burst.points); burst.points.geometry.dispose(); burst.points.material.dispose(); burst = null; }
  }
  composer.render();
  requestAnimationFrame(frame);
}

openMode();
if (!store.get('cl3d.seenHelp')) { store.set('cl3d.seenHelp', '1'); $('help').showModal(); }
requestAnimationFrame(frame);
