// 3D 논리회로 랩 — 회로 데이터·시뮬레이션·미션 채점 (DOM/three.js 없음, 순수 로직)

export const PARTS = {
  SWITCH: { name: '스위치', inputs: 0, outputs: 1, fn: (_, on) => [on ? 1 : 0] },
  AND:    { name: 'AND',  expr: 'A·B',   inputs: 2, outputs: 1, fn: ([a, b]) => [a & b] },
  OR:     { name: 'OR',   expr: 'A+B',   inputs: 2, outputs: 1, fn: ([a, b]) => [a | b] },
  NOT:    { name: 'NOT',  expr: 'Ā',     inputs: 1, outputs: 1, fn: ([a]) => [a ? 0 : 1] },
  NAND:   { name: 'NAND', expr: '¬(A·B)', inputs: 2, outputs: 1, fn: ([a, b]) => [(a & b) ? 0 : 1] },
  NOR:    { name: 'NOR',  expr: '¬(A+B)', inputs: 2, outputs: 1, fn: ([a, b]) => [(a | b) ? 0 : 1] },
  XOR:    { name: 'XOR',  expr: 'A⊕B',   inputs: 2, outputs: 1, fn: ([a, b]) => [a ^ b] },
  XNOR:   { name: 'XNOR', expr: '¬(A⊕B)', inputs: 2, outputs: 1, fn: ([a, b]) => [(a ^ b) ? 0 : 1] },
  LED:    { name: 'LED', inputs: 1, outputs: 0, fn: () => [] },
};

export const GATES = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];

export function createCircuit() {
  return { parts: [], wires: [], nextId: 1 };
}

