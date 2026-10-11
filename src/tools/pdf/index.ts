import { h, button, iconButton, section, fieldRow, selectInput, icon } from '../../core/dom';
import { beginScreen } from '../../shell/shell';
import { toast, busy, confirmDialog, promptDialog } from '../../core/ui';
import { makeCanvas, ctx2d, download, safeName, canvasToBlob, canvasThumb, loadImageFromFile } from '../../core/image';
import { projects, newId, type ProjectRecord } from '../../core/storage';
import { dropZone, bindShortcuts } from '../shared';

interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  /** pdf.js document proxy, used only for thumbnails. */
  proxy?: PdfJsDocument;
}

interface ImageSource {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

interface PageRef {
  key: string;
  kind: 'pdf' | 'image';
  sourceId: string;
  pageIndex: number;
  rotation: number;
}

interface PdfJsPage {
  getViewport(opts: { scale: number; rotation?: number }): { width: number; height: number };
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }): { promise: Promise<void> };
}
interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
}

let pdfjsReady: Promise<{ getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfJsDocument> } }> | null = null;

async function loadPdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const lib = await import('pdfjs-dist/build/pdf.mjs');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      (lib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl;
      return lib as unknown as { getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfJsDocument> } };
    })();
  }
  return pdfjsReady;
}

