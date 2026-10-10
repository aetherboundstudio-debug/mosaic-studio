import { h, button, iconButton, section, slider, segmented, fieldRow, selectInput, colorInput } from '../../core/dom';
import { beginScreen } from '../../shell/shell';
import { toast, promptDialog, confirmDialog } from '../../core/ui';
import { makeCanvas, ctx2d, canvasThumb, canvasPoint, loadImageFromFile, type Pt } from '../../core/image';
import { History } from '../../core/history';
import { projects, newId, type ProjectRecord } from '../../core/storage';
import { bindShortcuts, bindPaste, exportDialog, stageCanvasHost, flatten } from '../shared';
import { aiPanel } from '../../ai/panel';
import {
  LayerStack, BLEND_MODES, BRUSHES, CANVAS_PRESETS, defaultBrush, strokeSegment, floodFill, pickColor,
  type BlendMode, type BrushKind, type BrushSettings, type Layer,
} from './engine';

type Tool = 'brush' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'text';

interface Snapshot {
  layerId: string;
  image: ImageData;
}

const PALETTE = [
  '#1d2420', '#ffffff', '#ff6b5e', '#ff9b79', '#ffce5c', '#d7f77b',
  '#6fcf7f', '#5bb8d4', '#5c7cfa', '#b9a8ff', '#f06292', '#8d6e63',
];

