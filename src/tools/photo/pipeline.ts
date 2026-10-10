/**
 * Non-destructive photo pipeline.
 *
 * Source pixels are never modified. A render is produced by replaying the
 * document (geometry → mask → tone → colour → detail → effects) at whatever
 * resolution the caller asks for, so the preview is fast and the export is full
 * quality from the same instructions.
 */

import { makeCanvas, ctx2d, clamp255, boxBlur, clamp } from '../../core/image';

export interface Adjustments {
  exposure: number;    // -100..100
  contrast: number;    // -100..100
  highlights: number;  // -100..100
  shadows: number;     // -100..100
  whites: number;      // -100..100
  blacks: number;      // -100..100
  temperature: number; // -100..100 (blue → amber)
  tint: number;        // -100..100 (green → magenta)
  vibrance: number;    // -100..100
  saturation: number;  // -100..100
  clarity: number;     // -100..100 local contrast
  sharpen: number;     // 0..100
  blur: number;        // 0..100
  vignette: number;    // -100..100
  grain: number;       // 0..100
  fade: number;        // 0..100 lifted blacks
  curve: Array<[number, number]>; // control points in 0..255 space
}

export interface Geometry {
  rot90: number;        // 0..3 quarter turns
  flipH: boolean;
  flipV: boolean;
  straighten: number;   // -15..15 degrees
  crop: { x: number; y: number; w: number; h: number } | null; // normalised 0..1
}

export interface PhotoDoc {
  adjust: Adjustments;
  geo: Geometry;
}

export function defaultAdjust(): Adjustments {
  return {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temperature: 0, tint: 0, vibrance: 0, saturation: 0,
    clarity: 0, sharpen: 0, blur: 0, vignette: 0, grain: 0, fade: 0,
    curve: [[0, 0], [255, 255]],
  };
}

export function defaultGeo(): Geometry {
  return { rot90: 0, flipH: false, flipV: false, straighten: 0, crop: null };
}

export function defaultDoc(): PhotoDoc {
  return { adjust: defaultAdjust(), geo: defaultGeo() };
}

export function isNeutral(a: Adjustments): boolean {
  const base = defaultAdjust();
  return (Object.keys(base) as Array<keyof Adjustments>).every((k) =>
    k === 'curve' ? a.curve.length === 2 && a.curve[0]![1] === 0 && a.curve[1]![1] === 255 : a[k] === base[k],
  );
}

/* ---------------- Curve ---------------- */

/**
 * Monotone cubic (Fritsch-Carlson) interpolation through the control points,
 * sampled into a 256-entry LUT.
 *
 * Plain Catmull-Rom is wrong here: it assumes evenly spaced knots, so a
 * two-point "straight line" curve came out as a heavy S-curve (32 -> 22,
 * 192 -> 204) and every photo picked up a hidden contrast boost. Monotone
 * cubic reduces to a true straight line for collinear points and can never
 * overshoot, which is exactly what a tone curve needs.
 */
export function buildCurveLut(points: Array<[number, number]>): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const pts = [...points]
    .map(([x, y]) => [clamp(x, 0, 255), clamp(y, 0, 255)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    // Drop duplicate x positions; they would divide by zero below.
    .filter((p, i, all) => i === 0 || p[0] > all[i - 1]![0]);

  if (pts.length < 2) {
    const flat = pts[0]?.[1];
    for (let i = 0; i < 256; i++) lut[i] = flat ?? i;
    return lut;
  }

  const n = pts.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1]![0] - pts[i]![0];
    delta[i] = (pts[i + 1]![1] - pts[i]![1]) / h[i]!;
  }

  // Tangents: one-sided at the ends, averaged secants in between.
  const m: number[] = new Array(n);
  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1]! * delta[i]! <= 0) m[i] = 0; // local extremum -> flatten
    else m[i] = (delta[i - 1]! + delta[i]!) / 2;
  }

  // Fritsch-Carlson limiter keeps every segment monotone (no overshoot).
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i]! / delta[i]!;
    const beta = m[i + 1]! / delta[i]!;
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * alpha * delta[i]!;
      m[i + 1] = tau * beta * delta[i]!;
    }
  }

  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0]![0]) { lut[x] = clamp255(pts[0]![1]); continue; }
    if (x >= pts[n - 1]![0]) { lut[x] = clamp255(pts[n - 1]![1]); continue; }
    while (seg < n - 2 && x > pts[seg + 1]![0]) seg++;
    const t = (x - pts[seg]![0]) / h[seg]!;
    const t2 = t * t;
    const t3 = t2 * t;
    // Hermite basis.
    const y =
      (2 * t3 - 3 * t2 + 1) * pts[seg]![1] +
      (t3 - 2 * t2 + t) * h[seg]! * m[seg]! +
      (-2 * t3 + 3 * t2) * pts[seg + 1]![1] +
      (t3 - t2) * h[seg]! * m[seg + 1]!;
    lut[x] = clamp255(y);
  }
  return lut;
}

/* ---------------- Geometry ---------------- */

