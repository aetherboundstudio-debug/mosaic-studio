import { h, button, iconButton, section, slider, segmented, fieldRow, selectInput } from '../../core/dom';
import { beginScreen } from '../../shell/shell';
import { toast, busy, modal, promptDialog } from '../../core/ui';
import { makeCanvas, ctx2d, canvasThumb, download, safeName, canvasToBlob, clamp } from '../../core/image';
import { projects, newId, type ProjectRecord } from '../../core/storage';
import { dropZone, bindShortcuts } from '../shared';
import { recordClip, encodeGif, supportedVideoMime } from '../../core/record';

interface Look {
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  hue: number;
  blur: number;
}

const OUTPUT_FRAMES = [
  { value: 'source', label: 'Keep original shape' },
  { value: '1', label: 'Square 1:1' },
  { value: '0.5625', label: 'Story 9:16' },
  { value: '1.7778', label: 'Wide 16:9' },
  { value: '1.3333', label: 'Classic 4:3' },
];

export async function renderVideoTool(params: URLSearchParams): Promise<void> {
  const ctx = beginScreen();
  ctx.setTitle('Video cutter', 'Trim & render');

  let video: HTMLVideoElement | null = null;
  let sourceBlob: Blob | null = null;
  let objectUrl: string | null = null;
  let duration = 0;
  let inPoint = 0;
  let outPoint = 0;
  let speed = 1;
  let withAudio = true;
  let frameRatio = 'source';
  let projectId: string | null = null;
  let title = 'Video edit';

  const look: Look = { brightness: 100, contrast: 100, saturation: 100, sepia: 0, hue: 0, blur: 0 };

  const canvas = makeCanvas(640, 360);
  const host = h('div.canvas-host.fit', null, canvas);
  const timeline = h('div.timeline');
  const filmstrip = h('div.tl-filmstrip');
  const dimLeft = h('div.tl-dim');
  const dimRight = h('div.tl-dim');
  const selection = h('div.tl-sel');
  const playhead = h('div.tl-playhead');
  const handleIn = h('div.tl-handle', { dataset: { handle: 'in' } }, h('i'));
  const handleOut = h('div.tl-handle', { dataset: { handle: 'out' } }, h('i'));
  timeline.append(filmstrip, dimLeft, dimRight, selection, playhead, handleIn, handleOut);

  const readout = h('div.time-readout');
  const playBtn = iconButton('play', 'Play selection', () => togglePlay());
  const transport = h('div', { style: { display: 'grid', gap: '7px', width: 'min(100%, 760px)' } },
    timeline, readout,
    h('div.row', { style: { justifyContent: 'center' } },
      playBtn,
      button('Set start', { icon: 'crop', onClick: () => { if (video) { inPoint = Math.min(video.currentTime, outPoint - 0.1); syncTimeline(); } } }),
      button('Set end', { icon: 'crop', onClick: () => { if (video) { outPoint = Math.max(video.currentTime, inPoint + 0.1); syncTimeline(); } } }),
    ),
  );

  const meta = h('div.stage-meta');
  const stageWrap = h('div.stage-wrap', null, host, transport, meta);

  const empty = dropZone({
    title: 'Open a video clip',
    body: 'MP4, WebM or MOV — whatever your browser can play. The file stays on your device; rendering happens right here.',
    accept: 'video/*',
    iconName: 'video',
    onFiles: (files) => void openFile(files[0]!),
  });
  ctx.stage.appendChild(empty);

  /* ---------------- Playback / drawing ---------------- */

  function outputSize(): { w: number; h: number } {
    if (!video) return { w: 640, h: 360 };
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    if (frameRatio === 'source') return { w: vw, h: vh };
    const ratio = Number(frameRatio);
    if (vw / vh > ratio) return { w: Math.round(vh * ratio), h: vh };
    return { w: vw, h: Math.round(vw / ratio) };
  }

  function filterString(): string {
    return [
      `brightness(${look.brightness}%)`,
      `contrast(${look.contrast}%)`,
      `saturate(${look.saturation}%)`,
      look.sepia ? `sepia(${look.sepia}%)` : '',
      look.hue ? `hue-rotate(${look.hue}deg)` : '',
      look.blur ? `blur(${look.blur}px)` : '',
    ].filter(Boolean).join(' ');
  }

  function drawFrame(): void {
    if (!video) return;
    const size = outputSize();
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w;
      canvas.height = size.h;
    }
    const g = ctx2d(canvas);
    g.save();
    g.filter = filterString();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(size.w / vw, size.h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    g.drawImage(video, (size.w - dw) / 2, (size.h - dh) / 2, dw, dh);
    g.restore();
  }

  let rafId = 0;
  function loop(): void {
    drawFrame();
    syncPlayhead();
    if (video && !video.paused && video.currentTime >= outPoint) {
      video.pause();
      playBtn.replaceChildren(playIcon('play'));
    }
    rafId = requestAnimationFrame(loop);
  }

  function playIcon(name: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ui-icon');
    svg.innerHTML = name === 'play' ? '<path d="m7 4.5 12 7.5-12 7.5z"/>' : '<path d="M8 4.5v15M16 4.5v15"/>';
    return svg;
  }

  function togglePlay(): void {
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < inPoint || video.currentTime >= outPoint) video.currentTime = inPoint;
      video.playbackRate = speed;
      void video.play();
      playBtn.replaceChildren(playIcon('pause'));
    } else {
      video.pause();
      playBtn.replaceChildren(playIcon('play'));
    }
  }

  /* ---------------- Timeline ---------------- */

  function syncPlayhead(): void {
    if (!video || !duration) return;
    playhead.style.left = `${(video.currentTime / duration) * 100}%`;
    readout.replaceChildren(
      h('span', null, `in ${fmt(inPoint)}`),
      h('span', null, `${fmt(video.currentTime)} / ${fmt(duration)}`),
      h('span', null, `out ${fmt(outPoint)}`),
    );
  }

  function syncTimeline(): void {
    if (!duration) return;
    const a = (inPoint / duration) * 100;
    const b = (outPoint / duration) * 100;
    selection.style.left = `${a}%`;
    selection.style.width = `${Math.max(0.5, b - a)}%`;
    dimLeft.style.left = '0';
    dimLeft.style.width = `${a}%`;
    dimRight.style.left = `${b}%`;
    dimRight.style.width = `${100 - b}%`;
    handleIn.style.left = `calc(${a}% - 8px)`;
    handleOut.style.left = `calc(${b}% - 8px)`;
    const span = (outPoint - inPoint) / speed;
    meta.textContent = `${outputSize().w} × ${outputSize().h} · selection ${fmt(outPoint - inPoint)} → renders ${fmt(span)}`;
    syncPlayhead();
  }

  let tlDrag: string | null = null;
  timeline.addEventListener('pointerdown', (e) => {
    if (!video || !duration) return;
    const handle = (e.target as HTMLElement).closest('.tl-handle') as HTMLElement | null;
    timeline.setPointerCapture(e.pointerId);
    tlDrag = handle?.dataset.handle ?? 'seek';
    onTimelineMove(e);
  });
  timeline.addEventListener('pointermove', (e) => { if (tlDrag) onTimelineMove(e); });
  const tlUp = () => { tlDrag = null; };
  timeline.addEventListener('pointerup', tlUp);
  timeline.addEventListener('pointercancel', tlUp);

  function onTimelineMove(e: PointerEvent): void {
    if (!video || !duration) return;
    const rect = timeline.getBoundingClientRect();
    const t = clamp(((e.clientX - rect.left) / rect.width) * duration, 0, duration);
    if (tlDrag === 'in') inPoint = Math.min(t, outPoint - 0.05);
    else if (tlDrag === 'out') outPoint = Math.max(t, inPoint + 0.05);
    else { video.currentTime = t; }
    syncTimeline();
  }

  async function buildFilmstrip(): Promise<void> {
    if (!video) return;
    filmstrip.replaceChildren();
    const count = 12;
    const probe = document.createElement('video');
    probe.src = objectUrl!;
    probe.muted = true;
    probe.playsInline = true;
    await new Promise<void>((res) => { probe.onloadeddata = () => res(); probe.onerror = () => res(); });
    for (let i = 0; i < count; i++) {
      const t = (i / count) * duration;
      // eslint-disable-next-line no-await-in-loop
      const ok = await seekTo(probe, t);
      if (!ok) break;
      const thumb = makeCanvas(80, 46);
      const g = ctx2d(thumb);
      try {
        const scale = Math.max(thumb.width / probe.videoWidth, thumb.height / probe.videoHeight);
        g.drawImage(probe, (thumb.width - probe.videoWidth * scale) / 2, (thumb.height - probe.videoHeight * scale) / 2,
          probe.videoWidth * scale, probe.videoHeight * scale);
      } catch { /* frame not ready */ }
      filmstrip.appendChild(thumb);
    }
  }

  function seekTo(el: HTMLVideoElement, t: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      const handler = () => { el.removeEventListener('seeked', handler); done(true); };
      el.addEventListener('seeked', handler);
      setTimeout(() => done(false), 2500);
      try { el.currentTime = t; } catch { done(false); }
    });
  }

  function fmt(s: number): string {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const cs = Math.floor((s % 1) * 100);
    return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  /* ---------------- Loading ---------------- */

  async function openFile(file: File): Promise<void> {
    if (!file.type.startsWith('video/')) { toast('Please choose a video file', 'err'); return; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    sourceBlob = file;
    objectUrl = URL.createObjectURL(file);
    title = file.name.replace(/\.[^.]+$/, '') || 'Video edit';

    const el = document.createElement('video');
    el.src = objectUrl;
    el.playsInline = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';

    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('That video could not be opened.'));
    }).catch((err: Error) => { toast(err.message, 'err'); });

    if (!el.videoWidth) { toast('That video could not be decoded here', 'err'); return; }

    video = el;
    duration = el.duration;
    inPoint = 0;
    outPoint = duration;
    ctx.stage.replaceChildren(stageWrap);
    syncTimeline();
    cancelAnimationFrame(rafId);
    loop();
    buildInspector();
    buildToolstrip();
    void buildFilmstrip();
    toast('Clip loaded', 'ok');
  }

  /* ---------------- Inspector ---------------- */

  function buildInspector(): void {
    const ins = ctx.inspector;
    ins.replaceChildren();
    if (!video) {
      ins.appendChild(section('Video cutter', h('p.hint', null, 'Open a clip to trim it, grade it and render a brand new file — all without uploading anything.')));
      return;
    }

    ins.appendChild(section('Selection',
      slider({ label: 'Start', min: 0, max: duration, step: 0.02, value: inPoint, unit: 's',
        onInput: (v) => { inPoint = Math.min(v, outPoint - 0.05); if (video) video.currentTime = inPoint; syncTimeline(); } }).root,
      slider({ label: 'End', min: 0, max: duration, step: 0.02, value: outPoint, unit: 's',
        onInput: (v) => { outPoint = Math.max(v, inPoint + 0.05); if (video) video.currentTime = outPoint; syncTimeline(); } }).root,
      h('div.grid-2', null,
        button('Start here', { onClick: () => { if (video) { inPoint = Math.min(video.currentTime, outPoint - 0.05); syncTimeline(); buildInspector(); } } }),
        button('End here', { onClick: () => { if (video) { outPoint = Math.max(video.currentTime, inPoint + 0.05); syncTimeline(); buildInspector(); } } }),
      ),
      button('Select everything', { onClick: () => { inPoint = 0; outPoint = duration; syncTimeline(); buildInspector(); } }),
    ));

    ins.appendChild(section('Playback',
      fieldRow('Speed', selectInput(
        [
          { value: '0.25', label: '0.25× slow motion' },
          { value: '0.5', label: '0.5× slow' },
          { value: '1', label: 'Normal' },
          { value: '1.5', label: '1.5× quick' },
          { value: '2', label: '2× fast' },
        ],
        String(speed),
        (v) => { speed = Number(v); if (video) video.playbackRate = speed; syncTimeline(); },
      )),
      fieldRow('Frame', selectInput(OUTPUT_FRAMES, frameRatio, (v) => { frameRatio = v; drawFrame(); syncTimeline(); })),
      segmented([{ value: 'on', label: 'Keep audio' }, { value: 'off', label: 'Silent' }], withAudio ? 'on' : 'off',
        (v) => { withAudio = v === 'on'; if (video) video.muted = !withAudio; }).root,
    ));

    ins.appendChild(section('Grade',
      slider({ label: 'Brightness', min: 20, max: 200, value: look.brightness, unit: '%', onInput: (v) => { look.brightness = v; drawFrame(); } }).root,
      slider({ label: 'Contrast', min: 20, max: 200, value: look.contrast, unit: '%', onInput: (v) => { look.contrast = v; drawFrame(); } }).root,
      slider({ label: 'Saturation', min: 0, max: 250, value: look.saturation, unit: '%', onInput: (v) => { look.saturation = v; drawFrame(); } }).root,
      slider({ label: 'Warmth', min: 0, max: 100, value: look.sepia, unit: '%', onInput: (v) => { look.sepia = v; drawFrame(); } }).root,
      slider({ label: 'Hue', min: -180, max: 180, value: look.hue, unit: '°', onInput: (v) => { look.hue = v; drawFrame(); } }).root,
      slider({ label: 'Soften', min: 0, max: 12, value: look.blur, unit: 'px', onInput: (v) => { look.blur = v; drawFrame(); } }).root,
      button('Reset grade', { onClick: () => {
        Object.assign(look, { brightness: 100, contrast: 100, saturation: 100, sepia: 0, hue: 0, blur: 0 });
        buildInspector();
        drawFrame();
      } }),
    ));

    ins.appendChild(section('Output',
      h('p.hint', null, supportedVideoMime()
        ? 'Rendering plays the selection once in real time and writes a new WebM file. Keep this tab in front while it runs.'
        : 'This browser cannot write video files. GIF and still-frame export still work.'),
      button('Render clip', { icon: 'video', variant: 'primary', onClick: () => void exportClip() }),
      button('Animated GIF', { icon: 'motion', onClick: () => void exportGif() }),
      button('Grab this frame', { icon: 'photo', onClick: () => void exportFrame() }),
    ));
  }

  function buildToolstrip(): void {
    ctx.toolstrip.replaceChildren(
      button('Play', { icon: 'play', onClick: togglePlay }),
      button('Start here', { onClick: () => { if (video) { inPoint = Math.min(video.currentTime, outPoint - 0.05); syncTimeline(); } } }),
      button('End here', { onClick: () => { if (video) { outPoint = Math.max(video.currentTime, inPoint + 0.05); syncTimeline(); } } }),
      h('div.spacer'),
      iconButton('plus', 'Open another clip', () => {
        const input = h('input', { type: 'file', accept: 'video/*' }) as HTMLInputElement;
        input.addEventListener('change', () => { if (input.files?.[0]) void openFile(input.files[0]); });
        input.click();
      }),
    );
  }

  /* ---------------- Export ---------------- */

  async function exportClip(): Promise<void> {
    if (!video) return;
    const span = (outPoint - inPoint) / speed;
    const b = busy(`Rendering ${fmt(span)} of video…`);
    try {
      const blob = await recordClip({
        video,
        canvas,
        startTime: inPoint,
        endTime: outPoint,
        speed,
        withAudio,
        drawFrame,
        onProgress: (r) => b.update(`Rendering… ${Math.round(Math.min(1, r) * 100)}%`, r),
      });
      download(blob, `${safeName(title)}-cut.webm`);
      toast('Clip rendered and downloaded', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err', 4500);
    } finally {
      b.done();
      video.playbackRate = speed;
    }
  }

  async function exportGif(): Promise<void> {
    if (!video) return;
    const span = outPoint - inPoint;
    if (span > 12) { toast('Pick a shorter section for GIF (under 12s)', 'err'); return; }
    const b = busy('Collecting frames…');
    try {
      const fps = 10;
      const frames = Math.max(2, Math.min(120, Math.round((span / speed) * fps)));
      const size = outputSize();
      const scale = Math.min(1, 480 / size.w);
      const w = Math.round(size.w * scale);
      const hh = Math.round(size.h * scale);

      const shots: HTMLCanvasElement[] = [];
      const probe = document.createElement('video');
      probe.src = objectUrl!;
      probe.muted = true;
      probe.playsInline = true;
      await new Promise<void>((res) => { probe.onloadeddata = () => res(); probe.onerror = () => res(); });

      for (let i = 0; i < frames; i++) {
        const t = inPoint + (i / frames) * span;
        // eslint-disable-next-line no-await-in-loop
        await seekTo(probe, t);
        const shot = makeCanvas(w, hh);
        const g = ctx2d(shot);
        g.filter = filterString();
        const s = Math.max(w / probe.videoWidth, hh / probe.videoHeight);
        g.drawImage(probe, (w - probe.videoWidth * s) / 2, (hh - probe.videoHeight * s) / 2, probe.videoWidth * s, probe.videoHeight * s);
        shots.push(shot);
        b.update(`Collecting frames… ${i + 1}/${frames}`, (i + 1) / frames / 2);
      }

      const blob = await encodeGif({
        width: w, height: hh, fps, frames: shots.length,
        renderFrame: (i) => shots[i]!,
        onProgress: (r) => b.update(`Encoding GIF… ${Math.round(r * 100)}%`, 0.5 + r / 2),
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
    drawFrame();
    download(await canvasToBlob(canvas, 'image/png'), `${safeName(title)}-frame.png`);
    toast('Frame saved', 'ok');
  }

  async function doSave(): Promise<void> {
    if (!video) { toast('Open a clip first', 'err'); return; }
    const name = (await promptDialog('Save project', 'Project name', title)) ?? title;
    title = name;
    drawFrame();
    const assets: Record<string, Blob> = {};
    const tooBig = sourceBlob && sourceBlob.size > 80 * 1024 * 1024;
    if (sourceBlob && !tooBig) assets.source = sourceBlob;
    const rec: ProjectRecord = {
      id: projectId ?? newId(),
      tool: 'video',
      title: name,
      created: Date.now(),
      updated: Date.now(),
      thumb: await canvasThumb(canvas),
      data: { inPoint, outPoint, speed, withAudio, frameRatio, look },
      assets,
      note: tooBig ? 'Clip too large to store — reopen the file to continue.' : undefined,
    };
    projectId = rec.id;
    await projects.put(rec);
    toast(tooBig ? 'Settings saved (clip too large to store)' : 'Project saved', 'ok');
  }

  ctx.setActions(
    button('Save', { icon: 'save', onClick: () => void doSave() }),
    button('Export', { icon: 'download', variant: 'primary', onClick: () => {
      if (!video) { toast('Open a clip first', 'err'); return; }
      modal('Export video', (m) => {
        m.body.appendChild(h('p', null, `Selection: ${fmt(outPoint - inPoint)} at ${speed}× → ${fmt((outPoint - inPoint) / speed)} of footage.`));
        m.body.appendChild(button('Render clip (WebM)', { icon: 'video', variant: 'primary', onClick: () => { m.close(); void exportClip(); } }));
        m.body.appendChild(button('Animated GIF', { icon: 'motion', onClick: () => { m.close(); void exportGif(); } }));
        m.body.appendChild(button('Still frame (PNG)', { icon: 'photo', onClick: () => { m.close(); void exportFrame(); } }));
      }, { width: 420 });
    } }),
  );

  bindShortcuts(ctx, {
    save: () => void doSave(),
    export: () => void exportClip(),
    extra: (e) => {
      if (e.key === ' ') { togglePlay(); return true; }
      if (e.key === 'i' && video) { inPoint = Math.min(video.currentTime, outPoint - 0.05); syncTimeline(); return true; }
      if (e.key === 'o' && video) { outPoint = Math.max(video.currentTime, inPoint + 0.05); syncTimeline(); return true; }
      return false;
    },
  });

  ctx.onDestroy(() => {
    cancelAnimationFrame(rafId);
    video?.pause();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  buildInspector();

  const wanted = params.get('project');
  if (wanted) {
    const rec = await projects.get(wanted);
    const blob = rec?.assets?.source;
    if (rec && blob) {
      await openFile(new File([blob], `${rec.title}.webm`, { type: blob.type || 'video/webm' }));
      const data = rec.data as { inPoint: number; outPoint: number; speed: number; withAudio: boolean; frameRatio: string; look: Look } | undefined;
      if (data) {
        inPoint = data.inPoint;
        outPoint = data.outPoint;
        speed = data.speed;
        withAudio = data.withAudio;
        frameRatio = data.frameRatio;
        Object.assign(look, data.look);
        projectId = rec.id;
        title = rec.title;
        syncTimeline();
        buildInspector();
        drawFrame();
      }
    } else if (rec) {
      toast('Reopen the original clip to continue this project');
    }
  }
}
