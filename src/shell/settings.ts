import { h, button, section, fieldRow, textInput, selectInput, segmented } from '../core/dom';
import { beginScreen, pageBody, applyTheme } from './shell';
import { settings, saveSettings, estimateUsage, formatBytes, projects as projectStore, type AiProviderConfig } from '../core/storage';
import { PROVIDER_PRESETS, providers, upsertProvider, removeProvider, generateImage, AiError } from '../ai/client';
import { toast, confirmDialog, modal } from '../core/ui';
import { download } from '../core/image';

export async function renderSettings(): Promise<void> {
  const ctx = beginScreen({ layout: 'page' });
  ctx.setTitle('Setup', 'Preferences & AI');
  ctx.setActions();
  const page = pageBody(ctx);

  page.appendChild(h('div.section-head', null, h('h2', null, 'Appearance')));
  const themeSeg = segmented(
    [{ value: 'dark', label: 'Dark studio' }, { value: 'light', label: 'Light paper' }],
    settings().theme,
    (v) => { saveSettings({ theme: v as 'dark' | 'light' }); applyTheme(); },
  );
  page.appendChild(section('Theme',
    h('p.hint', null, 'A dark workspace keeps your eye honest about colour; light mode matches the original Mosaic look.'),
    themeSeg.root,
  ));

  page.appendChild(section('Export defaults',
    fieldRow('Format', selectInput(
      [{ value: 'png', label: 'PNG (lossless, transparency)' },
       { value: 'jpeg', label: 'JPEG (small, photos)' },
       { value: 'webp', label: 'WebP (small, modern)' }],
      settings().exportFormat,
      (v) => saveSettings({ exportFormat: v as 'png' | 'jpeg' | 'webp' }),
    )),
    fieldRow('Quality', (() => {
      const input = h('input', {
        type: 'range', class: 'slider-input', min: '0.5', max: '1', step: '0.01',
        value: String(settings().exportQuality),
      }) as HTMLInputElement;
      input.addEventListener('change', () => saveSettings({ exportQuality: Number(input.value) }));
      return input;
    })()),
    h('p.hint', null, 'Applies to JPEG and WebP. PNG is always lossless.'),
  ));

  /* ---------------- AI providers ---------------- */

  page.appendChild(h('div.section-head', null, h('h2', null, 'AI assist')));
  page.appendChild(
    h('div.callout', null,
      h('div', null,
        h('strong', null, 'Bring your own key'),
        h('p', null,
          'Mosaic Studio is a static app with no server of its own. To keep that promise, AI features call your provider directly from this browser using a key you paste here. ',
          'The key is stored only in this browser\'s local storage and is never sent anywhere except the provider you name.'),
      ),
    ),
  );

  const providerHost = h('div', { style: { display: 'grid', gap: '10px' } });
  page.appendChild(providerHost);

  function renderProviders() {
    providerHost.replaceChildren();
    const list = providers();
    if (!list.length) {
      providerHost.appendChild(
        h('div.empty-state', null,
          h('strong', null, 'No provider connected'),
          h('p', null, 'Add an OpenAI-compatible image endpoint to switch on prompt-to-image inside Photo, Paint and Design.'),
          button('Add provider', { icon: 'plus', variant: 'primary', onClick: () => editProvider(null, renderProviders) }),
        ),
      );
      return;
    }
    for (const p of list) {
      const active = settings().activeAi === p.id || (!settings().activeAi && p.enabled);
      providerHost.appendChild(
        section(p.label,
          h('div.row', null,
            h('span', { class: `badge ${p.enabled && p.key ? 'on' : 'off'}` }, p.enabled && p.key ? 'Ready' : 'Disabled'),
            active ? h('span.badge.on', null, 'Active') : null,
          ),
          h('p.hint.mono', null, `${p.baseUrl}${p.imagePath} · ${p.model}`),
          h('p.hint', null, `Key: ${p.key ? `${p.key.slice(0, 5)}…${p.key.slice(-4)}` : 'not set'}`),
          h('div.row', null,
            button('Edit', { icon: 'settings', onClick: () => editProvider(p, renderProviders) }),
            button('Test', { icon: 'check', onClick: () => void testProvider(p) }),
            !active ? button('Make active', { onClick: () => { saveSettings({ activeAi: p.id }); renderProviders(); } }) : null,
            button('Remove', { variant: 'danger', icon: 'trash', onClick: async () => {
              if (await confirmDialog('Remove provider', `Remove ${p.label} and its stored key from this browser?`, 'Remove')) {
                removeProvider(p.id);
                renderProviders();
                toast('Provider removed');
              }
            } }),
          ),
        ),
      );
    }
    providerHost.appendChild(button('Add another provider', { icon: 'plus', onClick: () => editProvider(null, renderProviders) }));
  }
  renderProviders();

  /* ---------------- Storage ---------------- */

  page.appendChild(h('div.section-head', null, h('h2', null, 'Storage')));
  const usage = await estimateUsage();
  const all = await projectStore.all();
  page.appendChild(section('On this device',
    h('p.hint', null, `${all.length} saved project${all.length === 1 ? '' : 's'}.`),
    usage ? h('p.hint', null, `Using ${formatBytes(usage.usage)} of roughly ${formatBytes(usage.quota)} available.`) : null,
    usage && usage.quota
      ? h('div.progress', null, h('i', { style: { width: `${Math.min(100, (usage.usage / usage.quota) * 100)}%` } }))
      : null,
    h('div.row', null,
      button('Export all projects', { icon: 'download', onClick: () => void exportAll() }),
      button('Delete all projects', { variant: 'danger', icon: 'trash', onClick: async () => {
        if (await confirmDialog('Delete everything', 'This permanently removes every saved project from this browser. Downloads you already made are unaffected.', 'Delete all')) {
          await projectStore.clear();
          toast('All projects deleted', 'ok');
          void renderSettings();
        }
      } }),
    ),
  ));

  page.appendChild(h('p.hint.center', null, 'Mosaic Studio v2.0 · offline-first · your files never leave the device unless you choose an AI provider.'));
}

