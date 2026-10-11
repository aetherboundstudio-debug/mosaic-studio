/**
 * Runs the real imaging pipeline in Node against a hardware-accurate 2D canvas
 * (@napi-rs/canvas), so the maths that powers Photo, Paint, Design and Motion
 * is verified rather than assumed.
 */
import { createCanvas, Image as NapiImage } from '@napi-rs/canvas';

/* ---- make the browser canvas API available to the bundle ---- */
function wrap(canvas) {
  canvas.style = {};
  canvas.className = '';
  canvas.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  canvas.addEventListener = () => {};
  canvas.removeEventListener = () => {};
  canvas.setAttribute = () => {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height });
  canvas.toBlob = (cb) => cb(new Blob([canvas.toBuffer('image/png')], { type: 'image/png' }));
  return canvas;
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return wrap(createCanvas(1, 1));
    return { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {} } };
  },
  createElementNS() {
    return { setAttribute() {}, set innerHTML(_v) {}, appendChild() {} };
  },
  body: { appendChild() {}, removeChild() {} },
};
globalThis.Image = NapiImage;
globalThis.ImageData = (await import('@napi-rs/canvas')).ImageData;
globalThis.DOMMatrix = (await import('@napi-rs/canvas')).DOMMatrix;
globalThis.DOMPoint = class DOMPoint {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
};

