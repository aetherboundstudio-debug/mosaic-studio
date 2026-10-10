/** Canvas → video / GIF encoding, all in-browser. */

import { ctx2d, makeCanvas } from './image';

export function supportedVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export interface RecordOptions {
  fps: number;
  durationMs: number;
  /** Called for each frame with the elapsed time in ms. */
  onFrame: (timeMs: number, frameIndex: number) => void;
  onProgress?: (ratio: number) => void;
  audioTrack?: MediaStreamTrack | null;
  bitrate?: number;
  signal?: AbortSignal;
}

/**
 * Render frames into `canvas` and capture them as a video file.
 * Uses manual frame pushing where available so the result is frame-accurate.
 */
export function recordCanvas(canvas: HTMLCanvasElement, opts: RecordOptions): Promise<Blob> {
  const mime = supportedVideoMime();
  if (!mime) return Promise.reject(new Error('This browser cannot record video. Try Chrome, Edge or Firefox.'));

  return new Promise((resolve, reject) => {
    const manual = typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream === 'function';
    if (!manual) {
      reject(new Error('This browser cannot capture the canvas.'));
      return;
    }

    const stream = canvas.captureStream(opts.fps);
    if (opts.audioTrack) stream.addTrack(opts.audioTrack);

    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: opts.bitrate ?? 8_000_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = () => reject(new Error('Recording failed partway through.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));

    const totalFrames = Math.max(1, Math.round((opts.durationMs / 1000) * opts.fps));
    const frameMs = 1000 / opts.fps;
    let frame = 0;
    const startedAt = performance.now();

    recorder.start();

    const tick = () => {
      if (opts.signal?.aborted) {
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      opts.onFrame(frame * frameMs, frame);
      opts.onProgress?.(frame / totalFrames);
      frame += 1;
      if (frame > totalFrames) {
        // Let the recorder flush the final frame before stopping.
        setTimeout(() => {
          recorder.stop();
          stream.getTracks().forEach((t) => { if (t.kind === 'video') t.stop(); });
        }, 120);
        return;
      }
      // Keep roughly real time so MediaRecorder timestamps stay sane.
      const target = startedAt + frame * frameMs;
      const wait = Math.max(0, target - performance.now());
      setTimeout(tick, wait);
    };
    tick();
  });
}

/** Record a <video> element playing in real time, optionally through a canvas filter. */
export interface ClipRecordOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  startTime: number;
  endTime: number;
  speed: number;
  withAudio: boolean;
  drawFrame: () => void;
  onProgress?: (ratio: number) => void;
  fps?: number;
}

export async function recordClip(opts: ClipRecordOptions): Promise<Blob> {
  const mime = supportedVideoMime();
  if (!mime) throw new Error('This browser cannot record video. Try Chrome, Edge or Firefox.');

  const { video, canvas } = opts;
  const fps = opts.fps ?? 30;
  const stream = canvas.captureStream(fps);

  if (opts.withAudio) {
    try {
      const withCapture = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const src = withCapture.captureStream?.() ?? withCapture.mozCaptureStream?.();
      const track = src?.getAudioTracks()[0];
      if (track) stream.addTrack(track);
    } catch {
      /* audio capture is optional */
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });

  video.pause();
  video.currentTime = opts.startTime;
  await new Promise<void>((res) => {
    const handler = () => { video.removeEventListener('seeked', handler); res(); };
    video.addEventListener('seeked', handler);
  });

  video.playbackRate = opts.speed;
  video.muted = !opts.withAudio;
  recorder.start();
  await video.play();

  let raf = 0;
  const span = Math.max(0.05, opts.endTime - opts.startTime);
  await new Promise<void>((res) => {
    const loop = () => {
      opts.drawFrame();
      opts.onProgress?.((video.currentTime - opts.startTime) / span);
      if (video.currentTime >= opts.endTime || video.ended) {
        res();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  });
  cancelAnimationFrame(raf);
  video.pause();
  setTimeout(() => recorder.stop(), 150);

  return done;
}

/* ---------------- GIF ---------------- */

export interface GifOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  renderFrame: (index: number) => HTMLCanvasElement;
  onProgress?: (ratio: number) => void;
}

export async function encodeGif(opts: GifOptions): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const encoder = GIFEncoder();
  const delay = Math.round(1000 / opts.fps);
  const scratch = makeCanvas(opts.width, opts.height);
  const g = ctx2d(scratch, { willReadFrequently: true });

  for (let i = 0; i < opts.frames; i++) {
    const source = opts.renderFrame(i);
    g.clearRect(0, 0, scratch.width, scratch.height);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, scratch.width, scratch.height);
    g.drawImage(source, 0, 0, scratch.width, scratch.height);
    const { data } = g.getImageData(0, 0, scratch.width, scratch.height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    encoder.writeFrame(index, scratch.width, scratch.height, { palette, delay });
    opts.onProgress?.((i + 1) / opts.frames);
    // Yield so the progress dialog can repaint.
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  encoder.finish();
  return new Blob([encoder.bytes() as BlobPart], { type: 'image/gif' });
}
