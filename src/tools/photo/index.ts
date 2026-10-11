import { h, button, iconButton, section, slider, segmented, fieldRow, selectInput } from '../../core/dom';
import { beginScreen } from '../../shell/shell';
import { toast, busy, promptDialog, confirmDialog } from '../../core/ui';
import {
  makeCanvas, ctx2d, loadImageFromFile, canvasThumb, computeHistogram, drawHistogram, clamp,
} from '../../core/image';
import { History } from '../../core/history';
import { projects, newId, type ProjectRecord } from '../../core/storage';
import { dropZone, bindShortcuts, bindPaste, exportDialog, stageCanvasHost } from '../shared';
import { aiPanel } from '../../ai/panel';
import {
  defaultDoc, renderPhoto, PRESETS, applyPreset, buildCurveLut,
  type PhotoDoc, type Adjustments,
} from './pipeline';
import {
  createMask, magicWand, edgeSeeds, applySelection, invertMask, featherMask, resetMask, paintMask, maskOverlay, isMaskEmpty,
} from './cutout';

type Mode = 'adjust' | 'crop' | 'cutout';

interface Snapshot {
  doc: PhotoDoc;
  mask: ImageData | null;
}

const PREVIEW_EDGE = 1500;
const FAST_EDGE = 900;
const MASK_EDGE = 1600;