export interface GeometryResult {
  canvas: HTMLCanvasElement;
  /** Maps source pixel coordinates → rendered canvas coordinates. */
  matrix: DOMMatrix;
}

/**
 * Apply rotation, straighten, flips and crop.
 * `mask`, when given, is an RGBA canvas whose alpha channel cuts the source.
 */
export function renderGeometry(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  geo: Geometry,
  maxEdge: number,
  mask?: HTMLCanvasElement | null,
): GeometryResult {
  const angle = ((geo.rot90 % 4) * 90 + geo.straighten) * (Math.PI / 180);
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const rotW = sw * cos + sh * sin;
  const rotH = sw * sin + sh * cos;

  const crop = geo.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const outWfull = Math.max(1, rotW * crop.w);
  const outHfull = Math.max(1, rotH * crop.h);
  const scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(outWfull, outHfull)) : 1;

  const canvas = makeCanvas(outWfull * scale, outHfull * scale);
  const g = ctx2d(canvas);
  g.imageSmoothingQuality = 'high';

  g.save();
  g.scale(scale, scale);
  g.translate(-crop.x * rotW, -crop.y * rotH);
  g.translate(rotW / 2, rotH / 2);
  g.rotate(angle);
  g.scale(geo.flipH ? -1 : 1, geo.flipV ? -1 : 1);
  g.translate(-sw / 2, -sh / 2);

  const matrix = g.getTransform();

  if (mask) {
    const cut = makeCanvas(sw, sh);
    const cg = ctx2d(cut);
    cg.drawImage(source, 0, 0, sw, sh);
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(mask, 0, 0, sw, sh);
    cg.globalCompositeOperation = 'source-over';
    g.drawImage(cut, 0, 0, sw, sh);
  } else {
    g.drawImage(source, 0, 0, sw, sh);
  }
  g.restore();

  return { canvas, matrix };
}

/* ---------------- Tone / colour ---------------- */

function toneLut(a: Adjustments): { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray } {
  const curve = buildCurveLut(a.curve);
  const exposure = 2 ** (a.exposure / 50);                 // ±2 stops
  const contrast = (a.contrast + 100) / 100;               // 0..2
  const whites = a.whites / 100;
  const blacks = a.blacks / 100;
  const fade = a.fade / 100;

  // Temperature: warm pushes red up / blue down. Tint pushes green vs magenta.
  const tempR = 1 + (a.temperature / 100) * 0.22;
  const tempB = 1 - (a.temperature / 100) * 0.22;
  const tintG = 1 - (a.tint / 100) * 0.16;

  const make = (channelMul: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      v *= exposure;
      v *= channelMul;
      // Whites act on the bright end, blacks on the dark end.
      v += whites * 0.35 * v * v * v;
      v += blacks * 0.35 * (1 - v) * (1 - v) * (1 - v);
      v = (v - 0.5) * contrast + 0.5;
      v = v * (1 - fade * 0.22) + fade * 0.22;           // lifted, filmic blacks
      out[i] = curve[clamp255(v * 255) | 0]!;
    }
    return out;
  };

  return { r: make(tempR), g: make(tintG), b: make(tempB) };
}

export function applyAdjustments(image: ImageData, a: Adjustments): ImageData {
  const { r: lutR, g: lutG, b: lutB } = toneLut(a);
  const data = image.data;
  const hi = a.highlights / 100;
  const sh = a.shadows / 100;
  const vib = a.vibrance / 100;
  const sat = a.saturation / 100;
  const needsLumaPass = hi !== 0 || sh !== 0 || vib !== 0 || sat !== 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = lutR[data[i]!]!;
    let g = lutG[data[i + 1]!]!;
    let b = lutB[data[i + 2]!]!;

    if (needsLumaPass) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      if (hi !== 0) {
        const w = Math.max(0, (l - 110) / 145); // weight toward bright pixels
        const f = 1 + hi * w * 0.85;
        r *= f; g *= f; b *= f;
      }
      if (sh !== 0) {
        const w = Math.max(0, (145 - l) / 145); // weight toward dark pixels
        const add = sh * w * 70;
        r += add; g += add; b += add;
      }

      if (sat !== 0 || vib !== 0) {
        const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const chroma = (mx - mn) / 255;
        // Vibrance protects already-saturated pixels (and skin-ish tones).
        const amount = sat + vib * (1 - chroma) * (1 - chroma);
        const f = 1 + amount;
        r = l2 + (r - l2) * f;
        g = l2 + (g - l2) * f;
        b = l2 + (b - l2) * f;
      }
    }

    data[i] = clamp255(r);
    data[i + 1] = clamp255(g);
    data[i + 2] = clamp255(b);
  }
  return image;
}

/* ---------------- Detail & effects ---------------- */

function unsharp(image: ImageData, amount: number, radius: number): void {
  if (amount === 0 || radius < 1) return;
  const blurred = boxBlur(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), radius);
  const src = image.data;
  const bl = blurred.data;
  for (let i = 0; i < src.length; i += 4) {
    src[i] = clamp255(src[i]! + (src[i]! - bl[i]!) * amount);
    src[i + 1] = clamp255(src[i + 1]! + (src[i + 1]! - bl[i + 1]!) * amount);
    src[i + 2] = clamp255(src[i + 2]! + (src[i + 2]! - bl[i + 2]!) * amount);
  }
}

