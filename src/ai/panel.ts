import { h, button, section, selectInput } from '../core/dom';
import { toast } from '../core/ui';
import { navigate } from '../core/router';
import { aiReady, activeProvider, generateImage, AiError } from './client';
import { loadImageFromFile } from '../core/image';

export interface AiPanelOptions {
  /** Called with the generated artwork. */
  onResult: (img: HTMLImageElement, prompt: string) => void;
  /** Suggested output size. */
  size?: () => { width: number; height: number };
  /** Supply a reference image to drive an edit instead of a fresh generation. */
  reference?: () => Promise<Blob | null>;
  /** Supply a mask (transparent = regenerate here). */
  mask?: () => Promise<Blob | null>;
  title?: string;
}

const STYLE_HINTS = [
  { value: '', label: 'No style hint' },
  { value: 'photorealistic, 50mm lens, natural light, fine detail', label: 'Photoreal' },
  { value: 'soft watercolour illustration, paper texture, gentle palette', label: 'Watercolour' },
  { value: 'bold flat vector illustration, limited palette, clean shapes', label: 'Flat vector' },
  { value: 'cinematic lighting, moody atmosphere, shallow depth of field', label: 'Cinematic' },
  { value: 'risograph print, grainy duotone, offset registration', label: 'Risograph' },
  { value: '3d render, soft studio lighting, subtle subsurface scattering', label: '3D render' },
  { value: 'pencil sketch, cross-hatching, off-white paper', label: 'Pencil' },
];

/** A prompt panel that stays inert (but informative) until a provider is configured. */
export function aiPanel(opts: AiPanelOptions): HTMLElement {
  const ready = aiReady();
  const title = opts.title ?? 'AI assist';

  if (!ready) {
    return section(title,
      h('p.hint', null,
        'Dormant. Mosaic never ships an API key, so prompt-to-image stays switched off until you connect your own provider. ',
        'Everything else in this tool works offline.'),
      button('Connect a provider', { icon: 'key', variant: 'ghost', onClick: () => navigate('/settings') }),
    );
  }

  const provider = activeProvider()!;
  const promptBox = h('textarea', {
    class: 'textarea-input',
    placeholder: 'A quiet harbour at dawn, long shadows, pastel sky…',
    rows: '3',
  }) as HTMLTextAreaElement;

  let style = '';
  const styleSel = selectInput(STYLE_HINTS, '', (v) => { style = v; });

  const status = h('p.hint');
  let controller: AbortController | null = null;

  const run = async (useReference: boolean) => {
    const base = promptBox.value.trim();
    if (!base) { toast('Describe what you want first', 'err'); return; }
    const prompt = style ? `${base}. ${style}` : base;
    const size = opts.size?.() ?? { width: 1024, height: 1024 };
    controller = new AbortController();
    go.disabled = true;
    if (editBtn) editBtn.disabled = true;
    status.textContent = `Asking ${provider.label}…`;
    try {
      const reference = useReference && opts.reference ? await opts.reference() : null;
      const mask = useReference && opts.mask ? await opts.mask() : null;
      const blob = await generateImage({
        prompt,
        width: snapSize(size.width),
        height: snapSize(size.height),
        image: reference ?? undefined,
        mask: mask ?? undefined,
        signal: controller.signal,
      });
      const img = await loadImageFromFile(blob);
      opts.onResult(img, prompt);
      status.textContent = 'Done — added to your canvas.';
      toast('AI image added', 'ok');
    } catch (err) {
      const message = err instanceof AiError ? err.message : (err as Error).message;
      status.textContent = message;
      toast('AI request failed', 'err', 3600);
    } finally {
      go.disabled = false;
      if (editBtn) editBtn.disabled = false;
      controller = null;
    }
  };

  const go = button('Generate', { icon: 'sparkle', variant: 'primary', onClick: () => void run(false) });
  const editBtn = opts.reference
    ? button('Use canvas as reference', { icon: 'wand', onClick: () => void run(true) })
    : null;

  return section(title,
    h('p.hint', null, `Connected to ${provider.label} · ${provider.model}`),
    promptBox,
    styleSel,
    h('div.row', null, go),
    editBtn ? h('div.row', null, editBtn) : null,
    status,
  );
}

/** Most image APIs only accept a handful of sizes; snap to the nearest sane one. */
function snapSize(n: number): number {
  const allowed = [256, 512, 768, 1024, 1280, 1536, 1792];
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best), 1024);
}