const lib = await import('../.tmp-test/test-entry.js');

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name} ${detail}`); }
}

function makeSource(w = 240, h = 160) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  // Left half mid-grey, right half a saturated blue, plus a white corner patch.
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w / 2, h);
  g.fillStyle = '#2050c0';
  g.fillRect(w / 2, 0, w / 2, h);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 24, 24);
  return wrap(c);
}

function pixelAt(canvas, x, y) {
  return canvas.getContext('2d').getImageData(x, y, 1, 1).data;
}

console.log('\nPIPELINE TESTS');

/* ---- tone curve ---- */
{
  const flat = lib.buildCurveLut([[0, 0], [255, 255]]);
  let worst = 0;
  let worstAt = -1;
  for (let i = 0; i < 256; i++) {
    const d = Math.abs(flat[i] - i);
    if (d > worst) { worst = d; worstAt = i; }
  }
  check('curve: the default two-point curve is a true identity', worst <= 1, `off by ${worst} at input ${worstAt}`);
  const mono = lib.buildCurveLut([[0, 0], [64, 40], [192, 215], [255, 255]]);
  let monotone = true;
  for (let i = 1; i < 256; i++) if (mono[i] < mono[i - 1]) monotone = false;
  check('curve: a shaped curve never overshoots or reverses', monotone);
  const lifted = lib.buildCurveLut([[0, 40], [255, 255]]);
  check('curve: lifted blacks raise the floor', lifted[0] >= 38 && lifted[0] <= 42, `got ${lifted[0]}`);
  const sCurve = lib.buildCurveLut([[0, 0], [64, 40], [192, 215], [255, 255]]);
  check('curve: S-curve darkens shadows and lifts highlights', sCurve[64] < 64 && sCurve[192] > 192, `${sCurve[64]} / ${sCurve[192]}`);
}

/* ---- adjustments ---- */
{
  const src = makeSource();
  const base = pixelAt(src, 10, 100);

  const brighter = lib.renderPhoto(src, src.width, src.height,
    { adjust: { ...lib.defaultAdjust(), exposure: 50 }, geo: lib.defaultGeo() },
    { maxEdge: 0 });
  const after = pixelAt(brighter.canvas, 10, 100);
  check('exposure: +50 brightens mid grey', after[0] > base[0] + 20, `${base[0]} → ${after[0]}`);

  const mono = lib.renderPhoto(src, src.width, src.height,
    { adjust: { ...lib.defaultAdjust(), saturation: -100 }, geo: lib.defaultGeo() },
    { maxEdge: 0 });
  const m = pixelAt(mono.canvas, 200, 80);
  check('saturation: -100 is neutral grey', Math.abs(m[0] - m[1]) <= 2 && Math.abs(m[1] - m[2]) <= 2, `${m[0]},${m[1]},${m[2]}`);

  const warm = lib.renderPhoto(src, src.width, src.height,
    { adjust: { ...lib.defaultAdjust(), temperature: 80 }, geo: lib.defaultGeo() },
    { maxEdge: 0 });
  const w = pixelAt(warm.canvas, 10, 100);
  check('warmth: +80 pushes red above blue', w[0] > w[2] + 20, `${w[0]} vs ${w[2]}`);

  const vign = lib.renderPhoto(src, src.width, src.height,
    { adjust: { ...lib.defaultAdjust(), vignette: 90 }, geo: lib.defaultGeo() },
    { maxEdge: 0 });
  const corner = pixelAt(vign.canvas, 2, 158);
  const centre = pixelAt(vign.canvas, 120, 80);
  check('vignette: corners darker than centre', corner[0] < centre[0], `${corner[0]} vs ${centre[0]}`);

  const neutral = lib.renderPhoto(src, src.width, src.height,
    { adjust: lib.defaultAdjust(), geo: lib.defaultGeo() }, { maxEdge: 0 });
  const n = pixelAt(neutral.canvas, 200, 80);
  const o = pixelAt(src, 200, 80);
  check('neutral: zeroed sliders round-trip the pixel',
    Math.abs(n[0] - o[0]) <= 2 && Math.abs(n[1] - o[1]) <= 2 && Math.abs(n[2] - o[2]) <= 2,
    `${o[0]},${o[1]},${o[2]} → ${n[0]},${n[1]},${n[2]}`);
}

/* ---- geometry ---- */
{
  const src = makeSource(240, 160);
  const rot = lib.renderGeometry(src, 240, 160, { ...lib.defaultGeo(), rot90: 1 }, 0);
  check('geometry: 90° turn swaps the aspect', Math.round(rot.canvas.width) === 160 && Math.round(rot.canvas.height) === 240,
    `${rot.canvas.width}×${rot.canvas.height}`);

  const cropped = lib.renderGeometry(src, 240, 160, { ...lib.defaultGeo(), crop: { x: 0, y: 0, w: 0.5, h: 1 } }, 0);
  check('geometry: crop halves the width', Math.round(cropped.canvas.width) === 120, `${cropped.canvas.width}`);

  const flip = lib.renderGeometry(src, 240, 160, { ...lib.defaultGeo(), flipH: true }, 0);
  const rightEdge = pixelAt(flip.canvas, 10, 100);
  check('geometry: horizontal flip moves the blue half left', rightEdge[2] > rightEdge[0], `${rightEdge[0]},${rightEdge[2]}`);

  const inv = rot.matrix.inverse();
  const mapped = inv.transformPoint(new DOMPoint(0, 0));
  check('geometry: transform is invertible', Number.isFinite(mapped.x) && Number.isFinite(mapped.y), `${mapped.x},${mapped.y}`);
}

/* ---- cutout ---- */
{
  const src = makeSource(120, 80);
  const data = src.getContext('2d').getImageData(0, 0, 120, 80).data;
  const sel = lib.magicWand(data, 120, 80, [[5, 5]], { tolerance: 10, contiguous: true, sampleEdges: false });
  let count = 0;
  for (const v of sel) count += v;
  check('wand: selects the white patch only', count > 400 && count < 700, `selected ${count} px (expect ~576)`);

  const loose = lib.magicWand(data, 120, 80, [[5, 5]], { tolerance: 100, contiguous: false, sampleEdges: false });
  let loosecount = 0;
  for (const v of loose) loosecount += v;
  check('wand: high tolerance grows the selection', loosecount > count, `${count} → ${loosecount}`);

  const mask = lib.createMask(120, 80);
  check('mask: starts fully opaque', lib.isMaskEmpty(mask));
  lib.applySelection(mask, sel, 'cut');
  check('mask: cutting makes it non-empty', !lib.isMaskEmpty(mask));
  const maskPx = pixelAt(mask, 5, 5);
  check('mask: cut pixels are transparent', maskPx[3] === 0, `alpha ${maskPx[3]}`);
  lib.invertMask(mask);
  check('mask: invert flips the cut', pixelAt(mask, 5, 5)[3] === 255);
}

/* ---- layers ---- */
{
  const stack = new lib.LayerStack(60, 40);
  const a = stack.add('one');
  const ctxA = a.canvas.getContext('2d');
  ctxA.fillStyle = '#ff0000';
  ctxA.fillRect(0, 0, 60, 40);
  const b = stack.add('two');
  const ctxB = b.canvas.getContext('2d');
  ctxB.fillStyle = '#0000ff';
  ctxB.fillRect(0, 0, 60, 40);

  let flat = stack.composite();
  check('layers: the top layer wins', pixelAt(flat, 30, 20)[2] > 200);

  b.visible = false;
  flat = stack.composite();
  check('layers: hiding reveals the layer below', pixelAt(flat, 30, 20)[0] > 200);

  b.visible = true;
  b.opacity = 0.5;
  flat = stack.composite();
  const blended = pixelAt(flat, 30, 20);
  check('layers: 50% opacity blends both', blended[0] > 80 && blended[2] > 80, `${blended[0]},${blended[2]}`);

  b.opacity = 1;
  stack.mergeDown(b.id);
  check('layers: merge down collapses two layers into one', stack.layers.length === 1, `${stack.layers.length}`);
  check('layers: merged result keeps the top pixels', pixelAt(stack.composite(), 30, 20)[2] > 200);

  const before = stack.layers.length;
  stack.duplicate(stack.activeId);
  check('layers: duplicate adds a layer', stack.layers.length === before + 1);
}

/* ---- flood fill ---- */
{
  const canvas = wrap(createCanvas(40, 40));
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 40, 40);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, 40, 20);
  lib.floodFill(canvas, 20, 30, '#00ff00', 10);
  check('fill: paints the clicked region', pixelAt(canvas, 20, 30)[1] > 200);
  check('fill: respects the edge', pixelAt(canvas, 20, 5)[1] < 50);
}

/* ---- motion ---- */
{
  const doc = lib.defaultMotionDoc();
  const atZero = lib.renderMotionFrame(doc, 0, 0.25);
  const midway = lib.renderMotionFrame(doc, 1.6, 0.25);
  const a = atZero.getContext('2d').getImageData(0, 0, atZero.width, atZero.height).data;
  const b = midway.getContext('2d').getImageData(0, 0, midway.width, midway.height).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 40) diff += Math.abs(a[i] - b[i]);
  check('motion: the frame actually animates', diff > 500, `diff ${diff}`);
  check('motion: easing stays in range',
    lib.ease('bounce', 0) === 0 && Math.abs(lib.ease('bounce', 1) - 1) < 0.001 && lib.ease('easeOut', 0.5) > 0.5);
}

/* ---- design ---- */
{
  for (const template of lib.TEMPLATES) {
    const doc = template.build();
    const out = lib.renderDesign(doc, new Map(), 0.2);
    check(`design: template "${template.name}" renders`, out.width > 10 && out.height > 10, `${out.width}×${out.height}`);
  }
  const doc = lib.TEMPLATES[1].build();
  const hit = lib.hitTest(doc, doc.items[1].x + 5, doc.items[1].y + 5);
  check('design: hit testing finds the object under the point', hit !== null && hit.id === doc.items[1].id);
  const miss = lib.hitTest(doc, -50, -50);
  check('design: hit testing misses outside the page', miss === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
