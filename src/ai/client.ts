/**
 * Bring-your-own-key AI bridge.
 *
 * Mosaic Studio never ships a key and never proxies through our servers.
 * Until the user saves a provider in Setup, every AI affordance stays dormant
 * and the rest of the app works completely offline.
 */

import { settings, saveSettings, type AiProviderConfig } from '../core/storage';

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  imagePath: string;
  model: string;
  flavor: 'openai' | 'custom';
  hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI Images',
    baseUrl: 'https://api.openai.com/v1',
    imagePath: '/images/generations',
    model: 'gpt-image-1',
    flavor: 'openai',
    hint: 'Works with api.openai.com keys (sk-…). Billed to your own account.',
  },
  {
    id: 'compatible',
    label: 'OpenAI-compatible endpoint',
    baseUrl: 'https://your-gateway.example.com/v1',
    imagePath: '/images/generations',
    model: 'your-model-name',
    flavor: 'openai',
    hint: 'Any gateway that mirrors the /images/generations contract — self-hosted, Azure, OpenRouter-style proxies.',
  },
  {
    id: 'custom',
    label: 'Custom JSON endpoint',
    baseUrl: 'https://your-api.example.com',
    imagePath: '/generate',
    model: 'default',
    flavor: 'custom',
    hint: 'Posts { prompt, model, width, height } and accepts a base64 or URL image in the response.',
  },
];

export function providers(): AiProviderConfig[] {
  return settings().ai;
}

export function activeProvider(): AiProviderConfig | null {
  const s = settings();
  if (!s.activeAi) return s.ai.find((p) => p.enabled && p.key) ?? null;
  return s.ai.find((p) => p.id === s.activeAi && p.enabled && p.key) ?? null;
}

export function aiReady(): boolean {
  return activeProvider() !== null;
}

export function upsertProvider(cfg: AiProviderConfig): void {
  const list = [...providers()];
  const idx = list.findIndex((p) => p.id === cfg.id);
  if (idx >= 0) list[idx] = cfg;
  else list.push(cfg);
  saveSettings({ ai: list, activeAi: cfg.enabled ? cfg.id : settings().activeAi });
}

export function removeProvider(id: string): void {
  const list = providers().filter((p) => p.id !== id);
  const active = settings().activeAi === id ? (list[0]?.id ?? null) : settings().activeAi;
  saveSettings({ ai: list, activeAi: active });
}

export interface GenerateOptions {
  prompt: string;
  width?: number;
  height?: number;
  /** Reference image for edit/variation style calls. */
  image?: Blob;
  /** Optional mask: transparent pixels mark the area to regenerate. */
  mask?: Blob;
  signal?: AbortSignal;
}

export class AiError extends Error {}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Best-effort extraction of an image from varied provider responses. */
async function parseImage(payload: unknown): Promise<Blob> {
  const seen = new Set<unknown>();
  const find = (node: unknown, depth = 0): string | null => {
    if (!node || depth > 6 || seen.has(node)) return null;
    if (typeof node === 'string') {
      if (/^data:image\//.test(node)) return node;
      if (/^https?:\/\//.test(node) && /\.(png|jpe?g|webp)(\?|$)/i.test(node)) return node;
      if (node.length > 512 && /^[A-Za-z0-9+/=\s]+$/.test(node)) return `data:image/png;base64,${node.replace(/\s/g, '')}`;
      return null;
    }
    if (typeof node !== 'object') return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = find(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const obj = node as Record<string, unknown>;
    for (const key of ['b64_json', 'base64', 'image', 'url', 'image_url', 'data', 'output', 'artifacts', 'images']) {
      if (key in obj) {
        const hit = find(obj[key], depth + 1);
        if (hit) return hit;
      }
    }
    for (const value of Object.values(obj)) {
      const hit = find(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  const found = find(payload);
  if (!found) throw new AiError('The provider replied, but no image was found in the response.');
  const res = await fetch(found);
  if (!res.ok) throw new AiError('The generated image could not be downloaded.');
  return res.blob();
}

/** Generate (or edit, when `image` is supplied) an image with the active provider. */
export async function generateImage(opts: GenerateOptions): Promise<Blob> {
  const provider = activeProvider();
  if (!provider) throw new AiError('No AI provider is connected. Add one in Setup → AI assist.');

  const width = opts.width ?? 1024;
  const height = opts.height ?? 1024;
  const headers: Record<string, string> = { Authorization: `Bearer ${provider.key}` };

  let url = joinUrl(provider.baseUrl, provider.imagePath);
  let body: BodyInit;

  if (opts.image && provider.flavor === 'openai') {
    url = joinUrl(provider.baseUrl, provider.imagePath.replace(/generations$/, 'edits'));
    const form = new FormData();
    form.set('model', provider.model);
    form.set('prompt', opts.prompt);
    form.set('image', opts.image, 'image.png');
    if (opts.mask) form.set('mask', opts.mask, 'mask.png');
    form.set('size', `${width}x${height}`);
    body = form;
  } else {
    headers['Content-Type'] = 'application/json';
    const json: Record<string, unknown> =
      provider.flavor === 'openai'
        ? { model: provider.model, prompt: opts.prompt, n: 1, size: `${width}x${height}` }
        : { model: provider.model, prompt: opts.prompt, width, height };
    if (opts.image && provider.flavor === 'custom') {
      json.image = await blobToDataUrl(opts.image);
      if (opts.mask) json.mask = await blobToDataUrl(opts.mask);
    }
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: opts.signal });
  } catch (err) {
    throw new AiError(
      `Could not reach ${new URL(url).host}. Check the base URL, your connection, and that the provider allows browser (CORS) requests.`,
      { cause: err },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch { /* keep raw text */ }
    throw new AiError(`${provider.label} returned ${res.status}. ${detail}`.trim());
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.startsWith('image/')) return res.blob();
  return parseImage(await res.json());
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(blob);
  });
}
