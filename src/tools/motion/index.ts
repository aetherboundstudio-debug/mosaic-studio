import { h, button, iconButton, section, slider, segmented, fieldRow, selectInput, colorInput } from '../../core/dom';
import { beginScreen } from '../../shell/shell';
import { toast, promptDialog, busy, modal } from '../../core/ui';
import { makeCanvas, canvasThumb, download, safeName, canvasToBlob } from '../../core/image';
import { History } from '../../core/history';
import { projects, newId, type ProjectRecord } from '../../core/storage';
import { bindShortcuts } from '../shared';
import { recordCanvas, encodeGif, supportedVideoMime } from '../../core/record';
import { FONTS } from '../design/model';
import {
  defaultMotionDoc, renderMotionFrame, makeElement, ANIMATIONS, EASINGS, MOTION_SIZES, MOTION_THEMES,
  type MotionDoc, type MotionElement, type AnimKind, type Easing,
} from './render';

export async function renderMotionTool(params: URLSearchParams): Promise<void> {
  const ctx = beginScreen();
  ctx.setTitle('Motion titles', 'Keyframes');

  let doc: MotionDoc = defaultMotionDoc();
  let selectedId = doc.elements[0]!.id;
  let time = 0;
  let playing = false;
  let projectId: string | null = null;
  let title = 'Motion title';

  const history = new History<MotionDoc>(30);

  const preview = makeCanvas(doc.width, doc.height);
  const host = h('div.canvas-host.fit', null, preview);
  const meta = h('div.stage-meta');

  const scrub = h('input', { type: 'range', class: 'slider-input', min: '0', max: '1000', value: '0' }) as HTMLInputElement;
  const timeLabel = h('span.mono', null, '0.00s');
  const playBtn = iconButton('play', 'Play', () => togglePlay());

  const transport = h('div', { style: { display: 'grid', gap: '6px', width: 'min(100%, 680px)' } },
    h('div.row', { style: { flexWrap: 'nowrap' } }, playBtn, scrub, timeLabel),
  );

  ctx.stage.appendChild(h('div.stage-wrap', null, host, transport, meta));

  /* ---------------- Preview ---------------- */

  function previewScale(): number {
    return Math.min(1, 900 / Math.max(doc.width, doc.height));
  }

  function paint(): void {
    renderMotionFrame(doc, time, previewScale(), preview);
    scrub.value = String(Math.round((time / doc.duration) * 1000));
    timeLabel.textContent = `${time.toFixed(2)}s`;
    meta.textContent = `${doc.width} × ${doc.height} · ${doc.duration.toFixed(1)}s · ${doc.elements.length} element${doc.elements.length === 1 ? '' : 's'}`;
  }

  scrub.addEventListener('input', () => {
    stop();
    time = (Number(scrub.value) / 1000) * doc.duration;
    paint();
  });

  let rafId = 0;
  let playStart = 0;
  let playFrom = 0;

  function togglePlay(): void {
    if (playing) stop();
    else play();
  }
  function play(): void {
    playing = true;
    playBtn.replaceChildren();
    playBtn.appendChild(iconEl('pause'));
    playFrom = time >= doc.duration - 0.01 ? 0 : time;
    playStart = performance.now();
    const loop = () => {
      if (!playing) return;
      time = playFrom + (performance.now() - playStart) / 1000;
      if (time >= doc.duration) { time = doc.duration; paint(); stop(); return; }
      paint();
      rafId = requestAnimationFrame(loop);
    };
    loop();
  }
  function stop(): void {
    playing = false;
    cancelAnimationFrame(rafId);
    playBtn.replaceChildren();
    playBtn.appendChild(iconEl('play'));
  }
  function iconEl(name: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ui-icon');
    svg.innerHTML = name === 'play' ? '<path d="m7 4.5 12 7.5-12 7.5z"/>' : '<path d="M8 4.5v15M16 4.5v15"/>';
    return svg;
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
    if (!doc.elements.some((e) => e.id === selectedId)) selectedId = doc.elements[0]?.id ?? '';
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

  function selected(): MotionElement | null {
    return doc.elements.find((e) => e.id === selectedId) ?? null;
  }

  /* ---------------- Timeline strip ---------------- */

  function timelineStrip(): HTMLElement {
    const rows = h('div', { style: { display: 'grid', gap: '5px' } });
    for (const el of doc.elements) {
      const bar = h('div', {
        style: {
          position: 'relative', height: '26px', borderRadius: '6px',
          background: 'var(--surface-2)', cursor: 'pointer', overflow: 'hidden',
          border: el.id === selectedId ? '1px solid var(--accent)' : '1px solid transparent',
        },
      });
      const visibleStart = el.inStart;
      const visibleEnd = el.outAnim === 'none' ? doc.duration : el.outStart + el.outDur;
      bar.appendChild(h('i', {
        style: {
          position: 'absolute', top: '0', bottom: '0',
          left: `${(visibleStart / doc.duration) * 100}%`,
          width: `${Math.max(2, ((visibleEnd - visibleStart) / doc.duration) * 100)}%`,
          background: 'color-mix(in srgb, var(--accent) 45%, transparent)',
        },
      }));
      bar.appendChild(h('span', {
        style: { position: 'absolute', left: '7px', top: '5px', fontSize: '10px', fontWeight: '700', pointerEvents: 'none' },
      }, el.text.slice(0, 22) || 'Text'));
      bar.addEventListener('click', () => { selectedId = el.id; buildInspector(); });
      rows.appendChild(bar);
    }
    const playhead = h('div', {
      style: {
        position: 'relative', height: '4px', marginTop: '4px', borderRadius: '3px', background: 'var(--surface-3)',
      },
    }, h('i', {
      style: {
        position: 'absolute', top: '-3px', width: '2px', height: '10px', background: 'var(--accent)',
        left: `${(time / doc.duration) * 100}%`,
      },
    }));
    return h('div', null, rows, playhead);
  }

  /* ---------------- Inspector ---------------- */

  function buildInspector(): void {
    const ins = ctx.inspector;
    ins.replaceChildren();
    const el = selected();

    ins.appendChild(section('Timeline',
      timelineStrip(),
      slider({ label: 'Length', min: 1, max: 15, step: 0.5, value: doc.duration, unit: 's',
        onInput: (v) => { doc.duration = v; paint(); }, onCommit: () => buildInspector() }).root,
      h('div.grid-2', null,
        button('Add text', { icon: 'plus', onClick: () => {
          commit('add element');
          const next = makeElement({ text: 'New line', y: 0.75, size: 0.06, inStart: 0.5, outStart: Math.max(1, doc.duration - 0.6) });
          doc.elements.push(next);
          selectedId = next.id;
          buildInspector();
          paint();
        } }),
        button('Duplicate', { icon: 'copy', onClick: () => {
          if (!el) return;
          commit('duplicate');
          const copy = structuredClone(el);
          copy.id = `c${Date.now().toString(36)}`;
          copy.y = Math.min(0.95, copy.y + 0.12);
          doc.elements.push(copy);
          selectedId = copy.id;
          buildInspector();
          paint();
        } }),
      ),
    ));

    if (el) {
      const area = h('textarea', { class: 'textarea-input', rows: '2' }) as HTMLTextAreaElement;
      area.value = el.text;
      area.addEventListener('input', () => { el.text = area.value; paint(); });

      ins.appendChild(section('Text',
        area,
        fieldRow('Font', selectInput(FONTS, el.font, (v) => { el.font = v; paint(); })),
        slider({ label: 'Size', min: 0.02, max: 0.3, step: 0.005, value: el.size, onInput: (v) => { el.size = v; paint(); } }).root,
        slider({ label: 'Weight', min: 300, max: 900, step: 100, value: el.weight, onInput: (v) => { el.weight = v; paint(); } }).root,
        slider({ label: 'Tracking', min: -10, max: 24, value: el.tracking, onInput: (v) => { el.tracking = v; paint(); } }).root,
        h('div.row', null, h('span.field-label', null, 'Colour'), colorInput(el.color, (v) => { el.color = v; paint(); })),
        segmented([{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }], el.align,
          (v) => { el.align = v as MotionElement['align']; paint(); }).root,
        slider({ label: 'Across', min: 0, max: 1, step: 0.01, value: el.x, onInput: (v) => { el.x = v; paint(); } }).root,
        slider({ label: 'Down', min: 0, max: 1, step: 0.01, value: el.y, onInput: (v) => { el.y = v; paint(); } }).root,
      ));

      ins.appendChild(section('Animation in',
        fieldRow('Style', selectInput(ANIMATIONS, el.inAnim, (v) => { commit('animation'); el.inAnim = v as AnimKind; paint(); })),
        fieldRow('Easing', selectInput(EASINGS, el.easing, (v) => { el.easing = v as Easing; paint(); })),
        slider({ label: 'Start', min: 0, max: doc.duration, step: 0.05, value: el.inStart, unit: 's',
          onInput: (v) => { el.inStart = v; time = v; paint(); } }).root,
        slider({ label: 'Duration', min: 0.1, max: 4, step: 0.05, value: el.inDur, unit: 's',
          onInput: (v) => { el.inDur = v; paint(); } }).root,
      ));

      ins.appendChild(section('Animation out',
        fieldRow('Style', selectInput(ANIMATIONS, el.outAnim, (v) => { commit('animation'); el.outAnim = v as AnimKind; paint(); })),
        slider({ label: 'Start', min: 0, max: doc.duration, step: 0.05, value: el.outStart, unit: 's',
          onInput: (v) => { el.outStart = v; time = v; paint(); } }).root,
        slider({ label: 'Duration', min: 0.1, max: 4, step: 0.05, value: el.outDur, unit: 's',
          onInput: (v) => { el.outDur = v; paint(); } }).root,
        button('Remove element', { variant: 'danger', icon: 'trash', onClick: () => {
          commit('delete');
          doc.elements = doc.elements.filter((x) => x.id !== el.id);
          selectedId = doc.elements[0]?.id ?? '';
          buildInspector();
          paint();
        } }),
      ));
    }

    const themeRow = h('div.swatch-row');
    for (const theme of MOTION_THEMES) {
      const sw = h('button', {
        class: 'swatch', type: 'button', title: theme.name,
        style: { background: `linear-gradient(135deg, ${theme.a}, ${theme.b})`, width: '32px', height: '32px' },
      });
      sw.addEventListener('click', () => {
        commit('theme');
        doc.bgA = theme.a;
        doc.bgB = theme.b;
        doc.elements.forEach((e, i) => { e.color = i === 0 ? theme.text : theme.accent; });
        buildInspector();
        paint();
      });
      themeRow.appendChild(sw);
    }

    ins.appendChild(section('Background',
      segmented([{ value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Solid' }], doc.bgType,
        (v) => { doc.bgType = v as MotionDoc['bgType']; paint(); }).root,
      h('div.row', null,
        colorInput(doc.bgA, (v) => { doc.bgA = v; paint(); }),
        colorInput(doc.bgB, (v) => { doc.bgB = v; paint(); }),
      ),
      slider({ label: 'Angle', min: 0, max: 360, value: doc.bgAngle, unit: '°', onInput: (v) => { doc.bgAngle = v; paint(); } }).root,
      themeRow,
    ));

    ins.appendChild(section('Canvas',
      fieldRow('Size', selectInput(
        MOTION_SIZES.map((s) => ({ value: s.value, label: s.label })),
        MOTION_SIZES.find((s) => s.w === doc.width && s.h === doc.height)?.value ?? 'wide',
        (v) => {
          const size = MOTION_SIZES.find((s) => s.value === v);
          if (!size) return;
          commit('canvas size');
          doc.width = size.w;
          doc.height = size.h;
          paint();
        },
      )),
      h('p.hint', null, supportedVideoMime()
        ? 'Export writes a real video file using your browser\'s encoder.'
        : 'Video export needs Chrome, Edge or Firefox. GIF and PNG export still work here.'),
    ));
  }

  /* ---------------- Export ---------------- */

  function exportMenu(): void {
    modal('Export motion', (m) => {
      m.body.appendChild(h('p', null, 'Everything renders on your device — no uploads, no watermarks.'));
      m.body.appendChild(button('Video (WebM)', { icon: 'video', variant: 'primary', onClick: () => { m.close(); void exportVideo(); } }));
      m.body.appendChild(button('Animated GIF', { icon: 'motion', onClick: () => { m.close(); void exportGif(); } }));
      m.body.appendChild(button('Still frame (PNG)', { icon: 'photo', onClick: () => { m.close(); void exportFrame(); } }));
      m.body.appendChild(h('p.hint', null, 'WebM plays in browsers and most editors. GIF is bigger but works anywhere, including chat apps.'));
    }, { width: 420 });
  }

  async function exportVideo(): Promise<void> {
    stop();
    const b = busy('Rendering video…');
    const frame = makeCanvas(doc.width, doc.height);
    try {
      const blob = await recordCanvas(frame, {
        fps: 30,
        durationMs: doc.duration * 1000,
        onFrame: (ms) => { renderMotionFrame(doc, ms / 1000, 1, frame); },
        onProgress: (r) => b.update('Rendering video…', r),
      });
      download(blob, `${safeName(title)}.webm`);
      toast('Video downloaded', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err', 4500);
    } finally {
      b.done();
    }
  }

  async function exportGif(): Promise<void> {
    stop();
    const b = busy('Encoding GIF…');
    try {
      const fps = 15;
      const frames = Math.max(2, Math.round(doc.duration * fps));
      const scale = Math.min(1, 640 / doc.width);
      const blob = await encodeGif({
        width: Math.round(doc.width * scale),
        height: Math.round(doc.height * scale),
        fps,
        frames,
        renderFrame: (i) => renderMotionFrame(doc, (i / fps), scale),
        onProgress: (r) => b.update(`Encoding GIF… ${Math.round(r * 100)}%`, r),
      });
      download(blob, `${safeName(title)}.gif`);
      toast('GIF downloaded', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      b.done();
    }
  }

  async function exportFrame(): Promise<void> {
    const frame = renderMotionFrame(doc, time, 1);
    download(await canvasToBlob(frame, 'image/png'), `${safeName(title)}-frame.png`);
    toast('Frame downloaded', 'ok');
  }

  async function doSave(): Promise<void> {
    const name = (await promptDialog('Save project', 'Project name', title)) ?? title;
    title = name;
    const rec: ProjectRecord = {
      id: projectId ?? newId(),
      tool: 'motion',
      title: name,
      created: Date.now(),
      updated: Date.now(),
      thumb: await canvasThumb(renderMotionFrame(doc, doc.duration * 0.55, 0.4)),
      data: doc,
    };
    projectId = rec.id;
    await projects.put(rec);
    toast('Motion saved', 'ok');
  }

  ctx.toolstrip.replaceChildren(
    button('Play', { icon: 'play', onClick: togglePlay }),
    h('div.spacer'),
    undoBtn,
    redoBtn,
  );

  ctx.setActions(
    button('Save', { icon: 'save', onClick: () => void doSave() }),
    button('Export', { icon: 'download', variant: 'primary', onClick: exportMenu }),
  );

  bindShortcuts(ctx, {
    undo: () => undoBtn.click(),
    redo: () => redoBtn.click(),
    save: () => void doSave(),
    export: exportMenu,
    extra: (e) => {
      if (e.key === ' ') { togglePlay(); return true; }
      return false;
    },
  });
  ctx.onDestroy(() => { playing = false; cancelAnimationFrame(rafId); });

  buildInspector();
  paint();
  refreshHistory();

  const wanted = params.get('project');
  if (wanted) {
    const rec = await projects.get(wanted);
    if (rec?.data) {
      doc = rec.data as MotionDoc;
      projectId = rec.id;
      title = rec.title;
      selectedId = doc.elements[0]?.id ?? '';
      buildInspector();
      paint();
      toast(`Reopened “${rec.title}”`, 'ok');
    }
  }
}
