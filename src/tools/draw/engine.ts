/** Layered raster painting engine. */

import { makeCanvas, ctx2d, clamp255, hexToRgb, type Pt } from '../../core/image';

export type BlendMode =
  | 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light' | 'difference'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

export const BLEND_MODES: Array<{ value: BlendMode; label: string }> = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Dodge' },
  { value: 'color-burn', label: 'Burn' },
  { value: 'soft-light', label: 'Soft light' },
  { value: 'hard-light', label: 'Hard light' },
  { value: 'difference', label: 'Difference' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Colour' },
  { value: 'luminosity', label: 'Luminosity' },
];

export interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  locked: boolean;
}

export class LayerStack {
  layers: Layer[] = [];
  activeId = '';
  readonly width: number;
  readonly height: number;
  private counter = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  get active(): Layer | undefined {
    return this.layers.find((l) => l.id === this.activeId);
  }

  add(name?: string, atTop = true): Layer {
    this.counter += 1;
    const layer: Layer = {
      id: `l${this.counter}-${Math.random().toString(36).slice(2, 6)}`,
      name: name ?? `Layer ${this.counter}`,
      canvas: makeCanvas(this.width, this.height),
      visible: true,
      opacity: 1,
      blend: 'source-over',
      locked: false,
    };
    if (atTop) this.layers.push(layer);
    else this.layers.unshift(layer);
    this.activeId = layer.id;
    return layer;
  }

  remove(id: string): void {
    if (this.layers.length <= 1) return;
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    this.layers.splice(idx, 1);
    this.activeId = this.layers[Math.max(0, idx - 1)]!.id;
  }

  duplicate(id: string): void {
    const idx = this.layers.findIndex((l) => l.id === id);
    const src = this.layers[idx];
    if (!src) return;
    this.counter += 1;
    const copy: Layer = {
      ...src,
      id: `l${this.counter}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${src.name} copy`,
      canvas: makeCanvas(this.width, this.height),
    };
    ctx2d(copy.canvas).drawImage(src.canvas, 0, 0);
    this.layers.splice(idx + 1, 0, copy);
    this.activeId = copy.id;
  }

  move(id: string, delta: number): void {
    const idx = this.layers.findIndex((l) => l.id === id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= this.layers.length) return;
    const [layer] = this.layers.splice(idx, 1);
    this.layers.splice(next, 0, layer!);
  }

  mergeDown(id: string): void {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return;
    const upper = this.layers[idx]!;
    const lower = this.layers[idx - 1]!;
    const g = ctx2d(lower.canvas);
    g.save();
    g.globalAlpha = upper.opacity;
    g.globalCompositeOperation = upper.blend;
    g.drawImage(upper.canvas, 0, 0);
    g.restore();
    this.layers.splice(idx, 1);
    this.activeId = lower.id;
  }

  /** Flatten every visible layer onto one canvas. */
  composite(target?: HTMLCanvasElement, background?: string): HTMLCanvasElement {
    const out = target ?? makeCanvas(this.width, this.height);
    out.width = this.width;
    out.height = this.height;
    const g = ctx2d(out);
    g.clearRect(0, 0, out.width, out.height);
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, out.width, out.height);
    }
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      g.save();
      g.globalAlpha = layer.opacity;
      g.globalCompositeOperation = layer.blend;
      g.drawImage(layer.canvas, 0, 0);
      g.restore();
    }
    return out;
  }
}

/* ---------------- Brushes ---------------- */

export type BrushKind = 'pen' | 'marker' | 'pencil' | 'airbrush' | 'eraser';

export const BRUSHES: Array<{ value: BrushKind; label: string }> = [
  { value: 'pen', label: 'Ink pen' },
  { value: 'marker', label: 'Marker' },
  { value: 'pencil', label: 'Pencil' },
  { value: 'airbrush', label: 'Airbrush' },
  { value: 'eraser', label: 'Eraser' },
];

export interface BrushSettings {
  kind: BrushKind;
  size: number;
  opacity: number;   // 0..1
  hardness: number;  // 0..1
  flow: number;      // 0..1
  pressure: boolean;
  smoothing: number; // 0..1
  color: string;
}

export function defaultBrush(): BrushSettings {
  return { kind: 'pen', size: 18, opacity: 1, hardness: 0.85, flow: 1, pressure: true, smoothing: 0.4, color: '#1d2420' };
}

