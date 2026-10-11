/** Keyframed title renderer — pure function of time, so preview and export match. */

import { makeCanvas, ctx2d, clamp } from '../../core/image';
import { wrapLines } from '../design/model';

export type AnimKind =
  | 'none' | 'fade' | 'up' | 'down' | 'left' | 'right'
  | 'scale' | 'pop' | 'blur' | 'typewriter' | 'wipe' | 'spin';

export const ANIMATIONS: Array<{ value: AnimKind; label: string }> = [
  { value: 'none', label: 'No animation' },
  { value: 'fade', label: 'Fade' },
  { value: 'up', label: 'Rise up' },
  { value: 'down', label: 'Drop down' },
  { value: 'left', label: 'Slide from left' },
  { value: 'right', label: 'Slide from right' },
  { value: 'scale', label: 'Grow' },
  { value: 'pop', label: 'Pop' },
  { value: 'blur', label: 'Blur in' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'wipe', label: 'Wipe reveal' },
  { value: 'spin', label: 'Spin in' },
];

export type Easing = 'linear' | 'easeOut' | 'easeInOut' | 'back' | 'bounce';

export const EASINGS: Array<{ value: Easing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'back', label: 'Overshoot' },
  { value: 'bounce', label: 'Bounce' },
];

export function ease(kind: Easing, t: number): number {
  const x = clamp(t, 0, 1);
  switch (kind) {
    case 'easeOut': return 1 - (1 - x) ** 3;
    case 'easeInOut': return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case 'back': {
      const c = 1.70158 + 1;
      return 1 + c * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
    }
    case 'bounce': {
      const n = 7.5625, d = 2.75;
      let v = x;
      if (v < 1 / d) return n * v * v;
      if (v < 2 / d) return n * (v -= 1.5 / d) * v + 0.75;
      if (v < 2.5 / d) return n * (v -= 2.25 / d) * v + 0.9375;
      return n * (v -= 2.625 / d) * v + 0.984375;
    }
    default: return x;
  }
}

export interface MotionElement {
  id: string;
  text: string;
  font: string;
  size: number;      // relative to canvas height, 0..1
  weight: number;
  color: string;
  x: number;         // 0..1 centre
  y: number;         // 0..1 centre
  align: 'left' | 'center' | 'right';
  tracking: number;
  lineHeight: number;
  inAnim: AnimKind;
  inStart: number;   // seconds
  inDur: number;
  easing: Easing;
  outAnim: AnimKind;
  outStart: number;
  outDur: number;
}

export interface MotionDoc {
  width: number;
  height: number;
  duration: number;  // seconds
  bgType: 'solid' | 'gradient';
  bgA: string;
  bgB: string;
  bgAngle: number;
  elements: MotionElement[];
}

let counter = 0;
export function makeElement(partial: Partial<MotionElement> = {}): MotionElement {
  counter += 1;
  return {
    id: `m${counter}-${Math.random().toString(36).slice(2, 6)}`,
    text: 'Make a little magic.',
    font: 'Inter, system-ui, sans-serif',
    size: 0.13,
    weight: 800,
    color: '#f5f5ef',
    x: 0.5,
    y: 0.45,
    align: 'center',
    tracking: -2,
    lineHeight: 1.1,
    inAnim: 'up',
    inStart: 0.15,
    inDur: 0.9,
    easing: 'easeOut',
    outAnim: 'fade',
    outStart: 3.4,
    outDur: 0.6,
    ...partial,
  };
}

export function defaultMotionDoc(): MotionDoc {
  return {
    width: 1280,
    height: 720,
    duration: 4,
    bgType: 'gradient',
    bgA: '#26352d',
    bgB: '#131a15',
    bgAngle: 135,
    elements: [
      makeElement(),
      makeElement({
        text: 'Mosaic Studio',
        size: 0.045,
        weight: 700,
        color: '#d7f77b',
        y: 0.62,
        tracking: 6,
        inAnim: 'fade',
        inStart: 0.8,
        inDur: 0.7,
        outStart: 3.4,
      }),
    ],
  };
}

interface Transform {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  blur: number;
  reveal: number; // 0..1 for typewriter / wipe
}

function animTransform(kind: AnimKind, p: number, entering: boolean, h: number): Transform {
  const t: Transform = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, reveal: 1 };
  const k = entering ? 1 - p : p; // k = 1 when fully "away"
  switch (kind) {
    case 'none': break;
    case 'fade': t.alpha = 1 - k; break;
    case 'up': t.alpha = 1 - k; t.dy = k * h * 0.22; break;
    case 'down': t.alpha = 1 - k; t.dy = -k * h * 0.22; break;
    case 'left': t.alpha = 1 - k; t.dx = -k * h * 0.4; break;
    case 'right': t.alpha = 1 - k; t.dx = k * h * 0.4; break;
    case 'scale': t.alpha = 1 - k; t.scale = 1 - k * 0.35; break;
    case 'pop': t.alpha = 1 - k; t.scale = 1 + k * 0.4; break;
    case 'blur': t.alpha = 1 - k; t.blur = k * 18; break;
    case 'spin': t.alpha = 1 - k; t.rotate = k * 28; t.scale = 1 - k * 0.2; break;
    case 'typewriter': t.reveal = 1 - k; break;
    case 'wipe': t.reveal = 1 - k; break;
  }
  return t;
}