export async function renderPhotoTool(params: URLSearchParams): Promise<void> {
  const ctx = beginScreen();
  ctx.setTitle('Photo lab', 'Develop');

  let source: HTMLImageElement | null = null;
  let sourceBlob: Blob | null = null;
  let sw = 0;
  let sh = 0;
  let maskCanvas: HTMLCanvasElement | null = null;
  let maskSampler: HTMLCanvasElement | null = null; // source pixels at mask resolution
  let doc: PhotoDoc = defaultDoc();
  let mode: Mode = 'adjust';
  let compare = false;
  let projectId: string | null = null;
  let title = 'Photo edit';
  let lastMatrix: DOMMatrix | null = null;

  const history = new History<Snapshot>(30);

  const { host, canvas: preview } = stageCanvasHost();
  const overlay = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  host.appendChild(overlay);
  const meta = h('div.stage-meta');
  const stageWrap = h('div.stage-wrap', null, host, meta);

  const emptyHost = dropZone({
    title: 'Open a photo',
    body: 'JPG, PNG, WebP, HEIC-converted — anything your browser can decode. Drag a file here, paste from the clipboard, or choose one.',
    accept: 'image/*',
    iconName: 'photo',
    onFiles: (files) => void openFile(files[0]!),
  });

  ctx.stage.appendChild(emptyHost);

  /* ---------------- Rendering ---------------- */

  let rafId = 0;
  let pendingFast = false;

  function scheduleRender(fast = false): void {
    pendingFast = pendingFast || fast;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const f = pendingFast;
      pendingFast = false;
      draw(f);
      if (f) scheduleSettle();
    });
  }

  let settleTimer = 0;
  function scheduleSettle(): void {
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => draw(false), 220);
  }

  function activeDoc(): PhotoDoc {
    if (compare) return { adjust: defaultDoc().adjust, geo: doc.geo };
    if (mode === 'crop') return { adjust: doc.adjust, geo: { ...doc.geo, crop: null } };
    return doc;
  }

  function draw(fast: boolean): void {
    if (!source) return;
    const result = renderPhoto(source, sw, sh, activeDoc(), {
      maxEdge: fast ? FAST_EDGE : PREVIEW_EDGE,
      fast,
      mask: mode === 'cutout' ? null : maskCanvas,
    });
    lastMatrix = result.matrix;
    preview.width = result.canvas.width;
    preview.height = result.canvas.height;
    const g = ctx2d(preview);
    g.clearRect(0, 0, preview.width, preview.height);
    g.drawImage(result.canvas, 0, 0);

    if (mode === 'cutout' && maskCanvas) maskOverlay(maskCanvas, preview);

    const out = outputSize();
    meta.textContent = `${out.w} × ${out.h} px${compare ? '  ·  ORIGINAL' : ''}`;

    if (!fast) updateHistogram(result.canvas);
    if (mode === 'crop') cropUI.sync();
  }

  function outputSize(): { w: number; h: number } {
    if (!source) return { w: 0, h: 0 };
    const angle = ((doc.geo.rot90 % 4) * 90 + doc.geo.straighten) * (Math.PI / 180);
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const rw = sw * cos + sh * sin;
    const rh = sw * sin + sh * cos;
    const crop = doc.geo.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    return { w: Math.round(rw * crop.w), h: Math.round(rh * crop.h) };
  }

  /* ---------------- History ---------------- */

  function snapshot(): Snapshot {
    return {
      doc: structuredClone(doc),
      mask: maskCanvas ? ctx2d(maskCanvas, { willReadFrequently: true }).getImageData(0, 0, maskCanvas.width, maskCanvas.height) : null,
    };
  }

  function commit(label: string): void {
    history.push(label, snapshot());
    refreshHistoryButtons();
  }

  function restore(s: Snapshot): void {
    doc = structuredClone(s.doc);
    if (s.mask && maskCanvas) ctx2d(maskCanvas).putImageData(s.mask, 0, 0);
    else if (!s.mask) maskCanvas = maskCanvas ? (resetMask(maskCanvas), maskCanvas) : null;
    buildInspector();
    scheduleRender();
  }

  const undoBtn = iconButton('undo', 'Undo', () => {
    const entry = history.undo(snapshot());
    if (!entry) return;
    restore(entry.state);
    toast(`Undid ${entry.label}`);
    refreshHistoryButtons();
  });
  const redoBtn = iconButton('redo', 'Redo', () => {
    const entry = history.redo(snapshot());
    if (!entry) return;
    restore(entry.state);
    refreshHistoryButtons();
  });

  function refreshHistoryButtons(): void {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  }

  /* ---------------- Crop overlay ---------------- */

  const cropUI = makeCropUI(overlay, () => doc.geo.crop, (rect) => {
    doc.geo.crop = rect;
    const out = outputSize();
    meta.textContent = `${out.w} × ${out.h} px`;
  });

  /* ---------------- Cutout interaction ---------------- */

  let cutoutBrush = 42;
  let cutoutMode: 'cut' | 'keep' = 'cut';
  let wandTolerance = 22;
  let wandContiguous = true;
  let painting = false;
  let lastPaint: { x: number; y: number } | null = null;

  function toMaskSpace(e: PointerEvent): { x: number; y: number } | null {
    if (!lastMatrix || !maskCanvas) return null;
    const rect = preview.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * preview.width;
    const cy = ((e.clientY - rect.top) / rect.height) * preview.height;
    const inv = lastMatrix.inverse();
    const p = inv.transformPoint(new DOMPoint(cx, cy));
    return { x: (p.x / sw) * maskCanvas.width, y: (p.y / sh) * maskCanvas.height };
  }

  preview.addEventListener('pointerdown', (e) => {
    if (mode !== 'cutout' || !maskCanvas) return;
    e.preventDefault();
    preview.setPointerCapture(e.pointerId);
    commit('cutout');
    const p = toMaskSpace(e);
    if (!p) return;
    if (cutoutTool === 'wand') {
      runWand(p.x, p.y);
      return;
    }
    painting = true;
    lastPaint = p;
    paintMask(maskCanvas, null, p, cutoutBrush, cutoutMode);
    scheduleRender(true);
  });
  preview.addEventListener('pointermove', (e) => {
    if (!painting || !maskCanvas) return;
    const p = toMaskSpace(e);
    if (!p) return;
    paintMask(maskCanvas, lastPaint, p, cutoutBrush, cutoutMode);
    lastPaint = p;
    scheduleRender(true);
  });
  const endPaint = () => { painting = false; lastPaint = null; scheduleRender(); };
  preview.addEventListener('pointerup', endPaint);
  preview.addEventListener('pointercancel', endPaint);

  let cutoutTool: 'wand' | 'brush' = 'wand';

  function runWand(mx: number, my: number): void {
    if (!maskSampler || !maskCanvas) return;
    const g = ctx2d(maskSampler, { willReadFrequently: true });
    const data = g.getImageData(0, 0, maskSampler.width, maskSampler.height).data;
    const sel = magicWand(data, maskSampler.width, maskSampler.height, [[mx, my]], {
      tolerance: wandTolerance,
      contiguous: wandContiguous,
      sampleEdges: false,
    });
    applySelection(maskCanvas, sel, cutoutMode);
    scheduleRender();
  }

  function removeBackdrop(): void {
    if (!maskSampler || !maskCanvas) return;
    commit('remove background');
    const g = ctx2d(maskSampler, { willReadFrequently: true });
    const data = g.getImageData(0, 0, maskSampler.width, maskSampler.height).data;
    const sel = magicWand(data, maskSampler.width, maskSampler.height, edgeSeeds(maskSampler.width, maskSampler.height), {
      tolerance: wandTolerance,
      contiguous: true,
      sampleEdges: true,
    });
    applySelection(maskCanvas, sel, 'cut');
    featherMask(maskCanvas, 1);
    scheduleRender();
    toast('Backdrop removed — brush to refine', 'ok');
  }

  /* ---------------- Inspector ---------------- */

  const histCanvas = makeCanvas(300, 60);
  histCanvas.className = 'histogram';

  function updateHistogram(canvas: HTMLCanvasElement): void {
    const g = ctx2d(canvas, { willReadFrequently: true });
    const scale = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
    const small = makeCanvas(canvas.width * scale, canvas.height * scale);
    ctx2d(small).drawImage(canvas, 0, 0, small.width, small.height);
    void g;
    const data = ctx2d(small, { willReadFrequently: true }).getImageData(0, 0, small.width, small.height).data;
    drawHistogram(histCanvas, computeHistogram(data));
  }

  function adjustSlider(key: keyof Adjustments, label: string, min = -100, max = 100): HTMLElement {
    const s = slider({
      label,
      min, max,
      value: doc.adjust[key] as number,
      onInput: (v) => { (doc.adjust[key] as number) = v; scheduleRender(true); },
      onCommit: () => scheduleRender(false),
    });
    s.input.addEventListener('pointerdown', () => commit(label.toLowerCase()));
    return s.root;
  }

  function buildInspector(): void {
    const ins = ctx.inspector;
    ins.replaceChildren();
    if (!source) {
      ins.appendChild(section('Photo lab',
        h('p.hint', null, 'Open a photo to unlock 16 develop controls, a tone curve, crop & straighten, and mask-based cutouts.')));
      return;
    }

    if (mode === 'crop') {
      ins.appendChild(section('Crop & straighten',
        fieldRow('Ratio', selectInput(
          [
            { value: 'free', label: 'Freeform' },
            { value: '1', label: 'Square 1:1' },
            { value: '0.8', label: 'Portrait 4:5' },
            { value: '0.5625', label: 'Story 9:16' },
            { value: '1.3333', label: 'Classic 4:3' },
            { value: '1.7778', label: 'Wide 16:9' },
            { value: '1.5', label: 'Photo 3:2' },
          ],
          cropUI.ratioKey,
          (v) => { cropUI.setRatio(v); },
        )),
        slider({
          label: 'Straighten', min: -15, max: 15, step: 0.1, value: doc.geo.straighten, unit: '°',
          onInput: (v) => { doc.geo.straighten = v; scheduleRender(true); },
          onCommit: () => scheduleRender(false),
        }).root,
        h('div.grid-2', null,
          button('Rotate 90°', { icon: 'rotate', onClick: () => { commit('rotate'); doc.geo.rot90 = (doc.geo.rot90 + 1) % 4; scheduleRender(); } }),
          button('Reset crop', { onClick: () => { commit('reset crop'); doc.geo.crop = null; cropUI.reset(); scheduleRender(); } }),
        ),
        h('div.grid-2', null,
          button('Flip across', { onClick: () => { commit('flip'); doc.geo.flipH = !doc.geo.flipH; scheduleRender(); } }),
          button('Flip down', { onClick: () => { commit('flip'); doc.geo.flipV = !doc.geo.flipV; scheduleRender(); } }),
        ),
        h('p.hint', null, 'Drag inside the frame to move it, pull a corner to resize. The crop is stored as instructions, so you can reopen and change it later.'),
        button('Apply crop', { variant: 'primary', icon: 'check', onClick: () => { setMode('adjust'); } }),
      ));
      return;
    }

    if (mode === 'cutout') {
      ins.appendChild(section('Cutout',
        h('p.hint', null, 'Builds a mask instead of deleting pixels — tap with the wand, then refine by brushing.'),
        segmented([{ value: 'wand', label: 'Wand', icon: 'wand' }, { value: 'brush', label: 'Brush', icon: 'brush' }], cutoutTool,
          (v) => { cutoutTool = v as 'wand' | 'brush'; buildInspector(); }).root,
        segmented([{ value: 'cut', label: 'Erase' }, { value: 'keep', label: 'Restore' }], cutoutMode,
          (v) => { cutoutMode = v as 'cut' | 'keep'; }).root,
        cutoutTool === 'wand'
          ? slider({ label: 'Tolerance', min: 1, max: 100, value: wandTolerance, onInput: (v) => { wandTolerance = v; } }).root
          : slider({ label: 'Brush size', min: 4, max: 300, value: cutoutBrush, onInput: (v) => { cutoutBrush = v; } }).root,
        cutoutTool === 'wand'
          ? h('label.row', { style: { fontSize: '11px', color: 'var(--ink-2)' } },
              (() => {
                const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
                cb.checked = wandContiguous;
                cb.addEventListener('change', () => { wandContiguous = cb.checked; });
                return cb;
              })(),
              'Connected areas only')
          : null,
        button('Remove backdrop', { icon: 'scissors', variant: 'primary', onClick: removeBackdrop }),
        h('div.grid-2', null,
          button('Invert', { onClick: () => { if (!maskCanvas) return; commit('invert mask'); invertMask(maskCanvas); scheduleRender(); } }),
          button('Soften edge', { onClick: () => { if (!maskCanvas) return; commit('soften mask'); featherMask(maskCanvas, 2); scheduleRender(); } }),
        ),
        button('Clear cutout', { variant: 'danger', icon: 'trash', onClick: () => { if (!maskCanvas) return; commit('clear mask'); resetMask(maskCanvas); scheduleRender(); } }),
        button('Done', { variant: 'primary', icon: 'check', onClick: () => setMode('adjust') }),
      ));
      return;
    }

    // Adjust mode
    ins.appendChild(section('Histogram', histCanvas, h('p.hint', null, 'Red, green and blue tonal spread of the current render.')));

    const presetGrid = h('div.preset-grid');
    for (const preset of PRESETS) {
      const card = h('button.preset-card', { type: 'button', title: preset.name });
      const thumb = makeCanvas(76, 76);
      card.appendChild(thumb);
      card.appendChild(h('span', null, preset.name));
      card.addEventListener('click', () => {
        commit(`preset ${preset.name}`);
        doc.adjust = applyPreset(doc.adjust, preset);
        buildInspector();
        scheduleRender();
        toast(`${preset.name} applied`);
      });
      presetGrid.appendChild(card);
      queueMicrotask(() => paintPresetThumb(thumb, preset.id));
    }
    ins.appendChild(section('Looks', presetGrid));

    ins.appendChild(section('Light',
      adjustSlider('exposure', 'Exposure'),
      adjustSlider('contrast', 'Contrast'),
      adjustSlider('highlights', 'Highlights'),
      adjustSlider('shadows', 'Shadows'),
      adjustSlider('whites', 'Whites'),
      adjustSlider('blacks', 'Blacks'),
    ));

    ins.appendChild(section('Colour',
      adjustSlider('temperature', 'Warmth'),
      adjustSlider('tint', 'Tint'),
      adjustSlider('vibrance', 'Vibrance'),
      adjustSlider('saturation', 'Saturation'),
      button('Black & white', { onClick: () => { commit('black & white'); doc.adjust.saturation = -100; buildInspector(); scheduleRender(); } }),
    ));

    ins.appendChild(section('Curve', curveEditor(doc.adjust, () => { commit('curve'); }, () => scheduleRender())));

    ins.appendChild(section('Detail',
      adjustSlider('clarity', 'Clarity'),
      adjustSlider('sharpen', 'Sharpen', 0, 100),
      adjustSlider('blur', 'Blur', 0, 100),
    ));

    ins.appendChild(section('Effects',
      adjustSlider('vignette', 'Vignette'),
      adjustSlider('grain', 'Grain', 0, 100),
      adjustSlider('fade', 'Fade', 0, 100),
    ));

    ins.appendChild(aiPanel({
      title: 'AI assist',
      size: () => { const o = outputSize(); return { width: o.w, height: o.h }; },
      onResult: (img) => { void adoptImage(img, 'AI image'); },
      reference: async () => {
        const result = renderPhoto(source!, sw, sh, doc, { maxEdge: 1024, mask: maskCanvas });
        return new Promise<Blob | null>((resolve) => result.canvas.toBlob((b) => resolve(b), 'image/png'));
      },
    }));

    ins.appendChild(section('Reset',
      button('Reset all adjustments', { variant: 'danger', icon: 'undo', onClick: async () => {
        if (await confirmDialog('Reset adjustments', 'Put every slider and the curve back to zero? Your crop and cutout stay.', 'Reset')) {
          commit('reset');
          doc.adjust = defaultDoc().adjust;
          buildInspector();
          scheduleRender();
        }
      } }),
    ));
  }

  function paintPresetThumb(canvas: HTMLCanvasElement, presetId: string): void {
    if (!source) return;
    const preset = PRESETS.find((p) => p.id === presetId)!;
    const tiny = renderPhoto(source, sw, sh, { adjust: applyPreset(doc.adjust, preset), geo: doc.geo }, { maxEdge: 110, fast: true, mask: maskCanvas });
    const g = ctx2d(canvas);
    const scale = Math.max(canvas.width / tiny.canvas.width, canvas.height / tiny.canvas.height);
    const dw = tiny.canvas.width * scale;
    const dh = tiny.canvas.height * scale;
    g.drawImage(tiny.canvas, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }

  /* ---------------- Toolstrip ---------------- */

  function setMode(next: Mode): void {
    mode = next;
    modeSeg.set(next);
    overlay.style.pointerEvents = next === 'crop' ? 'auto' : 'none';
    cropUI.setActive(next === 'crop');
    preview.style.cursor = next === 'cutout' ? 'crosshair' : 'default';
    if (next === 'cutout' && !maskCanvas) buildMask();
    buildInspector();
    scheduleRender();
  }

  const modeSeg = segmented<Mode>(
    [
      { value: 'adjust', label: 'Develop', icon: 'adjust' },
      { value: 'crop', label: 'Crop', icon: 'crop' },
      { value: 'cutout', label: 'Cutout', icon: 'scissors' },
    ],
    'adjust',
    (v) => setMode(v),
  );

  const compareBtn = iconButton('eye', 'Hold to compare with the original', () => { /* pointer handlers below */ });
  const holdOn = () => { compare = true; draw(false); };
  const holdOff = () => { compare = false; draw(false); };
  compareBtn.addEventListener('pointerdown', holdOn);
  compareBtn.addEventListener('pointerup', holdOff);
  compareBtn.addEventListener('pointerleave', holdOff);
  compareBtn.addEventListener('pointercancel', holdOff);

  function buildToolstrip(): void {
    ctx.toolstrip.replaceChildren(
      modeSeg.root,
      h('div.spacer'),
      undoBtn, redoBtn, compareBtn,
      iconButton('plus', 'Open a different photo', () => {
        const input = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
        input.addEventListener('change', () => { if (input.files?.[0]) void openFile(input.files[0]); });
        input.click();
      }),
    );
  }

  /* ---------------- File handling ---------------- */

  function buildMask(): HTMLCanvasElement | null {
    if (!source) return null;
    const scale = Math.min(1, MASK_EDGE / Math.max(sw, sh));
    const created = createMask(sw * scale, sh * scale);
    maskCanvas = created;
    maskSampler = makeCanvas(created.width, created.height);
    ctx2d(maskSampler).drawImage(source, 0, 0, maskSampler.width, maskSampler.height);
    return created;
  }

  async function adoptImage(img: HTMLImageElement, name: string): Promise<void> {
    source = img;
    sw = img.naturalWidth || img.width;
    sh = img.naturalHeight || img.height;
    maskCanvas = null;
    maskSampler = null;
    title = name;
    history.clear();
    refreshHistoryButtons();
    if (!ctx.stage.contains(stageWrap)) {
      ctx.stage.replaceChildren(stageWrap);
    }
    buildToolstrip();
    buildInspector();
    scheduleRender();
  }

  async function openFile(file: File): Promise<void> {
    try {
      const img = await loadImageFromFile(file);
      sourceBlob = file;
      doc = defaultDoc();
      await adoptImage(img, file.name.replace(/\.[^.]+$/, '') || 'Photo edit');
      toast('Photo ready', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  /* ---------------- Save / export ---------------- */

  async function fullRender(scale = 1): Promise<HTMLCanvasElement> {
    const out = outputSize();
    const maxEdge = Math.max(out.w, out.h) * scale;
    return renderPhoto(source!, sw, sh, doc, { maxEdge: Math.min(maxEdge, 8000), mask: maskCanvas }).canvas;
  }

  async function doExport(): Promise<void> {
    if (!source) { toast('Open a photo first', 'err'); return; }
    const out = outputSize();
    exportDialog({
      baseName: title,
      width: out.w,
      height: out.h,
      render: async (req) => {
        const b = busy('Rendering at full quality…');
        try {
          return await fullRender(req.scale);
        } finally {
          b.done();
        }
      },
    });
  }

  async function doSave(): Promise<void> {
    if (!source || !sourceBlob) { toast('Open a photo first', 'err'); return; }
    const name = (await promptDialog('Save project', 'Project name', title)) ?? title;
    title = name;
    const thumbCanvas = renderPhoto(source, sw, sh, doc, { maxEdge: 400, mask: maskCanvas }).canvas;
    const assets: Record<string, Blob> = { source: sourceBlob };
    if (maskCanvas && !isMaskEmpty(maskCanvas)) {
      const maskBlob = await new Promise<Blob | null>((res) => maskCanvas!.toBlob(res, 'image/png'));
      if (maskBlob) assets.mask = maskBlob;
    }
    const rec: ProjectRecord = {
      id: projectId ?? newId(),
      tool: 'photo',
      title: name,
      created: Date.now(),
      updated: Date.now(),
      thumb: await canvasThumb(thumbCanvas),
      data: doc,
      assets,
    };
    projectId = rec.id;
    await projects.put(rec);
    toast('Project saved', 'ok');
  }

  ctx.setActions(
    button('Save', { icon: 'save', onClick: () => void doSave() }),
    button('Export', { icon: 'download', variant: 'primary', onClick: () => void doExport() }),
  );

  bindShortcuts(ctx, {
    undo: () => undoBtn.click(),
    redo: () => redoBtn.click(),
    save: () => void doSave(),
    export: () => void doExport(),
  });
  bindPaste(ctx, (file) => void openFile(file));

  ctx.onDestroy(() => {
    cancelAnimationFrame(rafId);
    clearTimeout(settleTimer);
  });

  buildInspector();
  refreshHistoryButtons();

  /* ---------------- Restore a saved project ---------------- */

  const wanted = params.get('project');
  if (wanted) {
    const rec = await projects.get(wanted);
    const blob = rec?.assets?.source;
    if (rec && blob) {
      try {
        const img = await loadImageFromFile(blob);
        sourceBlob = blob;
        doc = { ...defaultDoc(), ...(rec.data as PhotoDoc) };
        projectId = rec.id;
        await adoptImage(img, rec.title);
        if (rec.assets?.mask) {
          const mc = buildMask();
          const maskImg = await loadImageFromFile(rec.assets.mask);
          if (mc) {
            const g = ctx2d(mc);
            g.clearRect(0, 0, mc.width, mc.height);
            g.drawImage(maskImg, 0, 0, mc.width, mc.height);
          }
        }
        scheduleRender();
        toast(`Reopened “${rec.title}”`, 'ok');
      } catch {
        toast('That project could not be reopened', 'err');
      }
    }
  }
}

/* ================= Crop overlay ================= */

interface CropUI {
  sync(): void;
  setActive(active: boolean): void;
  setRatio(key: string): void;
  reset(): void;
  ratioKey: string;
}

function makeCropUI(
  overlay: HTMLElement,
  get: () => { x: number; y: number; w: number; h: number } | null,
  set: (rect: { x: number; y: number; w: number; h: number }) => void,
): CropUI {
  let rect = get() ?? { x: 0.06, y: 0.06, w: 0.88, h: 0.88 };
  let ratio = 0; // 0 = free
  let ratioKey = 'free';
  let active = false;

  const shade = h('div', {
    style: {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
      boxShadow: '0 0 0 9999px rgba(0,0,0,.55)',
      border: '1px solid rgba(255,255,255,.9)',
      cursor: 'move', touchAction: 'none',
    },
  });
  // Rule-of-thirds guides
  for (const [k, v] of [['left', '33.33%'], ['left', '66.66%'], ['top', '33.33%'], ['top', '66.66%']] as const) {
    shade.appendChild(h('i', {
      style: {
        position: 'absolute',
        background: 'rgba(255,255,255,.3)',
        ...(k === 'left' ? { left: v, top: '0', bottom: '0', width: '1px' } : { top: v, left: '0', right: '0', height: '1px' }),
      },
    }));
  }

  const handles: Array<[string, string, string]> = [
    ['nw', '0%', '0%'], ['ne', '100%', '0%'], ['sw', '0%', '100%'], ['se', '100%', '100%'],
  ];
  const handleEls = handles.map(([id, left, top]) => {
    const el = h('span.sel-handle', { style: { left, top }, dataset: { handle: id } });
    shade.appendChild(el);
    return el;
  });
  void handleEls;

  overlay.appendChild(shade);
  shade.style.display = 'none';

  function sync(): void {
    shade.style.left = `${rect.x * 100}%`;
    shade.style.top = `${rect.y * 100}%`;
    shade.style.width = `${rect.w * 100}%`;
    shade.style.height = `${rect.h * 100}%`;
  }

  let drag: { mode: string; startX: number; startY: number; orig: typeof rect } | null = null;

  shade.addEventListener('pointerdown', (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const mode = target.dataset.handle ?? 'move';
    drag = { mode, startX: e.clientX, startY: e.clientY, orig: { ...rect } };
    shade.setPointerCapture(e.pointerId);
  });

  shade.addEventListener('pointermove', (e) => {
    if (!drag || !active) return;
    const bounds = overlay.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / bounds.width;
    const dy = (e.clientY - drag.startY) / bounds.height;
    const o = drag.orig;
    let next = { ...o };

    if (drag.mode === 'move') {
      next.x = clamp(o.x + dx, 0, 1 - o.w);
      next.y = clamp(o.y + dy, 0, 1 - o.h);
    } else {
      const west = drag.mode.includes('w');
      const north = drag.mode.includes('n');
      let x1 = west ? o.x + dx : o.x;
      let y1 = north ? o.y + dy : o.y;
      let x2 = west ? o.x + o.w : o.x + o.w + dx;
      let y2 = north ? o.y + o.h : o.y + o.h + dy;
      x1 = clamp(x1, 0, 1); y1 = clamp(y1, 0, 1);
      x2 = clamp(x2, 0, 1); y2 = clamp(y2, 0, 1);
      next = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      if (ratio > 0) {
        const aspect = bounds.width / bounds.height;
        const targetH = (next.w * aspect) / ratio;
        next.h = clamp(targetH, 0.04, 1);
        if (north) next.y = clamp(o.y + o.h - next.h, 0, 1 - next.h);
        if (next.y + next.h > 1) next.h = 1 - next.y;
      }
    }
    next.w = Math.max(0.04, next.w);
    next.h = Math.max(0.04, next.h);
    rect = next;
    sync();
    set(rect);
  });

  const stop = () => { drag = null; };
  shade.addEventListener('pointerup', stop);
  shade.addEventListener('pointercancel', stop);

  return {
    sync,
    setActive(a: boolean) {
      active = a;
      shade.style.display = a ? 'block' : 'none';
      if (a) { rect = get() ?? rect; sync(); set(rect); }
    },
    setRatio(key: string) {
      ratioKey = key;
      ratio = key === 'free' ? 0 : Number(key);
      if (ratio > 0) {
        const bounds = overlay.getBoundingClientRect();
        const aspect = bounds.width / bounds.height;
        rect.h = clamp((rect.w * aspect) / ratio, 0.05, 1);
        if (rect.y + rect.h > 1) rect.y = Math.max(0, 1 - rect.h);
        sync();
        set(rect);
      }
    },
    reset() {
      rect = { x: 0, y: 0, w: 1, h: 1 };
      sync();
    },
    get ratioKey() { return ratioKey; },
  } as CropUI;
}

/* ================= Curve editor ================= */

function curveEditor(adjust: Adjustments, onStart: () => void, onChange: () => void): HTMLElement {
  const size = 200;
  const canvas = makeCanvas(size, size);
  canvas.style.width = '100%';
  canvas.style.aspectRatio = '1';
  canvas.style.background = 'var(--surface-2)';
  canvas.style.borderRadius = '8px';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'crosshair';

  let dragIndex = -1;

  function paint(): void {
    const g = ctx2d(canvas);
    g.clearRect(0, 0, size, size);
    g.strokeStyle = 'rgba(128,140,150,.25)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * size;
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    }
    const lut = buildCurveLut(adjust.curve);
    g.strokeStyle = '#d7f77b';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x++) {
      const px = (x / 255) * size;
      const py = size - (lut[x]! / 255) * size;
      if (x === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    g.fillStyle = '#ffffff';
    for (const [x, y] of adjust.curve) {
      g.beginPath();
      g.arc((x / 255) * size, size - (y / 255) * size, 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  function toCurve(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    const x = clamp(((e.clientX - r.left) / r.width) * 255, 0, 255);
    const y = clamp(255 - ((e.clientY - r.top) / r.height) * 255, 0, 255);
    return [x, y];
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    onStart();
    const [x, y] = toCurve(e);
    const near = adjust.curve.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 18);
    if (near >= 0) {
      if (e.shiftKey && adjust.curve.length > 2 && near !== 0 && near !== adjust.curve.length - 1) {
        adjust.curve.splice(near, 1);
        paint();
        onChange();
        return;
      }
      dragIndex = near;
    } else {
      adjust.curve.push([x, y]);
      adjust.curve.sort((a, b) => a[0] - b[0]);
      dragIndex = adjust.curve.findIndex((p) => p[0] === x && p[1] === y);
    }
    paint();
    onChange();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragIndex < 0) return;
    const [x, y] = toCurve(e);
    const point = adjust.curve[dragIndex]!;
    const isEnd = dragIndex === 0 || dragIndex === adjust.curve.length - 1;
    point[0] = isEnd ? point[0] : clamp(x, 1, 254);
    point[1] = y;
    adjust.curve.sort((a, b) => a[0] - b[0]);
    dragIndex = adjust.curve.indexOf(point);
    paint();
    onChange();
  });

  const stop = () => { dragIndex = -1; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  paint();

  return h('div', { style: { display: 'grid', gap: '8px' } },
    canvas,
    h('p.hint', null, 'Tap to add a point, drag to shape the tones. Shift-tap a point to delete it.'),
    button('Flatten curve', { onClick: () => { onStart(); adjust.curve = [[0, 0], [255, 255]]; paint(); onChange(); } }),
  );
}
