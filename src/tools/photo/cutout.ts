/**
 * Mask-based cutouts.
 * The mask is an RGBA canvas whose alpha channel decides what survives:
 * 255 = keep, 0 = cut away. Nothing is ever deleted from the source.
 */

import { makeCanvas, ctx2d, boxBlur } from '../../core/image';

export function createMask(w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = ctx2d(c, { willReadFrequently: true });
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export function isMaskEmpty(mask: HTMLCanvasElement): boolean {
  const g = ctx2d(mask, { willReadFrequently: true });
  const d = g.getImageData(0, 0, mask.width, mask.height).data;
  const step = Math.max(4, Math.floor(d.length / 40000) * 4);
  for (let i = 3; i < d.length; i += step) if (d[i]! < 250) return false;
  return true;
}

export interface WandOptions {
  tolerance: number;   // 0..100
  contiguous: boolean;
  sampleEdges: boolean; // start from the border instead of a click point
}

/** Flood-fill selection by colour similarity. Returns 1 for selected pixels. */
export function magicWand(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seeds: Array<[number, number]>,
  opts: WandOptions,
): Uint8Array {
  const sel = new Uint8Array(w * h);
  const tol = (opts.tolerance / 100) * 160; // max channel distance
  const tol2 = tol * tol * 3;

  const refs: Array<[number, number, number]> = [];
  for (const [sx, sy] of seeds) {
    const i = (Math.floor(sy) * w + Math.floor(sx)) * 4;
    if (i >= 0 && i < data.length) refs.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  }
  if (!refs.length) return sel;

  const matches = (idx: number): boolean => {
    const r = data[idx]!, g = data[idx + 1]!, b = data[idx + 2]!;
    for (const [rr, rg, rb] of refs) {
      const dr = r - rr, dg = g - rg, db = b - rb;
      if (dr * dr + dg * dg + db * db <= tol2) return true;
    }
    return false;
  };

  if (!opts.contiguous) {
    for (let p = 0; p < w * h; p++) if (matches(p * 4)) sel[p] = 1;
    return sel;
  }

  const stack: number[] = [];
  for (const [sx, sy] of seeds) {
    const p = Math.floor(sy) * w + Math.floor(sx);
    if (p >= 0 && p < w * h) stack.push(p);
  }

  while (stack.length) {
    const p = stack.pop()!;
    if (sel[p]) continue;
    if (!matches(p * 4)) continue;
    sel[p] = 1;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return sel;
}

/** Seed points around the border — the usual "remove the backdrop" starting guess. */
export function edgeSeeds(w: number, h: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([Math.min(w - 1, t * (w - 1)), 0]);
    pts.push([Math.min(w - 1, t * (w - 1)), h - 1]);
    pts.push([0, Math.min(h - 1, t * (h - 1))]);
    pts.push([w - 1, Math.min(h - 1, t * (h - 1))]);
  }
  return pts;
}

/** Punch a selection into (or back out of) the mask. */
export function applySelection(mask: HTMLCanvasElement, sel: Uint8Array, mode: 'cut' | 'keep'): void {
  const g = ctx2d(mask, { willReadFrequently: true });
  const img = g.getImageData(0, 0, mask.width, mask.height);
  const d = img.data;
  for (let p = 0; p < sel.length; p++) {
    if (!sel[p]) continue;
    d[p * 4 + 3] = mode === 'cut' ? 0 : 255;
  }
  g.putImageData(img, 0, 0);
}

export function invertMask(mask: HTMLCanvasElement): void {
  const g = ctx2d(mask, { willReadFrequently: true });
  const img = g.getImageData(0, 0, mask.width, mask.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255 - d[i]!;
  g.putImageData(img, 0, 0);
}

export function featherMask(mask: HTMLCanvasElement, radius: number): void {
  if (radius < 1) return;
  const g = ctx2d(mask, { willReadFrequently: true });
  const img = g.getImageData(0, 0, mask.width, mask.height);
  const blurred = boxBlur(img, Math.round(radius));
  g.putImageData(blurred, 0, 0);
}

export function resetMask(mask: HTMLCanvasElement): void {
  const g = ctx2d(mask);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#ffffff';
  g.clearRect(0, 0, mask.width, mask.height);
  g.fillRect(0, 0, mask.width, mask.height);
}

/** Paint the mask by hand — the reliable way to fix what the wand misses. */
export function paintMask(
  mask: HTMLCanvasElement,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  radius: number,
  mode: 'cut' | 'keep',
): void {
  const g = ctx2d(mask);
  g.save();
  g.globalCompositeOperation = mode === 'cut' ? 'destination-out' : 'source-over';
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = radius * 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (from) {
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(to.x, to.y, radius, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Visualise the mask as a translucent red overlay for the editing view. */
export function maskOverlay(mask: HTMLCanvasElement, target: HTMLCanvasElement): void {
  const g = ctx2d(target);
  g.save();
  g.globalCompositeOperation = 'source-over';
  const tmp = makeCanvas(mask.width, mask.height);
  const tg = ctx2d(tmp);
  tg.fillStyle = 'rgba(255,90,70,0.55)';
  tg.fillRect(0, 0, tmp.width, tmp.height);
  tg.globalCompositeOperation = 'destination-out';
  tg.drawImage(mask, 0, 0);
  g.drawImage(tmp, 0, 0, target.width, target.height);
  g.restore();
}