function applyVignette(image: ImageData, amount: number): void {
  if (!amount) return;
  const { width: w, height: h, data } = image;
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.hypot(cx, cy);
  const strength = amount / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const falloff = Math.pow(Math.max(0, d - 0.35) / 0.65, 1.7);
      const f = 1 - strength * falloff;
      const i = (y * w + x) * 4;
      data[i] = clamp255(data[i]! * f);
      data[i + 1] = clamp255(data[i + 1]! * f);
      data[i + 2] = clamp255(data[i + 2]! * f);
    }
  }
}

function applyGrain(image: ImageData, amount: number): void {
  if (!amount) return;
  const data = image.data;
  const strength = (amount / 100) * 42;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    data[i] = clamp255(data[i]! + n);
    data[i + 1] = clamp255(data[i + 1]! + n);
    data[i + 2] = clamp255(data[i + 2]! + n);
  }
}

/* ---------------- Full render ---------------- */

export interface RenderOptions {
  maxEdge: number;
  /** Skip expensive detail work while a slider is being dragged. */
  fast?: boolean;
  mask?: HTMLCanvasElement | null;
}

export function renderPhoto(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  doc: PhotoDoc,
  opts: RenderOptions,
): GeometryResult {
  const geo = renderGeometry(source, sw, sh, doc.geo, opts.maxEdge, opts.mask);
  const g = ctx2d(geo.canvas, { willReadFrequently: true });
  const a = doc.adjust;

  const image = g.getImageData(0, 0, geo.canvas.width, geo.canvas.height);
  applyAdjustments(image, a);

  const edge = Math.max(geo.canvas.width, geo.canvas.height);
  const detailScale = edge / 1200;

  if (!opts.fast) {
    if (a.blur > 0) {
      const radius = Math.max(1, Math.round((a.blur / 100) * 22 * Math.max(0.4, detailScale)));
      const blurred = boxBlur(image, radius);
      image.data.set(blurred.data);
    }
    if (a.clarity !== 0) {
      unsharp(image, (a.clarity / 100) * 0.9, Math.max(2, Math.round(10 * Math.max(0.4, detailScale))));
    }
    if (a.sharpen > 0) {
      unsharp(image, (a.sharpen / 100) * 1.3, Math.max(1, Math.round(1.6 * Math.max(0.5, detailScale))));
    }
  }

  applyVignette(image, a.vignette);
  if (!opts.fast) applyGrain(image, a.grain);

  g.putImageData(image, 0, 0);
  return geo;
}

/* ---------------- Looks ---------------- */

export interface Preset {
  id: string;
  name: string;
  patch: Partial<Adjustments>;
}

export const PRESETS: Preset[] = [
  { id: 'none', name: 'Original', patch: {} },
  { id: 'punch', name: 'Punch', patch: { contrast: 22, vibrance: 28, clarity: 18, shadows: 8 } },
  { id: 'soft', name: 'Soft light', patch: { exposure: 8, contrast: -12, highlights: -18, shadows: 22, fade: 18, saturation: -6 } },
  { id: 'film', name: 'Film 400', patch: { contrast: 12, fade: 26, grain: 32, temperature: 8, saturation: -10, shadows: 14 } },
  { id: 'noir', name: 'Noir', patch: { saturation: -100, contrast: 34, clarity: 26, blacks: -18, vignette: 32 } },
  { id: 'silver', name: 'Silver', patch: { saturation: -100, contrast: 8, fade: 20, highlights: -10, shadows: 16 } },
  { id: 'golden', name: 'Golden', patch: { temperature: 28, exposure: 6, highlights: -14, vibrance: 18, vignette: 14 } },
  { id: 'cool', name: 'Cold press', patch: { temperature: -26, tint: -6, contrast: 14, clarity: 12, saturation: -8 } },
  { id: 'fade', name: 'Faded', patch: { fade: 38, contrast: -8, saturation: -18, highlights: -12 } },
  { id: 'cine', name: 'Cinema', patch: { contrast: 18, shadows: 20, highlights: -22, temperature: -8, vignette: 22, curve: [[0, 16], [70, 62], [180, 196], [255, 240]] as Array<[number, number]> } },
  { id: 'vivid', name: 'Vivid', patch: { saturation: 24, vibrance: 20, contrast: 16, sharpen: 20 } },
  { id: 'matte', name: 'Matte', patch: { fade: 30, blacks: 14, highlights: -16, saturation: -12, grain: 12 } },
];

export function applyPreset(adjust: Adjustments, preset: Preset): Adjustments {
  const next = defaultAdjust();
  Object.assign(next, preset.patch);
  next.curve = preset.patch.curve ? preset.patch.curve.map((p) => [...p] as [number, number]) : [[0, 0], [255, 255]];
  return { ...next, blur: adjust.blur };
}