export function addPart(c, type, x = 0, z = 0, extra = {}) {
  if (!PARTS[type]) throw new Error('unknown part ' + type);
  const part = { id: c.nextId++, type, x, z, on: false, label: '', locked: false, ...extra };
  if (!part.label && type === 'SWITCH') part.label = nextLabel(c, 'SWITCH', 'ABCDEFGH'.split(''));
  if (!part.label && type === 'LED') part.label = nextLabel(c, 'LED', ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8']);
  c.parts.push(part);
  return part;
}

function nextLabel(c, type, pool) {
  const used = new Set(c.parts.filter((p) => p.type === type).map((p) => p.label));
  return pool.find((l) => !used.has(l)) || type[0] + c.nextId;
}

export function getPart(c, id) {
  return c.parts.find((p) => p.id === id);
}

/** a, b = {part, pin, kind:'in'|'out'} in any order. Returns the wire or null. */
export function connect(c, a, b) {
  if (a.part === b.part || a.kind === b.kind) return null;
  const from = a.kind === 'out' ? a : b;
  const to = a.kind === 'in' ? a : b;
  // an input accepts one wire: replace the old one
  c.wires = c.wires.filter((w) => !(w.to.part === to.part && w.to.pin === to.pin));
  const wire = { id: c.nextId++, from: { part: from.part, pin: from.pin }, to: { part: to.part, pin: to.pin } };
  c.wires.push(wire);
  return wire;
}

export function removeWire(c, id) {
  c.wires = c.wires.filter((w) => w.id !== id);
}

export function removePart(c, id) {
  c.parts = c.parts.filter((p) => p.id !== id);
  c.wires = c.wires.filter((w) => w.from.part !== id && w.to.part !== id);
}

/** Relaxation until stable. overrides: {partId: on} for switches. */
export function simulate(c, overrides = {}) {
  const out = new Map();
  const ins = new Map();
  for (const p of c.parts) out.set(p.id, new Array(PARTS[p.type].outputs).fill(0));
  const feed = new Map();
  for (const w of c.wires) feed.set(w.to.part + ':' + w.to.pin, w);

  const maxIter = c.parts.length * 2 + 4;
  let stable = false;
  for (let iter = 0; iter < maxIter && !stable; iter++) {
    stable = true;
    for (const p of c.parts) {
      const def = PARTS[p.type];
      const iv = [];
      for (let i = 0; i < def.inputs; i++) {
        const w = feed.get(p.id + ':' + i);
        iv.push(w ? (out.get(w.from.part)?.[w.from.pin] ?? 0) : 0);
      }
      ins.set(p.id, iv);
      const on = p.id in overrides ? overrides[p.id] : p.on;
      const nv = def.fn(iv, on);
      const cur = out.get(p.id);
      for (let i = 0; i < nv.length; i++) {
        if (cur[i] !== nv[i]) { cur[i] = nv[i]; stable = false; }
      }
    }
  }
  const wire = new Map();
  for (const w of c.wires) wire.set(w.id, out.get(w.from.part)?.[w.from.pin] ?? 0);
  return { out, ins, wire, stable };
}

const sortLabel = (a, b) => a.label.localeCompare(b.label, 'en', { numeric: true });

/** Live truth table over every switch → every LED (sandbox). Max 5 inputs. */
export function truthTable(c, inputLabels, outputLabels) {
  const sw = inputLabels
    ? inputLabels.map((l) => c.parts.find((p) => p.type === 'SWITCH' && p.label === l))
    : c.parts.filter((p) => p.type === 'SWITCH').sort(sortLabel).slice(0, 5);
  const leds = outputLabels
    ? outputLabels.map((l) => c.parts.find((p) => p.type === 'LED' && p.label === l))
    : c.parts.filter((p) => p.type === 'LED').slice(0, 6);
  const n = sw.length;
  const rows = [];
  let stable = true;
  for (let k = 0; k < 1 << n; k++) {
    const bits = sw.map((_, i) => (k >> (n - 1 - i)) & 1);
    const overrides = {};
    sw.forEach((s, i) => { if (s) overrides[s.id] = !!bits[i]; });
    const r = simulate(c, overrides);
    if (!r.stable) stable = false;
    const outs = leds.map((l) => (l ? r.ins.get(l.id)?.[0] ?? 0 : 0));
    const current = sw.every((s, i) => s && !!s.on === !!bits[i]);
    rows.push({ bits, outs, current });
  }
  return { inputs: sw.map((s) => s?.label ?? '?'), outputs: leds.map((l) => l?.label ?? '?'), rows, stable };
}

export const MISSIONS = [
  { id: 'not', title: 'NOT 게이트', goal: 'Y = NOT A', desc: '입력을 뒤집어 보세요. A가 켜지면 Y가 꺼져야 합니다.',
    inputs: ['A'], outputs: ['Y'], parts: GATES, fn: (a) => [a ? 0 : 1] },
  { id: 'and', title: 'AND 게이트', goal: 'Y = A · B', desc: 'A와 B가 모두 켜졌을 때만 Y가 켜지게 연결하세요.',
    inputs: ['A', 'B'], outputs: ['Y'], parts: GATES, fn: (a, b) => [a & b] },
  { id: 'nand-not', title: 'NAND로 NOT 만들기', goal: 'Y = NOT A  (NAND만 사용)', desc: 'NAND 하나로 인버터를 만들 수 있을까요? 두 입력을 같은 신호에 묶어 보세요.',
    inputs: ['A'], outputs: ['Y'], parts: ['NAND'], fn: (a) => [a ? 0 : 1] },
  { id: 'xor', title: 'XOR 직접 만들기', goal: 'Y = A ⊕ B  (AND·OR·NOT만)', desc: 'XOR 칩 없이 둘 중 하나만 켜졌을 때 Y가 켜지게 만드세요.',
    inputs: ['A', 'B'], outputs: ['Y'], parts: ['AND', 'OR', 'NOT'], fn: (a, b) => [a ^ b] },
  { id: 'half-adder', title: '반가산기', goal: 'S = A ⊕ B,  C = A · B', desc: '1비트 두 개를 더합니다. S는 합, C는 올림(캐리)입니다.',
    inputs: ['A', 'B'], outputs: ['S', 'C'], parts: GATES, fn: (a, b) => [a ^ b, a & b] },
  { id: 'mux', title: '2:1 멀티플렉서', goal: 'Y = S ? B : A', desc: '선택 신호 S가 꺼지면 A를, 켜지면 B를 Y로 내보내세요.',
    inputs: ['A', 'B', 'S'], outputs: ['Y'], parts: GATES, fn: (a, b, s) => [s ? b : a] },
  { id: 'majority', title: '다수결 회로', goal: 'Y = 3개 중 2개 이상 ON', desc: '세 사람의 투표에서 과반이 찬성하면 Y가 켜집니다.',
    inputs: ['A', 'B', 'C'], outputs: ['Y'], parts: GATES, fn: (a, b, c) => [(a + b + c) >= 2 ? 1 : 0] },
  { id: 'full-adder', title: '전가산기', goal: 'S = A⊕B⊕Ci,  Co = 올림', desc: '아래 자리에서 올라온 Ci까지 더하는 1비트 전가산기입니다.',
    inputs: ['A', 'B', 'Ci'], outputs: ['S', 'Co'], parts: GATES, fn: (a, b, ci) => [a ^ b ^ ci, (a + b + ci) >= 2 ? 1 : 0] },
];

/** New circuit with the mission's switches (left) and LEDs (right), locked. */
export function buildMission(m) {
  const c = createCircuit();
  const spread = (n, i) => (i - (n - 1) / 2) * 3.5;
  m.inputs.forEach((l, i) => addPart(c, 'SWITCH', -9, spread(m.inputs.length, i), { label: l, locked: true }));
  m.outputs.forEach((l, i) => addPart(c, 'LED', 9, spread(m.outputs.length, i), { label: l, locked: true }));
  return c;
}

export function checkMission(c, m) {
  const tt = truthTable(c, m.inputs, m.outputs);
  const rows = tt.rows.map((r) => {
    const expected = m.fn(...r.bits);
    return { ...r, expected, ok: expected.every((v, i) => v === r.outs[i]) };
  });
  const violations = [...new Set(c.parts
    .filter((p) => p.type !== 'SWITCH' && p.type !== 'LED' && !m.parts.includes(p.type))
    .map((p) => p.type))];
  const gateCount = c.parts.filter((p) => GATES.includes(p.type)).length;
  return { rows, violations, stable: tt.stable, gateCount, pass: tt.stable && !violations.length && rows.every((r) => r.ok) };
}

export function serialize(c) {
  return JSON.stringify(c);
}

export function deserialize(json) {
  const c = JSON.parse(json);
  if (!Array.isArray(c.parts) || !Array.isArray(c.wires)) throw new Error('bad circuit');
  c.parts = c.parts.filter((p) => PARTS[p.type]);
  const ids = new Set(c.parts.map((p) => p.id));
  c.wires = c.wires.filter((w) => ids.has(w.from.part) && ids.has(w.to.part));
  c.nextId = Math.max(c.nextId || 1, ...c.parts.map((p) => p.id + 1), ...c.wires.map((w) => w.id + 1));
  return c;
}

/** Half adder demo for sandbox */
export function exampleCircuit() {
  const c = createCircuit();
  const a = addPart(c, 'SWITCH', -8, -3, { label: 'A' });
  const b = addPart(c, 'SWITCH', -8, 3, { label: 'B' });
  const x = addPart(c, 'XOR', 0, -3);
  const n = addPart(c, 'AND', 0, 3);
  const s = addPart(c, 'LED', 8, -3, { label: 'S' });
  const k = addPart(c, 'LED', 8, 3, { label: 'C' });
  const o = (part) => ({ part: part.id, pin: 0, kind: 'out' });
  const i = (part, pin) => ({ part: part.id, pin, kind: 'in' });
  connect(c, o(a), i(x, 0)); connect(c, o(b), i(x, 1));
  connect(c, o(a), i(n, 0)); connect(c, o(b), i(n, 1));
  connect(c, o(x), i(s, 0)); connect(c, o(n), i(k, 0));
  a.on = true;
  return c;
}
