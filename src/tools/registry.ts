import type { ToolId } from '../core/storage';

export interface ToolMeta {
  id: ToolId;
  name: string;
  desc: string;
  icon: string;
  color: string;
  path: string;
  /** Capability badges shown on the tool card. */
  features: string[];
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'photo',
    name: 'Photo lab',
    desc: 'Non-destructive develop with curves, masks and cutouts.',
    icon: 'photo',
    color: 'pink',
    path: '/photo',
    features: ['24 adjustments', 'Tone curve', 'Crop & straighten', 'Cutout'],
  },
  {
    id: 'draw',
    name: 'Paint studio',
    desc: 'Layered painting with a pressure-aware brush engine.',
    icon: 'brush',
    color: 'yellow',
    path: '/draw',
    features: ['Layers', 'Blend modes', 'Pressure', 'Symmetry'],
  },
  {
    id: 'design',
    name: 'Design board',
    desc: 'Objects, templates and print-ready page sizes.',
    icon: 'design',
    color: 'purple',
    path: '/design',
    features: ['Templates', 'Text & shapes', 'Export PDF', 'Snapping'],
  },
  {
    id: 'motion',
    name: 'Motion titles',
    desc: 'Keyframed animated titles exported as real video.',
    icon: 'motion',
    color: 'blue',
    path: '/motion',
    features: ['Keyframes', 'WebM export', 'GIF export', 'Easing'],
  },
  {
    id: 'video',
    name: 'Video cutter',
    desc: 'Trim, speed, filter and render a new clip in-browser.',
    icon: 'video',
    color: 'green',
    path: '/video',
    features: ['Real export', 'Filmstrip', 'Frame grab', 'GIF'],
  },
  {
    id: 'pdf',
    name: 'PDF workshop',
    desc: 'Merge, reorder, rotate, split and build PDFs.',
    icon: 'pdf',
    color: 'orange',
    path: '/pdf',
    features: ['Merge', 'Reorder', 'Rotate', 'Images → PDF'],
  },
];

export function toolMeta(id: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.id === id);
}