export function renderMotionFrame(
  doc: MotionDoc,
  time: number,
  scale = 1,
  target?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = target ?? makeCanvas(doc.width * scale, doc.height * scale);
  canvas.width = Math.round(doc.width * scale);
  canvas.height = Math.round(doc.height * scale);
  const g = ctx2d(canvas);
  const w = canvas.width;
  const h = canvas.height;

  if (doc.bgType === 'gradient') {
    const rad = (doc.bgAngle * Math.PI) / 180;
    const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const grad = g.createLinearGradient(
      w / 2 - (Math.cos(rad) * len) / 2, h / 2 - (Math.sin(rad) * len) / 2,
      w / 2 + (Math.cos(rad) * len) / 2, h / 2 + (Math.sin(rad) * len) / 2,
    );
    grad.addColorStop(0, doc.bgA);
    grad.addColorStop(1, doc.bgB);
    g.fillStyle = grad;
  } else {
    g.fillStyle = doc.bgA;
  }
  g.fillRect(0, 0, w, h);

  for (const el of doc.elements) {
    let tr: Transform = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, reveal: 1 };
    if (time < el.inStart) {
      tr = animTransform(el.inAnim, 0, true, h);
    } else if (time < el.inStart + el.inDur) {
      const p = ease(el.easing, (time - el.inStart) / Math.max(0.001, el.inDur));
      tr = animTransform(el.inAnim, p, true, h);
    } else if (el.outAnim !== 'none' && time >= el.outStart) {
      const p = ease(el.easing, (time - el.outStart) / Math.max(0.001, el.outDur));
      tr = animTransform(el.outAnim, Math.min(1, p), false, h);
    }
    if (tr.alpha <= 0.001) continue;

    const fontSize = el.size * h;
    g.save();
    g.globalAlpha = clamp(tr.alpha, 0, 1);
    if (tr.blur > 0) g.filter = `blur(${tr.blur * scale}px)`;
    g.translate(el.x * w + tr.dx * scale, el.y * h + tr.dy * scale);
    g.rotate((tr.rotate * Math.PI) / 180);
    g.scale(tr.scale, tr.scale);

    g.font = `${el.weight} ${fontSize}px ${el.font}`;
    g.letterSpacing = `${el.tracking * scale}px`;
    g.textBaseline = 'middle';
    g.fillStyle = el.color;

    const maxWidth = w * 0.86;
    let text = el.text;
    if (el.inAnim === 'typewriter' || el.outAnim === 'typewriter') {
      text = text.slice(0, Math.max(0, Math.round(text.length * tr.reveal)));
    }
    const lines = wrapLines(g, text, maxWidth);
    const lineH = fontSize * el.lineHeight;
    const totalH = lines.length * lineH;

    if (el.inAnim === 'wipe' || el.outAnim === 'wipe') {
      g.beginPath();
      g.rect(-maxWidth / 2 - 10, -totalH / 2 - 10, (maxWidth + 20) * tr.reveal, totalH + 20);
      g.clip();
    }

    let y = -totalH / 2 + lineH / 2;
    for (const line of lines) {
      const width = g.measureText(line).width;
      const x = el.align === 'center' ? -width / 2 : el.align === 'right' ? -width : 0;
      g.fillText(line, x, y);
      y += lineH;
    }
    g.letterSpacing = '0px';
    g.filter = 'none';
    g.restore();
  }

  return canvas;
}

export const MOTION_SIZES = [
  { value: 'wide', label: 'Wide 16:9 · 1280×720', w: 1280, h: 720 },
  { value: 'square', label: 'Square 1:1 · 1080', w: 1080, h: 1080 },
  { value: 'story', label: 'Story 9:16 · 1080×1920', w: 1080, h: 1920 },
  { value: 'hd', label: 'Full HD · 1920×1080', w: 1920, h: 1080 },
];

export const MOTION_THEMES = [
  { name: 'Forest', a: '#26352d', b: '#131a15', text: '#f5f5ef', accent: '#d7f77b' },
  { name: 'Dusk', a: '#2b2140', b: '#140f22', text: '#f6f1ff', accent: '#b9a8ff' },
  { name: 'Ember', a: '#43211c', b: '#1a0d0b', text: '#fff3ed', accent: '#ff9b79' },
  { name: 'Paper', a: '#f5f2e9', b: '#ded8c6', text: '#1d2420', accent: '#597737' },
  { name: 'Ocean', a: '#12303d', b: '#07161d', text: '#eaf7ff', accent: '#93c7ee' },
  { name: 'Mono', a: '#1a1a1a', b: '#000000', text: '#ffffff', accent: '#bbbbbb' },
];