export async function renderPdfTool(params: URLSearchParams): Promise<void> {
  const ctx = beginScreen();
  ctx.setTitle('PDF workshop', 'Assemble');

  const sources = new Map<string, SourceDoc>();
  const images = new Map<string, ImageSource>();
  let pages: PageRef[] = [];
  const selection = new Set<string>();
  let projectId: string | null = null;
  let title = 'PDF document';
  let thumbScale = 0.45;

  const grid = h('div.page-grid');
  const meta = h('div.stage-meta');
  const stageWrap = h('div', { style: { width: '100%', display: 'grid', gap: '12px', justifyItems: 'center' } }, grid, meta);

  const empty = dropZone({
    title: 'Open PDFs or images',
    body: 'Combine documents, reorder and rotate pages, pull out the ones you need, or turn a folder of photos into a PDF. Everything happens on your device.',
    accept: 'application/pdf,image/*',
    multiple: true,
    iconName: 'pdf',
    onFiles: (files) => void addFiles(files),
  });
  ctx.stage.classList.add('scrollable');
  ctx.stage.appendChild(empty);

  /* ---------------- Loading ---------------- */

  async function addFiles(files: File[]): Promise<void> {
    const b = busy('Reading files…');
    try {
      let index = 0;
      for (const file of files) {
        index += 1;
        b.update(`Reading ${file.name}…`, index / files.length);
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          // eslint-disable-next-line no-await-in-loop
          await addPdf(file);
        } else if (file.type.startsWith('image/')) {
          // eslint-disable-next-line no-await-in-loop
          await addImage(file);
        }
      }
      if (pages.length) {
        if (!ctx.stage.contains(stageWrap)) ctx.stage.replaceChildren(stageWrap);
        buildInspector();
        buildToolstrip();
        await renderGrid();
      }
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      b.done();
    }
  }

  async function addPdf(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = newId();
    const pdfjs = await loadPdfJs();
    let proxy: PdfJsDocument | undefined;
    try {
      proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    } catch {
      throw new Error(`${file.name} could not be read — it may be password protected.`);
    }
    sources.set(id, { id, name: file.name, bytes, proxy });
    for (let i = 0; i < proxy.numPages; i++) {
      pages.push({ key: `${id}:${i}:${Math.random().toString(36).slice(2, 6)}`, kind: 'pdf', sourceId: id, pageIndex: i, rotation: 0 });
    }
    if (title === 'PDF document') title = file.name.replace(/\.pdf$/i, '');
  }

  async function addImage(file: File): Promise<void> {
    const img = await loadImageFromFile(file);
    const id = newId();
    images.set(id, { id, name: file.name, blob: file, width: img.naturalWidth, height: img.naturalHeight });
    pages.push({ key: `${id}:0:${Math.random().toString(36).slice(2, 6)}`, kind: 'image', sourceId: id, pageIndex: 0, rotation: 0 });
  }

  /* ---------------- Page grid ---------------- */

  async function renderGrid(): Promise<void> {
    grid.replaceChildren();
    meta.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · ${selection.size} selected`;
    for (const [i, page] of pages.entries()) {
      const card = h('button.page-card', { type: 'button' });
      if (selection.has(page.key)) card.classList.add('selected');
      const canvas = makeCanvas(120, 160);
      card.appendChild(canvas);
      card.appendChild(h('span.page-num', null, String(i + 1)));
      const pick = h('span.page-pick');
      pick.appendChild(icon('check'));
      card.appendChild(pick);
      card.addEventListener('click', () => {
        if (selection.has(page.key)) selection.delete(page.key);
        else selection.add(page.key);
        card.classList.toggle('selected');
        meta.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · ${selection.size} selected`;
        buildInspector();
      });
      grid.appendChild(card);
      void paintThumb(canvas, page);
    }
  }

  async function paintThumb(canvas: HTMLCanvasElement, page: PageRef): Promise<void> {
    try {
      if (page.kind === 'image') {
        const src = images.get(page.sourceId);
        if (!src) return;
        const img = await loadImageFromFile(src.blob);
        const rotated = page.rotation % 180 !== 0;
        const w = rotated ? img.naturalHeight : img.naturalWidth;
        const hgt = rotated ? img.naturalWidth : img.naturalHeight;
        canvas.width = 150;
        canvas.height = Math.round((hgt / w) * 150);
        const g = ctx2d(canvas);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.save();
        g.translate(canvas.width / 2, canvas.height / 2);
        g.rotate((page.rotation * Math.PI) / 180);
        const scale = Math.min(
          (rotated ? canvas.height : canvas.width) / img.naturalWidth,
          (rotated ? canvas.width : canvas.height) / img.naturalHeight,
        );
        g.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
        g.restore();
        return;
      }
      const src = sources.get(page.sourceId);
      if (!src?.proxy) return;
      const pdfPage = await src.proxy.getPage(page.pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: thumbScale, rotation: page.rotation });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const g = ctx2d(canvas);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: g, viewport, canvas }).promise;
    } catch {
      const g = ctx2d(canvas);
      g.fillStyle = '#888';
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  /* ---------------- Page operations ---------------- */

  function selectedPages(): PageRef[] {
    return pages.filter((p) => selection.has(p.key));
  }

  function rotateSelected(delta: number): void {
    const targets = selection.size ? selectedPages() : pages;
    for (const p of targets) p.rotation = (p.rotation + delta + 360) % 360;
    void renderGrid();
  }

  async function deleteSelected(): Promise<void> {
    if (!selection.size) { toast('Select some pages first', 'err'); return; }
    if (!(await confirmDialog('Remove pages', `Remove ${selection.size} page${selection.size === 1 ? '' : 's'} from this document? The original file on your device is untouched.`, 'Remove'))) return;
    pages = pages.filter((p) => !selection.has(p.key));
    selection.clear();
    buildInspector();
    void renderGrid();
  }

  function movePages(delta: number): void {
    if (!selection.size) { toast('Select some pages first', 'err'); return; }
    const indices = pages.map((p, i) => [p, i] as const).filter(([p]) => selection.has(p.key)).map(([, i]) => i);
    const ordered = delta > 0 ? [...indices].reverse() : indices;
    for (const i of ordered) {
      const next = i + delta;
      if (next < 0 || next >= pages.length) continue;
      if (selection.has(pages[next]!.key)) continue;
      const tmp = pages[i]!;
      pages[i] = pages[next]!;
      pages[next] = tmp;
    }
    void renderGrid();
  }

  function duplicateSelected(): void {
    if (!selection.size) { toast('Select some pages first', 'err'); return; }
    const copies: PageRef[] = [];
    for (const p of pages) {
      copies.push(p);
      if (selection.has(p.key)) copies.push({ ...p, key: `${p.sourceId}:${p.pageIndex}:${Math.random().toString(36).slice(2, 7)}` });
    }
    pages = copies;
    void renderGrid();
  }

  function reverseAll(): void {
    pages = [...pages].reverse();
    void renderGrid();
  }

  /* ---------------- Export ---------------- */

  async function buildPdf(only?: PageRef[]): Promise<Uint8Array> {
    const { PDFDocument, degrees } = await import('pdf-lib');
    const out = await PDFDocument.create();
    const list = only ?? pages;
    const cache = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();

    for (const page of list) {
      if (page.kind === 'pdf') {
        const src = sources.get(page.sourceId);
        if (!src) continue;
        let loaded = cache.get(page.sourceId);
        if (!loaded) {
          loaded = await PDFDocument.load(src.bytes.slice() as unknown as ArrayBuffer, { ignoreEncryption: true });
          cache.set(page.sourceId, loaded);
        }
        const [copied] = await out.copyPages(loaded, [page.pageIndex]);
        if (!copied) continue;
        if (page.rotation) {
          const current = copied.getRotation().angle;
          copied.setRotation(degrees((current + page.rotation) % 360));
        }
        out.addPage(copied);
      } else {
        const src = images.get(page.sourceId);
        if (!src) continue;
        const bytes = new Uint8Array(await src.blob.arrayBuffer());
        const isPng = src.blob.type.includes('png');
        let embedded;
        try {
          embedded = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        } catch {
          // Re-encode anything exotic (WebP, HEIC-converted, etc.) as PNG.
          const img = await loadImageFromFile(src.blob);
          const canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
          ctx2d(canvas).drawImage(img, 0, 0);
          const blob = await canvasToBlob(canvas, 'image/png');
          embedded = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
        }
        const rotated = page.rotation % 180 !== 0;
        const pw = rotated ? embedded.height : embedded.width;
        const ph = rotated ? embedded.width : embedded.height;
        const pdfPage = out.addPage([pw, ph]);
        pdfPage.drawImage(embedded, {
          x: rotated ? (pw - embedded.width) / 2 : 0,
          y: rotated ? (ph - embedded.height) / 2 : 0,
          width: embedded.width,
          height: embedded.height,
          rotate: degrees(page.rotation),
        });
      }
    }

    out.setTitle(title);
    out.setProducer('Mosaic Studio');
    out.setCreator('Mosaic Studio');
    return out.save();
  }

  async function exportPdf(only?: PageRef[]): Promise<void> {
    if (!pages.length) { toast('Open a PDF first', 'err'); return; }
    const b = busy('Writing your PDF…');
    try {
      const bytes = await buildPdf(only);
      download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${safeName(title)}.pdf`);
      toast('PDF downloaded', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err', 4000);
    } finally {
      b.done();
    }
  }

  async function exportPagesAsImages(): Promise<void> {
    const targets = selection.size ? selectedPages() : pages;
    const b = busy('Rendering pages…');
    try {
      for (const [i, page] of targets.entries()) {
        const canvas = makeCanvas(100, 100);
        thumbScale = 2;
        // eslint-disable-next-line no-await-in-loop
        await paintThumb(canvas, page);
        thumbScale = 0.45;
        // eslint-disable-next-line no-await-in-loop
        const blob = await canvasToBlob(canvas, 'image/png');
        download(blob, `${safeName(title)}-page-${i + 1}.png`);
        b.update(`Rendering pages… ${i + 1}/${targets.length}`, (i + 1) / targets.length);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 180));
      }
      toast('Pages downloaded', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      b.done();
    }
  }

  /* ---------------- Inspector ---------------- */

  function buildInspector(): void {
    const ins = ctx.inspector;
    ins.replaceChildren();
    if (!pages.length) {
      ins.appendChild(section('PDF workshop',
        h('p.hint', null, 'Open one or more PDFs to merge, reorder, rotate, split and export them. Images can be added as pages too.')));
      return;
    }

    ins.appendChild(section('Selection',
      h('p.hint', null, `${selection.size} of ${pages.length} page${pages.length === 1 ? '' : 's'} selected.`),
      h('div.grid-2', null,
        button('Select all', { onClick: () => { pages.forEach((p) => selection.add(p.key)); buildInspector(); void renderGrid(); } }),
        button('Clear', { onClick: () => { selection.clear(); buildInspector(); void renderGrid(); } }),
      ),
    ));

    ins.appendChild(section('Arrange',
      h('div.grid-2', null,
        button('Move earlier', { onClick: () => movePages(-1) }),
        button('Move later', { onClick: () => movePages(1) }),
      ),
      h('div.grid-2', null,
        button('Rotate left', { icon: 'rotate', onClick: () => rotateSelected(-90) }),
        button('Rotate right', { icon: 'rotate', onClick: () => rotateSelected(90) }),
      ),
      h('div.grid-2', null,
        button('Duplicate', { icon: 'copy', onClick: duplicateSelected }),
        button('Reverse all', { onClick: reverseAll }),
      ),
      button('Remove selected', { variant: 'danger', icon: 'trash', onClick: () => void deleteSelected() }),
      h('p.hint', null, 'With nothing selected, rotation applies to every page.'),
    ));

    ins.appendChild(section('Add more',
      button('Add PDFs or images', { icon: 'plus', onClick: () => {
        const input = h('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true }) as HTMLInputElement;
        input.addEventListener('change', () => { if (input.files?.length) void addFiles(Array.from(input.files)); });
        input.click();
      } }),
      h('p.hint', null, `Loaded: ${sources.size} PDF${sources.size === 1 ? '' : 's'}, ${images.size} image${images.size === 1 ? '' : 's'}.`),
    ));

    ins.appendChild(section('Export',
      button('Save whole document', { icon: 'download', variant: 'primary', onClick: () => void exportPdf() }),
      button('Save selected pages', { icon: 'scissors', onClick: () => {
        const sel = selectedPages();
        if (!sel.length) { toast('Select some pages first', 'err'); return; }
        void exportPdf(sel);
      } }),
      button('Pages as PNG', { icon: 'photo', onClick: () => void exportPagesAsImages() }),
      fieldRow('Preview', selectInput(
        [{ value: '0.3', label: 'Small' }, { value: '0.45', label: 'Medium' }, { value: '0.8', label: 'Large' }],
        String(thumbScale),
        (v) => { thumbScale = Number(v); void renderGrid(); },
      )),
    ));
  }

  function buildToolstrip(): void {
    ctx.toolstrip.replaceChildren(
      button('Add files', { icon: 'plus', onClick: () => {
        const input = h('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true }) as HTMLInputElement;
        input.addEventListener('change', () => { if (input.files?.length) void addFiles(Array.from(input.files)); });
        input.click();
      } }),
      button('Rotate', { icon: 'rotate', onClick: () => rotateSelected(90) }),
      button('Remove', { icon: 'trash', onClick: () => void deleteSelected() }),
      h('div.spacer'),
      iconButton('check', 'Select all', () => { pages.forEach((p) => selection.add(p.key)); buildInspector(); void renderGrid(); }),
    );
  }

  async function doSave(): Promise<void> {
    if (!pages.length) { toast('Open a PDF first', 'err'); return; }
    const name = (await promptDialog('Save project', 'Project name', title)) ?? title;
    title = name;
    const b = busy('Saving document…');
    try {
      const bytes = await buildPdf();
      const first = grid.querySelector('canvas') as HTMLCanvasElement | null;
      const rec: ProjectRecord = {
        id: projectId ?? newId(),
        tool: 'pdf',
        title: name,
        created: Date.now(),
        updated: Date.now(),
        thumb: first ? await canvasThumb(first) : undefined,
        data: { pageCount: pages.length },
        assets: { document: new Blob([bytes as BlobPart], { type: 'application/pdf' }) },
      };
      projectId = rec.id;
      await projects.put(rec);
      toast('Document saved to projects', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      b.done();
    }
  }

  ctx.setActions(
    button('Save', { icon: 'save', onClick: () => void doSave() }),
    button('Export', { icon: 'download', variant: 'primary', onClick: () => void exportPdf() }),
  );

  bindShortcuts(ctx, {
    save: () => void doSave(),
    export: () => void exportPdf(),
  });

  buildInspector();

  const wanted = params.get('project');
  if (wanted) {
    const rec = await projects.get(wanted);
    const blob = rec?.assets?.document;
    if (rec && blob) {
      projectId = rec.id;
      title = rec.title;
      await addFiles([new File([blob], `${rec.title}.pdf`, { type: 'application/pdf' })]);
      toast(`Reopened “${rec.title}”`, 'ok');
    }
  }
}
