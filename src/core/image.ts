/** Canvas + imaging helpers shared by every tool. */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, opts: CanvasRenderingContext2DSettings = {}): CanvasRenderingContext2D {
  const g = c.getContext('2d', { willReadFrequently: false, ...opts });
  if (!g) throw new Error('Canvas 2D is unavailable in this browser.');
  return g;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be opened.'));
    };
    img.src = url;
  });
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be loaded.'));
    img.src = url;
  });
}

/** Draw an image into a new canvas, capped to `maxEdge` on the long side. */
export function imageToCanvas(img: CanvasImageSource, w: number, h: number, maxEdge = 0): HTMLCanvasElement {
  let tw = w;
  let th = h;
  if (maxEdge > 0) {
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    tw = Math.round(w * scale);
    th = Math.round(h * scale);
  }
  const c = makeCanvas(tw, th);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, tw, th);
  return c;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed — the canvas may be too large.'))),
      type,
      quality,
    );
  });
}

export async function canvasThumb(canvas: HTMLCanvasElement, size = 220): Promise<Blob> {
  const scale = Math.min(1, size / Math.max(canvas.width, canvas.height));
  const t = makeCanvas(canvas.width * scale, canvas.height * scale);
  const g = ctx2d(t);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, t.width, t.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, t.width, t.height);
  return canvasToBlob(t, 'image/jpeg', 0.8);
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(name: string, fallback = 'mosaic'): string {
  const clean = String(name ?? '')
    .trim()
    .replace(/[^a-z0-9-_ ]+/gi, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return clean || fallback;
}

/** Open a native file picker and resolve with the chosen files. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    // If the user cancels, `cancel` fires in modern browsers; window focus is the fallback.
    input.addEventListener('cancel', () => done([]));
    window.addEventListener(
      'focus',
      () => setTimeout(() => done(Array.from(input.files ?? [])), 400),
      { once: true },
    );
    input.click();
  });
}

/* ---------------- Colour helpers ---------------- */

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const f = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Perceived luminance 0..255 */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/* ---------------- Pointer helpers ---------------- */

export interface Pt { x: number; y: number; pressure: number; }

/** Convert a pointer event into canvas pixel coordinates. */
export function canvasPoint(canvas: HTMLCanvasElement, e: PointerEvent): Pt {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height,
    pressure: e.pressure && e.pressure > 0 && e.pointerType !== 'mouse' ? e.pressure : 0.5,
  };
}

/* ---------------- Histogram ---------------- */

export function computeHistogram(data: Uint8ClampedArray): { r: number[]; g: number[]; b: number[]; max: number } {
  const r = new Array<number>(256).fill(0);
  const g = new Array<number>(256).fill(0);
  const b = new Array<number>(256).fill(0);
  // Sample for speed on large images.
  const step = data.length > 4_000_000 ? 16 : 4;
  for (let i = 0; i < data.length; i += step) {
    r[data[i]!]! ++;
    g[data[i + 1]!]! ++;
    b[data[i + 2]!]! ++;
  }
  let max = 1;
  for (let i = 0; i < 256; i++) max = Math.max(max, r[i]!, g[i]!, b[i]!);
  return { r, g, b, max };
}

export function drawHistogram(canvas: HTMLCanvasElement, hist: { r: number[]; g: number[]; b: number[]; max: number }): void {
  const g = ctx2d(canvas);
  const w = canvas.width;
  const hgt = canvas.height;
  g.clearRect(0, 0, w, hgt);
  const channels: Array<[number[], string]> = [
    [hist.r, 'rgba(255,99,99,.65)'],
    [hist.g, 'rgba(120,224,143,.65)'],
    [hist.b, 'rgba(120,169,255,.65)'],
  ];
  g.globalCompositeOperation = 'lighter';
  for (const [vals, color] of channels) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, hgt);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = hgt - (vals[i]! / hist.max) * hgt;
      g.lineTo(x, y);
    }
    g.lineTo(w, hgt);
    g.closePath();
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

/* ---------------- Blur (fast separable box blur ≈ gaussian) ---------------- */

export function boxBlur(src: ImageData, radius: number): ImageData {
  if (radius < 1) return src;
  const { width: w, height: h } = src;
  const out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const tmp = new Uint8ClampedArray(src.data.length);
  const passes = 3;
  let from = out.data;
  let to = tmp;
  for (let p = 0; p < passes; p++) {
    boxBlurH(from, to, w, h, radius);
    boxBlurV(to, from, w, h, radius);
  }
  return out;
}

function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = r + r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let ra = 0, ga = 0, ba = 0, aa = 0;
    for (let i = -r; i <= r; i++) {
      const x = Math.min(w - 1, Math.max(0, i)) * 4 + row;
      ra += src[x]!; ga += src[x + 1]!; ba += src[x + 2]!; aa += src[x + 3]!;
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = ra / div; dst[o + 1] = ga / div; dst[o + 2] = ba / div; dst[o + 3] = aa / div;
      const add = (Math.min(w - 1, x + r + 1)) * 4 + row;
      const sub = (Math.max(0, x - r)) * 4 + row;
      ra += src[add]! - src[sub]!;
      ga += src[add + 1]! - src[sub + 1]!;
      ba += src[add + 2]! - src[sub + 2]!;
      aa += src[add + 3]! - src[sub + 3]!;
    }
  }
}

function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = r + r + 1;
  for (let x = 0; x < w; x++) {
    const col = x * 4;
    let ra = 0, ga = 0, ba = 0, aa = 0;
    for (let i = -r; i <= r; i++) {
      const y = Math.min(h - 1, Math.max(0, i)) * w * 4 + col;
      ra += src[y]!; ga += src[y + 1]!; ba += src[y + 2]!; aa += src[y + 3]!;
    }
    for (let y = 0; y < h; y++) {
      const o = y * w * 4 + col;
      dst[o] = ra / div; dst[o + 1] = ga / div; dst[o + 2] = ba / div; dst[o + 3] = aa / div;
      const add = Math.min(h - 1, y + r + 1) * w * 4 + col;
      const sub = Math.max(0, y - r) * w * 4 + col;
      ra += src[add]! - src[sub]!;
      ga += src[add + 1]! - src[sub + 1]!;
      ba += src[add + 2]! - src[sub + 2]!;
      aa += src[add + 3]! - src[sub + 3]!;
    }
  }
}
