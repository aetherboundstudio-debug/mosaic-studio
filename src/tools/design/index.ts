import { h, button, iconButton, section, slider, segmented, fieldRow, selectInput, colorInput } from '../../core/dom';
import { beginScreen } from '../../shell/shell';
import { toast, promptDialog, busy } from '../../core/ui';
import { makeCanvas, ctx2d, canvasThumb, loadImageFromFile, download, safeName } from '../../core/image';
import { History } from '../../core/history';
import { projects, newId, type ProjectRecord } from '../../core/storage';
import { bindShortcuts, bindPaste, exportDialog, flatten } from '../shared';
import { aiPanel } from '../../ai/panel';
import {
  TEMPLATES, PAGE_SIZES, FONTS, renderDesign, hitTest, makeText, makeShape, makeImage, itemId,
  type DesignDoc, type Item, type TextItem, type ShapeItem, type ImageItem,
} from './model';

export async function renderDesignTool(params: URLSearchParams): Promise<void> {
  const ctx = beginScreen();
  ctx.setTitle('Design board', 'Layout');

  let doc: DesignDoc = TEMPLATES[1]!.build();
  const assets = new Map<string, HTMLImageElement>();
  const assetBlobs = new Map<string, Blob>();
  let selectedId: string | null = null;
  let projectId: string | null = null;
  let title = 'Untitled design';
  let showGuides = true;

  const history = new History<DesignDoc>(40);

  const canvas = makeCanvas(doc.width, doc.height);
  const stageEl = h('div.design-stage', null, canvas);
  const overlay = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  stageEl.appendChild(overlay);
  const meta = h('div.stage-meta');
  ctx.stage.appendChild(h('div.stage-wrap', null, stageEl, meta));

  function fitStage(): void {
    const area = ctx.stage.getBoundingClientRect();
    const maxW = Math.max(160, area.width - 36);
    const maxH = Math.max(160, area.height - 86);
    const scale = Math.min(maxW / doc.width, maxH / doc.height, 1);
    stageEl.style.width = `${doc.width * scale}px`;
    stageEl.style.height = `${doc.height * scale}px`;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }

  let rafId = 0;
  function paint(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderDesign(doc, assets, 1, canvas);
      fitStage();
      drawSelection();
      meta.textContent = `${doc.width} × ${doc.height} px · ${doc.items.length} object${doc.items.length === 1 ? '' : 's'}`;
    });
  }

  const resizeObs = new ResizeObserver(() => { fitStage(); drawSelection(); });
  resizeObs.observe(ctx.stage);
  ctx.onDestroy(() => resizeObs.disconnect());

  /* ---------------- Selection overlay ---------------- */

  function selected(): Item | null {
    return doc.items.find((i) => i.id === selectedId) ?? null;
  }

  function stageScale(): number {
    return stageEl.getBoundingClientRect().width / doc.width;
  }

  function drawSelection(): void {
    overlay.replaceChildren();
    const item = selected();
    if (!item) return;
    const s = stageScale();
    const box = h('div.sel-box', {
      style: {
        left: `${item.x * s}px`, top: `${item.y * s}px`,
        width: `${item.w * s}px`, height: `${item.h * s}px`,
        transform: `rotate(${item.rotation}deg)`,
        transformOrigin: 'center',
      },
    });
    for (const [hx, hy, id] of [[0, 0, 'nw'], [1, 0, 'ne'], [0, 1, 'sw'], [1, 1, 'se']] as const) {
      box.appendChild(h('span.sel-handle', {
        style: { left: `${hx * 100}%`, top: `${hy * 100}%`, pointerEvents: 'auto' },
        dataset: { handle: id },
      }));
    }
    box.appendChild(h('span.sel-rotate', {
      style: { left: '50%', top: '-26px', pointerEvents: 'auto' },
      dataset: { handle: 'rotate' },
    }));
    overlay.appendChild(box);
  }

  /* ---------------- Interaction ---------------- */

  type DragState = {
    mode: 'move' | 'resize' | 'rotate';
    handle: string;
    startX: number;
    startY: number;
    orig: Item;
  };
  let drag: DragState | null = null;

  function toDoc(e: PointerEvent): { x: number; y: number } {
    const r = stageEl.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * doc.width, y: ((e.clientY - r.top) / r.height) * doc.height };
  }

  stageEl.style.touchAction = 'none';
  overlay.style.touchAction = 'none';

  const onDown = (e: PointerEvent) => {
    const handle = (e.target as HTMLElement).dataset?.handle;
    const p = toDoc(e);
    if (handle) {
      const item = selected();
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      commit('transform');
      drag = { mode: handle === 'rotate' ? 'rotate' : 'resize', handle, startX: p.x, startY: p.y, orig: structuredClone(item) };
      stageEl.setPointerCapture(e.pointerId);
      return;
    }
    const hit = hitTest(doc, p.x, p.y);
    selectedId = hit?.id ?? null;
    buildInspector();
    drawSelection();
    if (hit) {
      e.preventDefault();
      commit('move');
      drag = { mode: 'move', handle: '', startX: p.x, startY: p.y, orig: structuredClone(hit) };
      stageEl.setPointerCapture(e.pointerId);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const item = selected();
    if (!item) return;
    const p = toDoc(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const o = drag.orig;

    if (drag.mode === 'move') {
      let nx = o.x + dx;
      let ny = o.y + dy;
      if (showGuides) {
        const snaps = snapTargets(item.id);
        nx = snapValue(nx, snaps.x, o.w, doc.width);
        ny = snapValue(ny, snaps.y, o.h, doc.height);
      }
      item.x = nx;
      item.y = ny;
    } else if (drag.mode === 'resize') {
      const west = drag.handle.includes('w');
      const north = drag.handle.includes('n');
      let x1 = west ? o.x + dx : o.x;
      let y1 = north ? o.y + dy : o.y;
      let x2 = west ? o.x + o.w : o.x + o.w + dx;
      let y2 = north ? o.y + o.h : o.y + o.h + dy;
      if (e.shiftKey || item.type === 'image') {
        const ar = o.w / o.h;
        const w = Math.abs(x2 - x1);
        const hgt = w / ar;
        if (north) y1 = y2 - hgt; else y2 = y1 + hgt;
      }
      item.x = Math.min(x1, x2);
      item.y = Math.min(y1, y2);
      item.w = Math.max(20, Math.abs(x2 - x1));
      item.h = Math.max(20, Math.abs(y2 - y1));
    } else {
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      const angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      item.rotation = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
    }
    paint();
  };

  const onUp = () => { drag = null; paint(); };

  stageEl.addEventListener('pointerdown', onDown as EventListener);
  stageEl.addEventListener('pointermove', onMove as EventListener);
  stageEl.addEventListener('pointerup', onUp);
  stageEl.addEventListener('pointercancel', onUp);

  function snapTargets(skipId: string): { x: number[]; y: number[] } {
    const xs = [0, doc.width / 2, doc.width];
    const ys = [0, doc.height / 2, doc.height];
    for (const it of doc.items) {
      if (it.id === skipId) continue;
      xs.push(it.x, it.x + it.w / 2, it.x + it.w);
      ys.push(it.y, it.y + it.h / 2, it.y + it.h);
    }
    return { x: xs, y: ys };
  }

  function snapValue(value: number, targets: number[], size: number, _bound: number): number {
    const threshold = doc.width * 0.012;
    for (const t of targets) {
      if (Math.abs(value - t) < threshold) return t;
      if (Math.abs(value + size / 2 - t) < threshold) return t - size / 2;
      if (Math.abs(value + size - t) < threshold) return t - size;
    }
    return value;
  }

  /* ---------------- History ---------------- */

  function commit(label: string): void {
    history.push(label, structuredClone(doc));
    refreshHistory();
  }
  const undoBtn = iconButton('undo', 'Undo', () => {
    const entry = history.undo(structuredClone(doc));
    if (!entry) return;
    doc = entry.state;
    if (!doc.items.some((i) => i.id === selectedId)) selectedId = null;
    buildInspector();
    paint();
    refreshHistory();
  });
  const redoBtn = iconButton('redo', 'Redo', () => {
    const entry = history.redo(structuredClone(doc));
    if (!entry) return;
    doc = entry.state;
    buildInspector();
    paint();
    refreshHistory();
  });
  function refreshHistory(): void {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
  }

  /* ---------------- Item helpers ---------------- */

  function addItem(item: Item): void {
    commit('add object');
    item.x = Math.round(doc.width * 0.1);
    item.y = Math.round(doc.height * 0.3);
    doc.items.push(item);
    selectedId = item.id;
    buildInspector();
    paint();
  }

  async function addImage(file: File): Promise<void> {
    try {
      const img = await loadImageFromFile(file);
      const id = itemId('asset');
      assets.set(id, img);
      assetBlobs.set(id, file);
      const scale = Math.min((doc.width * 0.7) / img.naturalWidth, (doc.height * 0.7) / img.naturalHeight);
      addItem(makeImage(id, {
        name: file.name.slice(0, 18),
        w: img.naturalWidth * scale,
        h: img.naturalHeight * scale,
      }));
      toast('Image placed', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  function reorder(delta: number): void {
    const idx = doc.items.findIndex((i) => i.id === selectedId);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= doc.items.length) return;
    commit('reorder');
    const [item] = doc.items.splice(idx, 1);
    doc.items.splice(next, 0, item!);
    buildInspector();
    paint();
  }

  function alignSelected(mode: string): void {
    const item = selected();
    if (!item) return;
    commit('align');
    if (mode === 'left') item.x = 0;
    if (mode === 'centerX') item.x = (doc.width - item.w) / 2;
    if (mode === 'right') item.x = doc.width - item.w;
    if (mode === 'top') item.y = 0;
    if (mode === 'centerY') item.y = (doc.height - item.h) / 2;
    if (mode === 'bottom') item.y = doc.height - item.h;
    paint();
  }

  /* ---------------- Inspector ---------------- */

  function buildInspector(): void {
    const ins = ctx.inspector;
    ins.replaceChildren();
    const item = selected();

    ins.appendChild(section('Add',
      h('div.grid-3', null,
        button('Text', { icon: 'text', onClick: () => addItem(makeText({ size: Math.round(doc.width / 12), w: doc.width * 0.8 })) }),
        button('Shape', { icon: 'shape', onClick: () => addItem(makeShape({ w: doc.width * 0.4, h: doc.width * 0.4 })) }),
        button('Image', { icon: 'photo', onClick: () => {
          const input = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
          input.addEventListener('change', () => { if (input.files?.[0]) void addImage(input.files[0]); });
          input.click();
        } }),
      ),
    ));

    if (item) {
      ins.appendChild(section(`${item.name} · ${item.type}`,
        h('div.grid-2', null,
          slider({ label: 'X', min: -doc.width, max: doc.width * 2, value: Math.round(item.x), onInput: (v) => { item.x = v; paint(); } }).root,
          slider({ label: 'Y', min: -doc.height, max: doc.height * 2, value: Math.round(item.y), onInput: (v) => { item.y = v; paint(); } }).root,
        ),
        slider({ label: 'Width', min: 20, max: doc.width * 1.5, value: Math.round(item.w), onInput: (v) => { item.w = v; paint(); } }).root,
        slider({ label: 'Height', min: 20, max: doc.height * 1.5, value: Math.round(item.h), onInput: (v) => { item.h = v; paint(); } }).root,
        slider({ label: 'Rotate', min: -180, max: 180, value: item.rotation, unit: '°', onInput: (v) => { item.rotation = v; paint(); } }).root,
        slider({ label: 'Opacity', min: 0, max: 1, step: 0.01, value: item.opacity, onInput: (v) => { item.opacity = v; paint(); } }).root,
        h('div.grid-3', null,
          button('◧', { title: 'Align left', onClick: () => alignSelected('left') }),
          button('◍', { title: 'Centre across', onClick: () => alignSelected('centerX') }),
          button('◨', { title: 'Align right', onClick: () => alignSelected('right') }),
        ),
        h('div.grid-3', null,
          button('⌃', { title: 'Align top', onClick: () => alignSelected('top') }),
          button('⌯', { title: 'Centre down', onClick: () => alignSelected('centerY') }),
          button('⌄', { title: 'Align bottom', onClick: () => alignSelected('bottom') }),
        ),
        h('div.grid-2', null,
          button('Bring forward', { onClick: () => reorder(1) }),
          button('Send back', { onClick: () => reorder(-1) }),
        ),
        h('div.grid-2', null,
          button('Duplicate', { icon: 'copy', onClick: () => {
            commit('duplicate');
            const copy = structuredClone(item);
            copy.id = itemId('c');
            copy.x += 40;
            copy.y += 40;
            doc.items.push(copy);
            selectedId = copy.id;
            buildInspector();
            paint();
          } }),
          button('Delete', { variant: 'danger', icon: 'trash', onClick: () => {
            commit('delete');
            doc.items = doc.items.filter((i) => i.id !== item.id);
            selectedId = null;
            buildInspector();
            paint();
          } }),
        ),
      ));

      if (item.type === 'text') ins.appendChild(textPanel(item));
      if (item.type === 'shape') ins.appendChild(shapePanel(item));
      if (item.type === 'image') ins.appendChild(imagePanel(item));
    } else {
      ins.appendChild(section('Nothing selected', h('p.hint', null, 'Tap an object on the page to edit it, or add one above.')));
    }

    const layerList = h('div.layer-list');
    for (const it of [...doc.items].reverse()) {
      const row = h('div', { class: `layer-item ${it.id === selectedId ? 'active' : ''}`.trim() },
        h('span.layer-name', null, `${it.name}`),
        h('span.hint', null, it.type),
      );
      row.addEventListener('click', () => { selectedId = it.id; buildInspector(); paint(); });
      layerList.appendChild(row);
    }
    ins.appendChild(section('Objects', layerList.children.length ? layerList : h('p.hint', null, 'The page is empty.')));

    ins.appendChild(section('Page',
      fieldRow('Size', selectInput(
        PAGE_SIZES.map((p) => ({ value: p.value, label: p.label })),
        PAGE_SIZES.find((p) => p.w === doc.width && p.h === doc.height)?.value ?? 'post',
        (v) => {
          const size = PAGE_SIZES.find((p) => p.value === v);
          if (!size) return;
          commit('page size');
          const sx = size.w / doc.width;
          const sy = size.h / doc.height;
          const s = Math.min(sx, sy);
          for (const it of doc.items) { it.x *= s; it.y *= s; it.w *= s; it.h *= s; if (it.type === 'text') it.size *= s; }
          doc.width = size.w;
          doc.height = size.h;
          buildInspector();
          paint();
        },
      )),
      h('div.row', null, h('span.field-label', null, 'Background'), colorInput(doc.background === 'transparent' ? '#ffffff' : doc.background, (v) => { doc.background = v; paint(); })),
      h('div.grid-2', null,
        button('Transparent', { onClick: () => { commit('background'); doc.background = 'transparent'; paint(); } }),
        button(showGuides ? 'Snapping on' : 'Snapping off', { onClick: () => { showGuides = !showGuides; buildInspector(); } }),
      ),
    ));

    const templateGrid = h('div.preset-grid');
    for (const t of TEMPLATES) {
      const card = h('button.preset-card', { type: 'button', title: t.name });
      const thumb = makeCanvas(80, 100);
      card.appendChild(thumb);
      card.appendChild(h('span', null, t.name));
      card.addEventListener('click', () => {
        commit('template');
        doc = t.build();
        selectedId = null;
        buildInspector();
        paint();
        toast(`${t.name} loaded`);
      });
      templateGrid.appendChild(card);
      queueMicrotask(() => {
        const sample = t.build();
        const rendered = renderDesign(sample, assets, Math.min(thumb.width / sample.width, thumb.height / sample.height));
        const g = ctx2d(thumb);
        g.fillStyle = '#20242a';
        g.fillRect(0, 0, thumb.width, thumb.height);
        g.drawImage(rendered, (thumb.width - rendered.width) / 2, (thumb.height - rendered.height) / 2);
      });
    }
    ins.appendChild(section('Templates', templateGrid));

    ins.appendChild(aiPanel({
      size: () => ({ width: doc.width, height: doc.height }),
      onResult: (img) => {
        const id = itemId('asset');
        assets.set(id, img);
        const scale = Math.min(doc.width / img.naturalWidth, doc.height / img.naturalHeight);
        addItem(makeImage(id, { name: 'AI image', w: img.naturalWidth * scale, h: img.naturalHeight * scale, x: 0, y: 0 }));
      },
    }));
  }

  function textPanel(item: TextItem): HTMLElement {
    const area = h('textarea', { class: 'textarea-input', rows: '3' }) as HTMLTextAreaElement;
    area.value = item.text;
    area.addEventListener('input', () => { item.text = area.value; paint(); });
    return section('Text',
      area,
      fieldRow('Font', selectInput(FONTS, item.font, (v) => { item.font = v; paint(); })),
      slider({ label: 'Size', min: 12, max: Math.round(doc.width / 2), value: item.size, onInput: (v) => { item.size = v; paint(); } }).root,
      slider({ label: 'Weight', min: 300, max: 900, step: 100, value: item.weight, onInput: (v) => { item.weight = v; paint(); } }).root,
      slider({ label: 'Line gap', min: 0.8, max: 2.2, step: 0.05, value: item.lineHeight, onInput: (v) => { item.lineHeight = v; paint(); } }).root,
      slider({ label: 'Tracking', min: -12, max: 24, value: item.tracking, onInput: (v) => { item.tracking = v; paint(); } }).root,
      segmented([{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }], item.align,
        (v) => { item.align = v as TextItem['align']; paint(); }).root,
      h('div.row', null, h('span.field-label', null, 'Colour'), colorInput(item.color, (v) => { item.color = v; paint(); })),
      button(item.uppercase ? 'Normal case' : 'UPPERCASE', { onClick: () => { item.uppercase = !item.uppercase; buildInspector(); paint(); } }),
    );
  }

  function shapePanel(item: ShapeItem): HTMLElement {
    return section('Shape',
      segmented([{ value: 'rect', label: 'Rect' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'line', label: 'Line' }], item.shape,
        (v) => { item.shape = v as ShapeItem['shape']; paint(); }).root,
      h('div.row', null, h('span.field-label', null, 'Fill'), colorInput(item.fill === 'transparent' ? '#d7f77b' : item.fill, (v) => { item.fill = v; paint(); })),
      h('div.row', null, h('span.field-label', null, 'Stroke'), colorInput(item.stroke === 'transparent' ? '#1d2420' : item.stroke, (v) => { item.stroke = v; paint(); })),
      slider({ label: 'Stroke', min: 0, max: 40, value: item.strokeWidth, onInput: (v) => { item.strokeWidth = v; paint(); } }).root,
      slider({ label: 'Corner', min: 0, max: 200, value: item.radius, onInput: (v) => { item.radius = v; paint(); } }).root,
      button('No fill', { onClick: () => { item.fill = 'transparent'; paint(); } }),
    );
  }

  function imagePanel(item: ImageItem): HTMLElement {
    return section('Image',
      segmented([{ value: 'cover', label: 'Fill box' }, { value: 'contain', label: 'Fit inside' }], item.fit,
        (v) => { item.fit = v as ImageItem['fit']; paint(); }).root,
      slider({ label: 'Corner', min: 0, max: 400, value: item.radius, onInput: (v) => { item.radius = v; paint(); } }).root,
      button('Replace image', { icon: 'photo', onClick: () => {
        const input = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          const img = await loadImageFromFile(file);
          assets.set(item.assetId, img);
          assetBlobs.set(item.assetId, file);
          paint();
        });
        input.click();
      } }),
    );
  }

  /* ---------------- Toolstrip & export ---------------- */

  ctx.toolstrip.replaceChildren(
    button('Text', { icon: 'text', onClick: () => addItem(makeText({ size: Math.round(doc.width / 12), w: doc.width * 0.8 })) }),
    button('Shape', { icon: 'shape', onClick: () => addItem(makeShape({ w: doc.width * 0.4, h: doc.width * 0.4 })) }),
    button('Image', { icon: 'photo', onClick: () => {
      const input = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
      input.addEventListener('change', () => { if (input.files?.[0]) void addImage(input.files[0]); });
      input.click();
    } }),
    h('div.spacer'),
    undoBtn,
    redoBtn,
  );

  async function exportPdf(): Promise<void> {
    const b = busy('Building your PDF…');
    try {
      const { PDFDocument } = await import('pdf-lib');
      const rendered = renderDesign(doc, assets, 1);
      const blob = await new Promise<Blob | null>((res) => rendered.toBlob(res, 'image/png'));
      if (!blob) throw new Error('Could not render the page.');
      const pdf = await PDFDocument.create();
      const png = await pdf.embedPng(await blob.arrayBuffer());
      // 72pt per inch; treat the design as 300dpi artwork.
      const pw = (doc.width / 300) * 72;
      const ph = (doc.height / 300) * 72;
      const page = pdf.addPage([pw, ph]);
      page.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
      const bytes = await pdf.save();
      download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${safeName(title)}.pdf`);
      toast('PDF downloaded', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      b.done();
    }
  }

  function doExport(): void {
    exportDialog({
      baseName: title,
      width: doc.width,
      height: doc.height,
      render: async (req) => {
        const out = renderDesign(doc, assets, req.scale);
        return req.format === 'jpeg' ? flatten(out) : out;
      },
      extraFormats: [{ value: 'pdf', label: 'PDF — print ready (300 dpi)', run: exportPdf }],
    });
  }

  async function doSave(): Promise<void> {
    const name = (await promptDialog('Save design', 'Project name', title)) ?? title;
    title = name;
    const blobs: Record<string, Blob> = {};
    for (const [id, blob] of assetBlobs) blobs[id] = blob;
    const rec: ProjectRecord = {
      id: projectId ?? newId(),
      tool: 'design',
      title: name,
      created: Date.now(),
      updated: Date.now(),
      thumb: await canvasThumb(renderDesign(doc, assets, Math.min(1, 500 / doc.width))),
      data: doc,
      assets: blobs,
    };
    projectId = rec.id;
    await projects.put(rec);
    toast('Design saved', 'ok');
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
      const item = selected();
      if (!item) return false;
      const step = e.shiftKey ? 20 : 2;
      if (e.key === 'ArrowLeft') { item.x -= step; paint(); return true; }
      if (e.key === 'ArrowRight') { item.x += step; paint(); return true; }
      if (e.key === 'ArrowUp') { item.y -= step; paint(); return true; }
      if (e.key === 'ArrowDown') { item.y += step; paint(); return true; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        commit('delete');
        doc.items = doc.items.filter((i) => i.id !== item.id);
        selectedId = null;
        buildInspector();
        paint();
        return true;
      }
      return false;
    },
  });
  bindPaste(ctx, (file) => void addImage(file));
  ctx.onDestroy(() => cancelAnimationFrame(rafId));

  buildInspector();
  paint();
  refreshHistory();

  /* ---------------- Reopen ---------------- */

  const wanted = params.get('project');
  if (wanted) {
    const rec = await projects.get(wanted);
    if (rec?.data) {
      doc = rec.data as DesignDoc;
      projectId = rec.id;
      title = rec.title;
      for (const [id, blob] of Object.entries(rec.assets ?? {})) {
        try {
          assets.set(id, await loadImageFromFile(blob));
          assetBlobs.set(id, blob);
        } catch { /* skip unreadable asset */ }
      }
      selectedId = null;
      buildInspector();
      paint();
      toast(`Reopened “${rec.title}”`, 'ok');
    }
  }
}