/** Draw one brush dab. */
function dab(g: CanvasRenderingContext2D, x: number, y: number, radius: number, brush: BrushSettings, alpha: number): void {
  const [r, gg, b] = hexToRgb(brush.color);
  if (brush.kind === 'pencil') {
    // Grainy, slightly scattered dots.
    const n = Math.max(3, Math.round(radius * 1.6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius;
      g.fillStyle = `rgba(${r},${gg},${b},${alpha * (0.22 + Math.random() * 0.3)})`;
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.1, 1.1);
    }
    return;
  }

  if (brush.kind === 'airbrush' || brush.hardness < 0.99) {
    const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(0.6, radius));
    const inner = brush.kind === 'airbrush' ? 0 : brush.hardness;
    grad.addColorStop(0, `rgba(${r},${gg},${b},${alpha})`);
    grad.addColorStop(Math.min(0.98, inner), `rgba(${r},${gg},${b},${alpha * (brush.kind === 'airbrush' ? 0.5 : 1)})`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
  } else {
    g.fillStyle = `rgba(${r},${gg},${b},${alpha})`;
  }
  g.beginPath();
  g.arc(x, y, Math.max(0.5, radius), 0, Math.PI * 2);
  g.fill();
}

/** Paint a stroke segment, spacing dabs so lines stay smooth. */
export function strokeSegment(
  g: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  brush: BrushSettings,
): void {
  g.save();
  g.globalCompositeOperation = brush.kind === 'eraser' ? 'destination-out' : 'source-over';

  const pFrom = brush.pressure ? from.pressure : 0.5;
  const pTo = brush.pressure ? to.pressure : 0.5;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const baseRadius = brush.size / 2;
  const spacing = Math.max(0.6, baseRadius * (brush.kind === 'airbrush' ? 0.16 : 0.22));
  const steps = Math.max(1, Math.ceil(dist / spacing));
  const alpha = brush.opacity * brush.flow * (brush.kind === 'marker' ? 0.42 : 1);

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const pressure = pFrom + (pTo - pFrom) * t;
    const radius = baseRadius * (brush.pressure ? 0.35 + pressure * 1.3 : 1);
    dab(g, x, y, radius, brush, alpha);
  }
  g.restore();
}

/* ---------------- Flood fill ---------------- */

export function floodFill(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  color: string,
  tolerance: number,
): void {
  const g = ctx2d(canvas, { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

  const start = (sy * w + sx) * 4;
  const sr = d[start]!, sg = d[start + 1]!, sb = d[start + 2]!, sa = d[start + 3]!;
  const [fr, fg, fb] = hexToRgb(color);
  if (sr === fr && sg === fg && sb === fb && sa === 255) return;

  const tol = (tolerance / 100) * 180;
  const tol2 = tol * tol * 3 + 1;
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];

  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    const i = p * 4;
    const dr = d[i]! - sr, dg = d[i + 1]! - sg, db = d[i + 2]! - sb, da = d[i + 3]! - sa;
    if (dr * dr + dg * dg + db * db + da * da > tol2) continue;
    seen[p] = 1;
    d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
    const px = p % w;
    const py = (p / w) | 0;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }
  g.putImageData(img, 0, 0);
}

export function pickColor(canvas: HTMLCanvasElement, x: number, y: number): string | null {
  const g = ctx2d(canvas, { willReadFrequently: true });
  const d = g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  if (d[3] === 0) return null;
  const f = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${f(d[0]!)}${f(d[1]!)}${f(d[2]!)}`;
}

/* ---------------- Canvas presets ---------------- */

export const CANVAS_PRESETS: Array<{ value: string; label: string; w: number; h: number }> = [
  { value: 'square', label: 'Square 1:1 · 1400', w: 1400, h: 1400 },
  { value: 'landscape', label: 'Landscape 4:3 · 1600', w: 1600, h: 1200 },
  { value: 'portrait', label: 'Portrait 4:5 · 1200', w: 1200, h: 1500 },
  { value: 'story', label: 'Story 9:16 · 1080', w: 1080, h: 1920 },
  { value: 'wide', label: 'Wide 16:9 · 1920', w: 1920, h: 1080 },
  { value: 'a4', label: 'A4 portrait · 150dpi', w: 1240, h: 1754 },
];
