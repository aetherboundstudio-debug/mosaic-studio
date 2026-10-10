import { h, button, icon, fieldRow, selectInput } from '../core/dom';
import { modal, toast } from '../core/ui';
import { canvasToBlob, download, makeCanvas, ctx2d, safeName } from '../core/image';
import { settings } from '../core/storage';
import type { ToolContext } from '../shell/shell';

/** Big friendly "open a file" target that also accepts drag-and-drop and paste. */
export function dropZone(opts: {
  title: string;
  body: string;
  accept: string;
  multiple?: boolean;
  iconName?: string;
  onFiles: (files: File[]) => void;
  extra?: HTMLElement | null;
}): HTMLElement {
  const input = h('input', { type: 'file', accept: opts.accept, multiple: !!opts.multiple, class: 'hidden' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    if (files.length) opts.onFiles(files);
    input.value = '';
  });

  const pick = button('Choose file', { icon: 'plus', variant: 'primary', onClick: () => input.click() });

  const zone = h('div.drop-zone', null,
    h('div.mark', null, icon(opts.iconName ?? 'photo')),
    h('strong', null, opts.title),
    h('p', null, opts.body),
    h('div.row', null, pick, opts.extra ?? null),
    input,
  );

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = Array.from((e as DragEvent).dataTransfer?.files ?? []);
    if (files.length) opts.onFiles(files);
  });

  return zone;
}

/** Tool-level keyboard shortcuts, auto-removed when the screen changes. */
export function bindShortcuts(
  ctx: ToolContext,
  map: { undo?: () => void; redo?: () => void; save?: () => void; export?: () => void; extra?: (e: KeyboardEvent) => boolean },
): void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (map.extra?.(e)) { e.preventDefault(); return; }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey && map.undo) { e.preventDefault(); map.undo(); }
    else if (((k === 'z' && e.shiftKey) || k === 'y') && map.redo) { e.preventDefault(); map.redo(); }
    else if (k === 's' && map.save) { e.preventDefault(); map.save(); }
    else if (k === 'e' && map.export) { e.preventDefault(); map.export(); }
  };
  window.addEventListener('keydown', onKey);
  ctx.onDestroy(() => window.removeEventListener('keydown', onKey));
}

/** Paste an image from the clipboard into the active tool. */
export function bindPaste(ctx: ToolContext, onImage: (file: File) => void): void {
  const onPaste = (e: ClipboardEvent) => {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) { e.preventDefault(); onImage(file); }
  };
  window.addEventListener('paste', onPaste);
  ctx.onDestroy(() => window.removeEventListener('paste', onPaste));
}

export interface ExportRequest {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  scale: number;
}

/** Shared export sheet: format, quality and output scale. */
export function exportDialog(opts: {
  baseName: string;
  width: number;
  height: number;
  render: (req: ExportRequest) => Promise<HTMLCanvasElement>;
  extraFormats?: Array<{ value: string; label: string; run: () => Promise<void> }>;
}): void {
  modal('Export', (m) => {
    const req: ExportRequest = {
      format: settings().exportFormat,
      quality: settings().exportQuality,
      scale: 1,
    };
    const sizeLine = h('p.hint.mono');
    const updateSize = () => {
      sizeLine.textContent = `${Math.round(opts.width * req.scale)} × ${Math.round(opts.height * req.scale)} px`;
    };
    updateSize();

    m.body.appendChild(fieldRow('Format', selectInput(
      [
        { value: 'png', label: 'PNG — lossless, keeps transparency' },
        { value: 'jpeg', label: 'JPEG — smallest for photos' },
        { value: 'webp', label: 'WebP — small and modern' },
        ...(opts.extraFormats ?? []).map((f) => ({ value: f.value, label: f.label })),
      ],
      req.format,
      (v) => { req.format = v as ExportRequest['format']; },
    )));

    const qualityInput = h('input', { type: 'range', class: 'slider-input', min: '0.4', max: '1', step: '0.01', value: String(req.quality) }) as HTMLInputElement;
    qualityInput.addEventListener('input', () => { req.quality = Number(qualityInput.value); });
    m.body.appendChild(fieldRow('Quality', qualityInput));

    const scaleSel = selectInput(
      [
        { value: '0.5', label: 'Half size' },
        { value: '1', label: 'Original size' },
        { value: '1.5', label: '1.5×' },
        { value: '2', label: '2× (print)' },
      ],
      '1',
      (v) => { req.scale = Number(v); updateSize(); },
    );
    m.body.appendChild(fieldRow('Scale', scaleSel));
    m.body.appendChild(sizeLine);

    m.footer.appendChild(button('Cancel', { onClick: () => m.close() }));
    m.footer.appendChild(button('Download', { variant: 'primary', icon: 'download', onClick: async () => {
      const extra = (opts.extraFormats ?? []).find((f) => f.value === req.format);
      m.close();
      try {
        if (extra) { await extra.run(); return; }
        const canvas = await opts.render(req);
        const mime = `image/${req.format}`;
        const out = req.format === 'jpeg' ? flatten(canvas) : canvas;
        const blob = await canvasToBlob(out, mime, req.quality);
        download(blob, `${safeName(opts.baseName)}.${req.format === 'jpeg' ? 'jpg' : req.format}`);
        toast('Saved to your downloads', 'ok');
      } catch (err) {
        toast((err as Error).message || 'Export failed', 'err');
      }
    } }));
  }, { width: 440 });
}

/** JPEG has no alpha — composite onto white first. */
export function flatten(canvas: HTMLCanvasElement, background = '#ffffff'): HTMLCanvasElement {
  const out = makeCanvas(canvas.width, canvas.height);
  const g = ctx2d(out);
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0);
  return out;
}

/** Standard "Save / Export" pair for the top bar. */
export function topActions(onSave: () => void, onExport: () => void): HTMLElement[] {
  return [
    button('Save', { icon: 'save', onClick: onSave }),
    button('Export', { icon: 'download', variant: 'primary', onClick: onExport }),
  ];
}

export function stageCanvasHost(fit = true): { host: HTMLElement; canvas: HTMLCanvasElement } {
  const canvas = makeCanvas(16, 16);
  const host = h('div', { class: `canvas-host ${fit ? 'fit' : ''}`.trim() }, canvas);
  return { host, canvas };
}
