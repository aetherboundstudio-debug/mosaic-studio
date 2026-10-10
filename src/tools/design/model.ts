/** Object model for the Design board. */

import { makeCanvas, ctx2d } from '../../core/image';

export interface BaseItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees
  opacity: number;
  locked: boolean;
  name: string;
}

export interface TextItem extends BaseItem {
  type: 'text';
  text: string;
  font: string;
  size: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  tracking: number;
  uppercase: boolean;
}

export interface ShapeItem extends BaseItem {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface ImageItem extends BaseItem {
  type: 'image';
  assetId: string;
  fit: 'cover' | 'contain';
  radius: number;
}

export type Item = TextItem | ShapeItem | ImageItem;

export interface DesignDoc {
  width: number;
  height: number;
  background: string;
  items: Item[];
}

export const FONTS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter (sans)' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia (serif)' },
  { value: '"Courier New", ui-monospace, monospace', label: 'Courier (mono)' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet' },
  { value: 'Impact, "Arial Black", sans-serif', label: 'Impact' },
  { value: '"Palatino Linotype", Palatino, serif', label: 'Palatino' },
];

export const PAGE_SIZES = [
  { value: 'a4p', label: 'A4 portrait · 2480×3508', w: 2480, h: 3508 },
  { value: 'a4l', label: 'A4 landscape · 3508×2480', w: 3508, h: 2480 },
  { value: 'a5p', label: 'A5 portrait · 1748×2480', w: 1748, h: 2480 },
  { value: 'post', label: 'Social post · 1080×1080', w: 1080, h: 1080 },
  { value: 'story', label: 'Story · 1080×1920', w: 1080, h: 1920 },
  { value: 'wide', label: 'Wide post · 1200×630', w: 1200, h: 630 },
  { value: 'thumb', label: 'Video thumbnail · 1280×720', w: 1280, h: 720 },
  { value: 'card', label: 'Business card · 1050×600', w: 1050, h: 600 },
  { value: 'poster', label: 'Poster · 2480×3508', w: 2480, h: 3508 },
];

let counter = 0;
export function itemId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeText(partial: Partial<TextItem> = {}): TextItem {
  return {
    id: itemId('t'), type: 'text', name: 'Text',
    x: 120, y: 120, w: 720, h: 200, rotation: 0, opacity: 1, locked: false,
    text: 'Your headline here', font: FONTS[0]!.value, size: 110, weight: 800,
    color: '#1b1f17', align: 'left', lineHeight: 1.1, tracking: -2, uppercase: false,
    ...partial,
  };
}

export function makeShape(partial: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id: itemId('s'), type: 'shape', name: 'Shape',
    x: 160, y: 160, w: 400, h: 400, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill: '#d7f77b', stroke: 'transparent', strokeWidth: 0, radius: 24,
    ...partial,
  };
}

export function makeImage(assetId: string, partial: Partial<ImageItem> = {}): ImageItem {
  return {
    id: itemId('i'), type: 'image', name: 'Image',
    x: 100, y: 100, w: 800, h: 800, rotation: 0, opacity: 1, locked: false,
    assetId, fit: 'cover', radius: 0,
    ...partial,
  };
}

/* ---------------- Rendering ---------------- */

export function wrapLines(
  g: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function drawRoundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}

export function drawItem(
  g: CanvasRenderingContext2D,
  item: Item,
  assets: Map<string, HTMLImageElement>,
): void {
  g.save();
  g.globalAlpha = item.opacity;
  g.translate(item.x + item.w / 2, item.y + item.h / 2);
  g.rotate((item.rotation * Math.PI) / 180);
  g.translate(-item.w / 2, -item.h / 2);

  if (item.type === 'shape') {
    g.fillStyle = item.fill;
    g.strokeStyle = item.stroke;
    g.lineWidth = item.strokeWidth;
    if (item.shape === 'rect') {
      drawRoundRect(g, 0, 0, item.w, item.h, item.radius);
      if (item.fill !== 'transparent') g.fill();
      if (item.strokeWidth > 0) g.stroke();
    } else if (item.shape === 'ellipse') {
      g.beginPath();
      g.ellipse(item.w / 2, item.h / 2, item.w / 2, item.h / 2, 0, 0, Math.PI * 2);
      if (item.fill !== 'transparent') g.fill();
      if (item.strokeWidth > 0) g.stroke();
    } else {
      g.beginPath();
      g.moveTo(0, item.h / 2);
      g.lineTo(item.w, item.h / 2);
      g.lineWidth = Math.max(1, item.strokeWidth || 8);
      g.strokeStyle = item.stroke === 'transparent' ? item.fill : item.stroke;
      g.stroke();
    }
  } else if (item.type === 'image') {
    const img = assets.get(item.assetId);
    if (img) {
      g.save();
      if (item.radius > 0) {
        drawRoundRect(g, 0, 0, item.w, item.h, item.radius);
        g.clip();
      }
      const ar = img.naturalWidth / img.naturalHeight;
      const boxAr = item.w / item.h;
      let dw = item.w;
      let dh = item.h;
      if (item.fit === 'cover' ? ar > boxAr : ar < boxAr) {
        dh = item.h;
        dw = dh * ar;
      } else {
        dw = item.w;
        dh = dw / ar;
      }
      g.drawImage(img, (item.w - dw) / 2, (item.h - dh) / 2, dw, dh);
      g.restore();
    } else {
      g.fillStyle = 'rgba(120,130,140,.25)';
      g.fillRect(0, 0, item.w, item.h);
    }
  } else {
    const text = item.uppercase ? item.text.toUpperCase() : item.text;
    g.fillStyle = item.color;
    g.font = `${item.weight} ${item.size}px ${item.font}`;
    g.textBaseline = 'top';
    g.letterSpacing = `${item.tracking}px`;
    const lines = wrapLines(g, text, item.w);
    const lineHeight = item.size * item.lineHeight;
    let y = 0;
    for (const line of lines) {
      const width = g.measureText(line).width;
      const x = item.align === 'center' ? (item.w - width) / 2 : item.align === 'right' ? item.w - width : 0;
      g.fillText(line, x, y);
      y += lineHeight;
    }
    g.letterSpacing = '0px';
  }
  g.restore();
}