export async function renderDrawTool(params: URLSearchParams): Promise<void> {
  const ctx = beginScreen();
  ctx.setTitle('Paint studio', 'Layers');

  let stack = new LayerStack(1600, 1200);
  stack.add('Background');
  const bg = stack.active!;
  const bgCtx = ctx2d(bg.canvas);
  bgCtx.fillStyle = '#ffffff';
  bgCtx.fillRect(0, 0, bg.canvas.width, bg.canvas.height);
  stack.add('Layer 1');

  let brush: BrushSettings = defaultBrush();
  let tool: Tool = 'brush';
  let fillTolerance = 24;
  let symmetry = false;
  let shapeFilled = false;
  let projectId: string | null = null;
  let title = 'Untitled painting';

  const history = new History<Snapshot>(14);

  const { host, canvas: view } = stageCanvasHost();
  const meta = h('div.stage-meta');
  ctx.stage.appendChild(h('div.stage-wrap', null, host, meta));

  const cursor = h('div', {
    style: {
      position: 'absolute', border: '1px solid rgba(0,0,0,.6)', boxShadow: '0 0 0 1px rgba(255,255,255,.7)',
      borderRadius: '50%', pointerEvents: 'none', display: 'none', transform: 'translate(-50%,-50%)',
    },
  });
  host.appendChild(cursor);

  /* ---------------- Rendering ---------------- */

  let rafId = 0;
  function compose(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      stack.composite(view);
      meta.textContent = `${stack.width} × ${stack.height} px · ${stack.layers.length} layer${stack.layers.length === 1 ? '' : 's'}`;
    });
  }

  /* ---------------- History ---------------- */

  function snapshotActive(): Snapshot | null {
    const layer = stack.active;
    if (!layer) return null;
    return {
      layerId: layer.id,
      image: ctx2d(layer.canvas, { willReadFrequently: true }).getImageData(0, 0, layer.canvas.width, layer.canvas.height),
    };
  }

  function commit(label: string): void {
    const snap = snapshotActive();
    if (!snap) return;
    history.push(label, snap);
    refreshHistory();
  }

  function applySnapshot(s: Snapshot): void {
    const layer = stack.layers.find((l) => l.id === s.layerId);
    if (!layer) return;
    ctx2d(layer.canvas).putImageData(s.image, 0, 0);
    compose();
  }

  const undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', () => {
    const current = snapshotActive();
    if (!current) return;
    const entry = history.undo(current);
    if (!entry) return;
    applySnapshot(entry.state);
    refreshHistory();
  });
  const redoBtn = iconButton('redo', 'Redo (Ctrl+Shift+Z)', () => {
    const current = snapshotActive();
    if (!current) return;
    const entry = history.redo(current);
    if (!entry) return;
    applySnapshot(entry.state);
    refreshHistory();
  });
  function refreshHistory(): void {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  }

  /* ---------------- Drawing interaction ---------------- */

  let drawing = false;
  let last: Pt | null = null;
  let shapeStart: Pt | null = null;
  let shapeBackup: ImageData | null = null;

  function mirrorX(p: Pt): Pt {
    return { x: stack.width - p.x, y: p.y, pressure: p.pressure };
  }

  function layerCtx(): CanvasRenderingContext2D | null {
    const layer = stack.active;
    if (!layer) return null;
    if (layer.locked) { toast('That layer is locked', 'err'); return null; }
    if (!layer.visible) { toast('That layer is hidden', 'err'); return null; }
    return ctx2d(layer.canvas);
  }

  view.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = canvasPoint(view, e);
    view.setPointerCapture(e.pointerId);

    if (tool === 'picker') {
      const flat = stack.composite();
      const hit = pickColor(flat, p.x, p.y);
      if (hit) { brush.color = hit; buildInspector(); toast(`Picked ${hit}`); }
      return;
    }

    const g = layerCtx();
    if (!g) return;

    if (tool === 'fill') {
      commit('fill');
      floodFill(stack.active!.canvas, p.x, p.y, brush.color, fillTolerance);
      compose();
      return;
    }

    if (tool === 'text') {
      void addText(p);
      return;
    }

    commit(tool === 'brush' ? 'stroke' : tool);
    drawing = true;
    last = p;
    shapeStart = p;

    if (tool === 'brush') {
      strokeSegment(g, p, p, brush);
      if (symmetry) strokeSegment(g, mirrorX(p), mirrorX(p), brush);
      compose();
    } else {
      shapeBackup = ctx2d(stack.active!.canvas, { willReadFrequently: true })
        .getImageData(0, 0, stack.width, stack.height);
    }
  });

  view.addEventListener('pointermove', (e) => {
    const p = canvasPoint(view, e);
    updateCursor(e);
    if (!drawing) return;
    const g = layerCtx();
    if (!g) return;

    if (tool === 'brush') {
      const smoothed: Pt = last
        ? {
            x: last.x + (p.x - last.x) * (1 - brush.smoothing * 0.75),
            y: last.y + (p.y - last.y) * (1 - brush.smoothing * 0.75),
            pressure: p.pressure,
          }
        : p;
      strokeSegment(g, last ?? smoothed, smoothed, brush);
      if (symmetry) strokeSegment(g, mirrorX(last ?? smoothed), mirrorX(smoothed), brush);
      last = smoothed;
    } else if (shapeStart && shapeBackup) {
      g.putImageData(shapeBackup, 0, 0);
      drawShape(g, shapeStart, p);
      if (symmetry) drawShape(g, mirrorX(shapeStart), mirrorX(p));
    }
    compose();
  });

  function drawShape(g: CanvasRenderingContext2D, a: Pt, b: Pt): void {
    g.save();
    g.strokeStyle = brush.color;
    g.fillStyle = brush.color;
    g.globalAlpha = brush.opacity;
    g.lineWidth = brush.size;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (tool === 'line') {
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    } else if (tool === 'rect') {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
      if (shapeFilled) g.fillRect(x, y, w, hh); else g.strokeRect(x, y, w, hh);
    } else if (tool === 'ellipse') {
      g.beginPath();
      g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      if (shapeFilled) g.fill(); else g.stroke();
    }
    g.restore();
  }

  const endStroke = () => {
    drawing = false;
    last = null;
    shapeStart = null;
    shapeBackup = null;
    compose();
  };
  view.addEventListener('pointerup', endStroke);
  view.addEventListener('pointercancel', endStroke);
  view.addEventListener('pointerleave', () => { cursor.style.display = 'none'; });

  function updateCursor(e: PointerEvent): void {
    if (tool !== 'brush') { cursor.style.display = 'none'; return; }
    const rect = view.getBoundingClientRect();
    const scale = rect.width / view.width;
    cursor.style.display = 'block';
    cursor.style.left = `${e.clientX - rect.left}px`;
    cursor.style.top = `${e.clientY - rect.top}px`;
    cursor.style.width = `${Math.max(4, brush.size * scale)}px`;
    cursor.style.height = `${Math.max(4, brush.size * scale)}px`;
  }

  async function addText(p: Pt): Promise<void> {
    const value = await promptDialog('Add text', 'What should it say?', '');
    if (!value) return;
    const g = layerCtx();
    if (!g) return;
    commit('text');
    g.save();
    g.fillStyle = brush.color;
    g.globalAlpha = brush.opacity;
    const size = Math.max(18, brush.size * 3.2);
    g.font = `800 ${size}px Inter, system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(value, p.x, p.y);
    g.restore();
    compose();
  }

  /* ---------------- Layers UI ---------------- */

  function layerRow(layer: Layer): HTMLElement {
    const thumb = makeCanvas(68, 56);
    thumb.className = 'layer-thumb';
    const tg = ctx2d(thumb);
    const scale = Math.min(thumb.width / stack.width, thumb.height / stack.height);
    tg.drawImage(layer.canvas, 0, 0, stack.width * scale, stack.height * scale);

    const row = h('div', { class: `layer-item ${layer.id === stack.activeId ? 'active' : ''}`.trim() },
      thumb,
      h('span.layer-name', null, layer.name),
      iconButton(layer.visible ? 'eye' : 'eyeOff', layer.visible ? 'Hide layer' : 'Show layer', () => {
        layer.visible = !layer.visible;
        compose();
        buildInspector();
      }),
    );
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.icon-btn')) return;
      stack.activeId = layer.id;
      buildInspector();
    });
    row.addEventListener('dblclick', async () => {
      const name = await promptDialog('Rename layer', 'Layer name', layer.name);
      if (name) { layer.name = name; buildInspector(); }
    });
    return row;
  }

  /* ---------------- Inspector ---------------- */

  function buildInspector(): void {
    const ins = ctx.inspector;
    ins.replaceChildren();
    const active = stack.active;

    ins.appendChild(section('Brush',
      fieldRow('Type', selectInput(BRUSHES, brush.kind, (v) => {
        brush.kind = v as BrushKind;
        if (v === 'eraser') tool = 'brush';
        buildInspector();
      })),
      slider({ label: 'Size', min: 1, max: 260, value: brush.size, unit: 'px', onInput: (v) => { brush.size = v; } }).root,
      slider({ label: 'Opacity', min: 0.02, max: 1, step: 0.01, value: brush.opacity, onInput: (v) => { brush.opacity = v; } }).root,
      slider({ label: 'Hardness', min: 0, max: 1, step: 0.01, value: brush.hardness, onInput: (v) => { brush.hardness = v; } }).root,
      slider({ label: 'Smoothing', min: 0, max: 0.95, step: 0.01, value: brush.smoothing, onInput: (v) => { brush.smoothing = v; } }).root,
      h('label.row', { style: { fontSize: '11px', color: 'var(--ink-2)' } },
        (() => {
          const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
          cb.checked = brush.pressure;
          cb.addEventListener('change', () => { brush.pressure = cb.checked; });
          return cb;
        })(),
        'Pressure sensitivity (stylus)'),
      h('label.row', { style: { fontSize: '11px', color: 'var(--ink-2)' } },
        (() => {
          const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
          cb.checked = symmetry;
          cb.addEventListener('change', () => { symmetry = cb.checked; });
          return cb;
        })(),
        'Mirror symmetry'),
    ));

    const swatches = h('div.swatch-row');
    for (const c of PALETTE) {
      const s = h('button', { class: `swatch ${c === brush.color ? 'active' : ''}`.trim(), style: { background: c }, type: 'button', 'aria-label': c });
      s.addEventListener('click', () => { brush.color = c; buildInspector(); });
      swatches.appendChild(s);
    }
    ins.appendChild(section('Colour',
      h('div.row', null,
        colorInput(brush.color, (v) => { brush.color = v; buildInspector(); }),
        h('span.mono', null, brush.color.toUpperCase()),
      ),
      swatches,
      tool === 'fill'
        ? slider({ label: 'Tolerance', min: 1, max: 100, value: fillTolerance, onInput: (v) => { fillTolerance = v; } }).root
        : null,
      (tool === 'rect' || tool === 'ellipse')
        ? segmented([{ value: 'stroke', label: 'Outline' }, { value: 'fill', label: 'Filled' }], shapeFilled ? 'fill' : 'stroke',
            (v) => { shapeFilled = v === 'fill'; }).root
        : null,
    ));

    const list = h('div.layer-list');
    for (const layer of [...stack.layers].reverse()) list.appendChild(layerRow(layer));

    ins.appendChild(section('Layers',
      list,
      h('div.grid-2', null,
        button('Add', { icon: 'plus', onClick: () => { stack.add(); buildInspector(); compose(); } }),
        button('Duplicate', { icon: 'copy', onClick: () => { stack.duplicate(stack.activeId); buildInspector(); compose(); } }),
      ),
      h('div.grid-2', null,
        button('Up', { onClick: () => { stack.move(stack.activeId, 1); buildInspector(); compose(); } }),
        button('Down', { onClick: () => { stack.move(stack.activeId, -1); buildInspector(); compose(); } }),
      ),
      h('div.grid-2', null,
        button('Merge down', { icon: 'merge', onClick: () => { stack.mergeDown(stack.activeId); history.clear(); refreshHistory(); buildInspector(); compose(); } }),
        button('Delete', { variant: 'danger', icon: 'trash', onClick: () => { stack.remove(stack.activeId); history.clear(); refreshHistory(); buildInspector(); compose(); } }),
      ),
      active
        ? slider({ label: 'Opacity', min: 0, max: 1, step: 0.01, value: active.opacity, onInput: (v) => { active.opacity = v; compose(); } }).root
        : null,
      active
        ? fieldRow('Blend', selectInput(BLEND_MODES, active.blend, (v) => { active.blend = v as BlendMode; compose(); }))
        : null,
      h('p.hint', null, 'Tap a layer to work on it, double-tap to rename.'),
    ));

    ins.appendChild(section('Canvas',
      fieldRow('Size', selectInput(
        CANVAS_PRESETS.map((p) => ({ value: p.value, label: p.label })),
        CANVAS_PRESETS.find((p) => p.w === stack.width && p.h === stack.height)?.value ?? 'landscape',
        (v) => { void resizeCanvas(v); },
      )),
      h('div.grid-2', null,
        button('Fill layer', { icon: 'bucket', onClick: () => {
          const g = layerCtx();
          if (!g) return;
          commit('fill layer');
          g.save();
          g.globalAlpha = brush.opacity;
          g.fillStyle = brush.color;
          g.fillRect(0, 0, stack.width, stack.height);
          g.restore();
          compose();
        } }),
        button('Clear layer', { variant: 'danger', onClick: () => {
          const g = layerCtx();
          if (!g) return;
          commit('clear layer');
          g.clearRect(0, 0, stack.width, stack.height);
          compose();
        } }),
      ),
      button('Import image as layer', { icon: 'photo', onClick: () => {
        const input = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
        input.addEventListener('change', () => { if (input.files?.[0]) void placeImage(input.files[0]); });
        input.click();
      } }),
    ));

    ins.appendChild(aiPanel({
      size: () => ({ width: stack.width, height: stack.height }),
      onResult: (img) => {
        const layer = stack.add('AI layer');
        const g = ctx2d(layer.canvas);
        const scale = Math.min(stack.width / img.width, stack.height / img.height);
        const w = img.width * scale;
        const hh = img.height * scale;
        g.drawImage(img, (stack.width - w) / 2, (stack.height - hh) / 2, w, hh);
        buildInspector();
        compose();
      },
      reference: async () => new Promise<Blob | null>((res) => stack.composite().toBlob(res, 'image/png')),
    }));
  }

  async function placeImage(file: File): Promise<void> {
    try {
      const img = await loadImageFromFile(file);
      const layer = stack.add(file.name.slice(0, 18));
      const g = ctx2d(layer.canvas);
      const scale = Math.min(stack.width / img.naturalWidth, stack.height / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const hh = img.naturalHeight * scale;
      g.drawImage(img, (stack.width - w) / 2, (stack.height - hh) / 2, w, hh);
      buildInspector();
      compose();
      toast('Added as a new layer', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  async function resizeCanvas(presetValue: string): Promise<void> {
    const preset = CANVAS_PRESETS.find((p) => p.value === presetValue);
    if (!preset) return;
    if (!(await confirmDialog('Resize canvas', `Move your artwork to a ${preset.label} canvas? Existing layers are scaled to fit.`, 'Resize'))) {
      buildInspector();
      return;
    }
    const next = new LayerStack(preset.w, preset.h);
    const scale = Math.min(preset.w / stack.width, preset.h / stack.height);
    const dx = (preset.w - stack.width * scale) / 2;
    const dy = (preset.h - stack.height * scale) / 2;
    for (const layer of stack.layers) {
      const copy = next.add(layer.name);
      copy.visible = layer.visible;
      copy.opacity = layer.opacity;
      copy.blend = layer.blend;
      ctx2d(copy.canvas).drawImage(layer.canvas, dx, dy, stack.width * scale, stack.height * scale);
    }
    next.activeId = next.layers.at(-1)?.id ?? '';
    stack = next;
    history.clear();
    refreshHistory();
    buildInspector();
    compose();
  }

  /* ---------------- Toolstrip ---------------- */

  const toolSeg = segmented<Tool>(
    [
      { value: 'brush', icon: 'brush', title: 'Brush' },
      { value: 'line', icon: 'move', title: 'Line' },
      { value: 'rect', icon: 'shape', title: 'Rectangle' },
      { value: 'ellipse', icon: 'eye', title: 'Ellipse' },
      { value: 'fill', icon: 'bucket', title: 'Flood fill' },
      { value: 'picker', icon: 'dropper', title: 'Pick colour' },
      { value: 'text', icon: 'text', title: 'Text' },
    ],
    'brush',
    (v) => { tool = v; buildInspector(); },
  );

  ctx.toolstrip.replaceChildren(
    toolSeg.root,
    h('div.spacer'),
    undoBtn,
    redoBtn,
    iconButton('eraser', 'Eraser', () => {
      brush.kind = brush.kind === 'eraser' ? 'pen' : 'eraser';
      tool = 'brush';
      toolSeg.set('brush');
      buildInspector();
      toast(brush.kind === 'eraser' ? 'Eraser on' : 'Brush on');
    }),
  );

  /* ---------------- Save / export ---------------- */

  function doExport(): void {
    exportDialog({
      baseName: title,
      width: stack.width,
      height: stack.height,
      render: async (req) => {
        const flatCanvas = stack.composite();
        if (req.scale === 1) return req.format === 'jpeg' ? flatten(flatCanvas) : flatCanvas;
        const out = makeCanvas(stack.width * req.scale, stack.height * req.scale);
        const g = ctx2d(out);
        g.imageSmoothingQuality = 'high';
        g.drawImage(flatCanvas, 0, 0, out.width, out.height);
        return req.format === 'jpeg' ? flatten(out) : out;
      },
    });
  }

  async function doSave(): Promise<void> {
    const name = (await promptDialog('Save project', 'Project name', title)) ?? title;
    title = name;
    const assets: Record<string, Blob> = {};
    const layerData: Array<{ id: string; name: string; visible: boolean; opacity: number; blend: BlendMode }> = [];
    for (const layer of stack.layers) {
      const blob = await new Promise<Blob | null>((res) => layer.canvas.toBlob(res, 'image/png'));
      if (blob) assets[layer.id] = blob;
      layerData.push({ id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, blend: layer.blend });
    }
    const rec: ProjectRecord = {
      id: projectId ?? newId(),
      tool: 'draw',
      title: name,
      created: Date.now(),
      updated: Date.now(),
      thumb: await canvasThumb(stack.composite(undefined, '#ffffff')),
      data: { width: stack.width, height: stack.height, layers: layerData },
      assets,
    };
    projectId = rec.id;
    await projects.put(rec);
    toast('Painting saved', 'ok');
  }

  ctx.setActions(
    button('Save', { icon: 'save', onClick: () => void doSave() }),
    button('Export', { icon: 'download', variant: 'primary', onClick: doExport }),
  );

  bindShortcuts(ctx, {
    undo: () => undoBtn.click(),
    redo: () => redoBtn.click(),
    save: () => void doSave(),
    export: doExport,
    extra: (e) => {
      if (e.key === '[') { brush.size = Math.max(1, brush.size - 4); buildInspector(); return true; }
      if (e.key === ']') { brush.size = Math.min(260, brush.size + 4); buildInspector(); return true; }
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
        brush.kind = brush.kind === 'eraser' ? 'pen' : 'eraser';
        buildInspector();
        return true;
      }
      if (e.key === 'b' && !e.metaKey && !e.ctrlKey) { tool = 'brush'; toolSeg.set('brush'); buildInspector(); return true; }
      return false;
    },
  });
  bindPaste(ctx, (file) => void placeImage(file));
  ctx.onDestroy(() => cancelAnimationFrame(rafId));

  buildInspector();
  refreshHistory();
  compose();

  /* ---------------- Reopen ---------------- */

  const wanted = params.get('project');
  if (wanted) {
    const rec = await projects.get(wanted);
    const data = rec?.data as { width: number; height: number; layers: Array<{ id: string; name: string; visible: boolean; opacity: number; blend: BlendMode }> } | undefined;
    if (rec && data && rec.assets) {
      const next = new LayerStack(data.width, data.height);
      for (const info of data.layers) {
        const layer = next.add(info.name);
        layer.visible = info.visible;
        layer.opacity = info.opacity;
        layer.blend = info.blend;
        const blob = rec.assets[info.id];
        if (blob) {
          const img = await loadImageFromFile(blob);
          ctx2d(layer.canvas).drawImage(img, 0, 0);
        }
      }
      next.activeId = next.layers.at(-1)?.id ?? '';
      stack = next;
      projectId = rec.id;
      title = rec.title;
      history.clear();
      refreshHistory();
      buildInspector();
      compose();
      toast(`Reopened “${rec.title}”`, 'ok');
    }
  }
}
