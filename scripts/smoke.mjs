/**
 * Headless smoke test: boots the production bundle in jsdom, walks every route
 * and reports uncaught errors. Canvas is stubbed because jsdom has no 2D context.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = resolve('dist');
const errors = [];
const logs = [];

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));
vc.on('warn', (...a) => logs.push(`warn: ${a.join(' ')}`));

const html = readFileSync(join(dist, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'https://example.test/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const { window } = dom;

/* ---- stubs jsdom lacks ---- */
function fakeCtx() {
  const noop = () => {};
  const handler = {
    get(_t, prop) {
      if (prop === 'canvas') return { width: 10, height: 10 };
      if (prop === 'measureText') return () => ({ width: 42 });
      if (prop === 'getImageData') return (x, y, w, h) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w || 1, height: h || 1,
      });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (prop === 'getTransform') return () => new window.DOMMatrix();
      if (prop === 'save' || prop === 'restore') return noop;
      return (...args) => { void args; };
    },
    set() { return true; },
  };
  return new Proxy({}, handler);
}
window.HTMLCanvasElement.prototype.getContext = function getContext() { return fakeCtx(); };
window.HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { cb(new window.Blob([''], { type: 'image/png' })); };
window.HTMLCanvasElement.prototype.captureStream = () => ({ getTracks: () => [], addTrack() {}, getVideoTracks: () => [] });
window.ImageData = class ImageData {
  constructor(a, b, c) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = c ?? 1; }
  }
};
window.DOMMatrix = window.DOMMatrix || class { inverse() { return this; } transformPoint(p) { return p; } };
window.DOMPoint = window.DOMPoint || class { constructor(x, y) { this.x = x; this.y = y; } };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);
window.structuredClone = window.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));
window.indexedDB = undefined;
window.scrollTo = () => {};
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.navigator.storage = { estimate: async () => ({ usage: 1024, quota: 1024 * 1024 }) };

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

// Bridge every browser global jsdom provides into the Node module scope so the
// production bundle can run unmodified.
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => window[key],
      set: (v) => { window[key] = v; },
    });
  } catch { /* some props are not forwardable */ }
}
for (const key of ['MutationObserver', 'HTMLElement', 'SVGElement', 'Event', 'CustomEvent', 'Node', 'Blob', 'File', 'FileReader', 'DOMParser', 'XMLSerializer', 'Image', 'getComputedStyle', 'location', 'history', 'localStorage', 'HashChangeEvent', 'KeyboardEvent', 'PointerEvent', 'CSS']) {
  if (window[key] !== undefined) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
  }
}

/* ---- load every built chunk through the module loader ---- */
const assetsDir = join(dist, 'assets');
const entry = readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
if (!entry) throw new Error('no entry chunk found in dist/assets');

globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '' }, blob: async () => new window.Blob([]), text: async () => '', json: async () => ({}) });

// Vite emits ESM; import it directly with the stubbed globals in place.
const mod = pathToFileURL(join(assetsDir, entry)).href;
await import(mod);

globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => '' }, blob: async () => new window.Blob([]), text: async () => '', json: async () => ({}) });
process.on('unhandledRejection', (r) => errors.push(`unhandledRejection: ${r && r.message ? r.message : r}`));

const routes = ['/', '/projects', '/learn', '/settings', '/photo', '/draw', '/design', '/motion', '/video', '/pdf'];

async function visit(path) {
  window.location.hash = `#${path}`;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await new Promise((r) => setTimeout(r, 260));
  const root = window.document.getElementById('root');
  const text = (root?.textContent ?? '').trim();
  return { path, nodes: root?.querySelectorAll('*').length ?? 0, hasText: text.length > 0 };
}

const results = [];
for (const r of routes) results.push(await visit(r));

console.log('\nROUTE RENDER REPORT');
for (const r of results) {
  const ok = r.nodes > 8 && r.hasText;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${r.path.padEnd(11)} nodes=${r.nodes}`);
}
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of [...new Set(errors)]) console.log(' -', e);
} else {
  console.log('\nNo uncaught errors.');
}
process.exit(errors.length ? 1 : 0);