export function renderDesign(
  doc: DesignDoc,
  assets: Map<string, HTMLImageElement>,
  scale = 1,
  target?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = target ?? makeCanvas(doc.width * scale, doc.height * scale);
  canvas.width = Math.round(doc.width * scale);
  canvas.height = Math.round(doc.height * scale);
  const g = ctx2d(canvas);
  g.save();
  g.scale(scale, scale);
  if (doc.background !== 'transparent') {
    g.fillStyle = doc.background;
    g.fillRect(0, 0, doc.width, doc.height);
  } else {
    g.clearRect(0, 0, doc.width, doc.height);
  }
  for (const item of doc.items) drawItem(g, item, assets);
  g.restore();
  return canvas;
}

/** Hit test in document space, topmost first. */
export function hitTest(doc: DesignDoc, x: number, y: number): Item | null {
  for (let i = doc.items.length - 1; i >= 0; i--) {
    const item = doc.items[i]!;
    if (item.locked) continue;
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const a = (-item.rotation * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a) + item.w / 2;
    const ly = dx * Math.sin(a) + dy * Math.cos(a) + item.h / 2;
    if (lx >= 0 && ly >= 0 && lx <= item.w && ly <= item.h) return item;
  }
  return null;
}

/* ---------------- Templates ---------------- */

export interface Template {
  id: string;
  name: string;
  build(): DesignDoc;
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank page',
    build: () => ({ width: 1080, height: 1350, background: '#f5f2e9', items: [] }),
  },
  {
    id: 'quote',
    name: 'Quote card',
    build: () => ({
      width: 1080, height: 1080, background: '#1d2420',
      items: [
        makeShape({ name: 'Accent', x: 80, y: 80, w: 160, h: 12, fill: '#d7f77b', radius: 6 }),
        makeText({ name: 'Quote', x: 80, y: 200, w: 920, h: 500, text: 'Make something worth keeping.', size: 128, color: '#f5f5ef', weight: 800, lineHeight: 1.05, tracking: -4 }),
        makeText({ name: 'Credit', x: 80, y: 880, w: 920, h: 80, text: 'Mosaic Studio', size: 36, color: '#9fae8a', weight: 700, tracking: 4, uppercase: true }),
      ],
    }),
  },
  {
    id: 'event',
    name: 'Event poster',
    build: () => ({
      width: 1240, height: 1754, background: '#f2ecdf',
      items: [
        makeShape({ name: 'Sun', shape: 'ellipse', x: 740, y: 180, w: 380, h: 380, fill: '#ff9b79' }),
        makeText({ name: 'Date', x: 110, y: 170, w: 600, h: 90, text: 'Saturday 14 June', size: 48, weight: 700, color: '#6b7355', tracking: 2, uppercase: true }),
        makeText({ name: 'Title', x: 110, y: 640, w: 1020, h: 500, text: 'Open\nStudio\nDay', size: 210, weight: 800, color: '#1d2420', lineHeight: 0.95, tracking: -8 }),
        makeShape({ name: 'Rule', shape: 'line', x: 110, y: 1270, w: 1020, h: 10, fill: '#1d2420', stroke: '#1d2420', strokeWidth: 6 }),
        makeText({ name: 'Details', x: 110, y: 1330, w: 1020, h: 240, text: '11:00 — 18:00 · 14 Harbour Lane\nFree entry, bring a friend.', size: 52, weight: 600, color: '#4b5349', lineHeight: 1.4, tracking: 0 }),
      ],
    }),
  },
  {
    id: 'promo',
    name: 'Product promo',
    build: () => ({
      width: 1080, height: 1350, background: '#ffffff',
      items: [
        makeShape({ name: 'Panel', x: 0, y: 0, w: 1080, h: 820, fill: '#e8efd7', radius: 0 }),
        makeShape({ name: 'Badge', shape: 'ellipse', x: 760, y: 80, w: 220, h: 220, fill: '#ff6b5e' }),
        makeText({ name: 'Badge text', x: 760, y: 155, w: 220, h: 80, text: '30% off', size: 48, weight: 800, color: '#ffffff', align: 'center', tracking: -1 }),
        makeText({ name: 'Title', x: 90, y: 900, w: 900, h: 200, text: 'Spring colour set', size: 96, weight: 800, color: '#1d2420', tracking: -3 }),
        makeText({ name: 'Body', x: 90, y: 1110, w: 900, h: 160, text: 'Six hand-mixed shades. Shop the full range in store this week.', size: 44, weight: 500, color: '#5c6354', lineHeight: 1.35 }),
      ],
    }),
  },
  {
    id: 'title',
    name: 'Video thumbnail',
    build: () => ({
      width: 1280, height: 720, background: '#14161a',
      items: [
        makeShape({ name: 'Bar', x: 0, y: 560, w: 1280, h: 160, fill: '#d7f77b', radius: 0 }),
        makeText({ name: 'Title', x: 70, y: 150, w: 1140, h: 350, text: 'How I edit\nphotos fast', size: 150, weight: 800, color: '#ffffff', lineHeight: 1, tracking: -6 }),
        makeText({ name: 'Tag', x: 70, y: 600, w: 1140, h: 90, text: 'Mosaic Studio · Episode 4', size: 46, weight: 700, color: '#1d2420', tracking: 1 }),
      ],
    }),
  },
];