function editProvider(existing: AiProviderConfig | null, done: () => void): void {
  let preset = PROVIDER_PRESETS.find((p) => p.id === (existing?.id ?? 'openai')) ?? PROVIDER_PRESETS[0]!;
  const draft: AiProviderConfig = existing
    ? { ...existing }
    : { id: preset.id, label: preset.label, baseUrl: preset.baseUrl, imagePath: preset.imagePath, model: preset.model, key: '', flavor: preset.flavor, enabled: true };

  modal(existing ? 'Edit provider' : 'Add AI provider', (m) => {
    const hint = h('p.hint', null, preset.hint);
    const labelIn = textInput(draft.label, (v) => { draft.label = v; });
    const baseIn = textInput(draft.baseUrl, (v) => { draft.baseUrl = v.trim(); });
    const pathIn = textInput(draft.imagePath, (v) => { draft.imagePath = v.trim(); });
    const modelIn = textInput(draft.model, (v) => { draft.model = v.trim(); });
    const keyIn = h('input', { class: 'text-input', type: 'password', value: draft.key, placeholder: 'sk-…' }) as HTMLInputElement;
    keyIn.addEventListener('input', () => { draft.key = keyIn.value.trim(); });

    if (!existing) {
      m.body.appendChild(fieldRow('Preset', selectInput(
        PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label })),
        preset.id,
        (v) => {
          preset = PROVIDER_PRESETS.find((p) => p.id === v)!;
          draft.id = preset.id === 'custom' || preset.id === 'compatible' ? `${preset.id}-${Date.now().toString(36).slice(-4)}` : preset.id;
          draft.label = preset.label;
          draft.baseUrl = preset.baseUrl;
          draft.imagePath = preset.imagePath;
          draft.model = preset.model;
          draft.flavor = preset.flavor;
          labelIn.value = preset.label;
          baseIn.value = preset.baseUrl;
          pathIn.value = preset.imagePath;
          modelIn.value = preset.model;
          hint.textContent = preset.hint;
        },
      )));
    }
    m.body.appendChild(hint);
    m.body.appendChild(fieldRow('Name', labelIn));
    m.body.appendChild(fieldRow('Base URL', baseIn));
    m.body.appendChild(fieldRow('Path', pathIn));
    m.body.appendChild(fieldRow('Model', modelIn));
    m.body.appendChild(fieldRow('API key', keyIn));
    m.body.appendChild(h('p.hint', null,
      'Browser-based calls need the provider to allow cross-origin requests. If a provider blocks CORS, point this at your own small proxy instead.'));

    m.footer.appendChild(button('Cancel', { onClick: () => m.close() }));
    m.footer.appendChild(button('Save provider', { variant: 'primary', onClick: () => {
      if (!draft.baseUrl || !draft.key) { toast('A base URL and key are required', 'err'); return; }
      draft.enabled = true;
      upsertProvider(draft);
      m.close();
      done();
      toast('Provider saved — AI assist is live', 'ok');
    } }));
  }, { width: 520 });
}

async function testProvider(p: AiProviderConfig): Promise<void> {
  const prev = settings().activeAi;
  saveSettings({ activeAi: p.id });
  const t = modal('Testing provider', (m) => {
    m.body.appendChild(h('p', null, `Asking ${p.label} for a tiny test image…`));
  }, { width: 420 });
  try {
    await generateImage({ prompt: 'a single small green leaf on a white background, minimal', width: 256, height: 256 });
    toast('Provider works', 'ok');
  } catch (err) {
    const msg = err instanceof AiError ? err.message : (err as Error).message;
    toast(msg, 'err', 5000);
  } finally {
    t.close();
    saveSettings({ activeAi: prev });
  }
}

async function exportAll(): Promise<void> {
  const all = await projectStore.all();
  if (!all.length) { toast('Nothing saved yet', 'err'); return; }
  const payload = all.map((p) => ({ id: p.id, tool: p.tool, title: p.title, updated: p.updated, created: p.created, note: p.note, data: p.data }));
  const blob = new Blob([JSON.stringify({ app: 'mosaic-studio', version: 2, projects: payload }, null, 2)], { type: 'application/json' });
  download(blob, 'mosaic-projects.json');
  toast('Project index downloaded', 'ok');
}
