import { h, icon, button } from '../core/dom';
import { beginScreen, pageBody } from './shell';
import { TOOLS } from '../tools/registry';
import { projects as projectStore, type ProjectRecord, settings } from '../core/storage';
import { navigate } from '../core/router';
import { aiReady } from '../ai/client';
import { modal } from '../core/ui';

export async function renderHome(): Promise<void> {
  const ctx = beginScreen({ layout: 'page' });
  ctx.setTitle('Mosaic Studio', 'Creative suite');
  ctx.setActions(button('Settings', { icon: 'settings', variant: 'ghost', onClick: () => navigate('/settings') }));
  const page = pageBody(ctx);

  page.appendChild(
    h('section.hero', null,
      h('span.eyebrow', null, 'Your creative space'),
      h('h1', null, 'Make something worth keeping.'),
      h('p', null, 'Six deep tools for photos, painting, design, motion, video and PDF — all running privately on your device.'),
      h('div.row', null,
        button('Start creating', { icon: 'plus', variant: 'primary', onClick: () => openPicker() }),
        button('How it works', { icon: 'bulb', onClick: () => navigate('/learn') }),
      ),
    ),
  );

  page.appendChild(h('div.section-head', null, h('h2', null, 'Pick a tool')));
  const grid = h('section.tool-grid');
  for (const t of TOOLS) {
    const card = h('button.tool-card', { type: 'button' },
      h('span', { class: `tool-icon ${t.color}` }, icon(t.icon)),
      h('strong', null, t.name),
      h('small', null, t.desc),
      h('div.badge-row', null, ...t.features.map((f) => h('span.chip', null, f))),
    );
    card.addEventListener('click', () => navigate(t.path));
    grid.appendChild(card);
  }
  page.appendChild(grid);

  // AI status callout
  const ready = aiReady();
  page.appendChild(
    h('div.callout', null,
      icon('sparkle'),
      h('div', null,
        h('strong', null, ready ? 'AI assist is connected' : 'AI assist is ready to connect'),
        h('p', null, ready
          ? 'Generate and expand images straight into Photo, Paint and Design from your own provider key.'
          : 'Mosaic works fully offline. Add your own image-model API key in Setup to unlock prompt-to-image inside the tools — nothing is sent anywhere until you do.'),
        h('div.row', { style: { marginTop: '9px' } },
          button(ready ? 'Manage providers' : 'Connect a provider', { icon: 'key', onClick: () => navigate('/settings') })),
      ),
    ),
  );

  // Recent work
  const recent = (await projectStore.all()).slice(0, 4);
  page.appendChild(
    h('div.section-head', null,
      h('h2', null, 'Recent work'),
      recent.length ? button('View all', { variant: 'ghost', onClick: () => navigate('/projects') }) : null,
    ),
  );
  if (!recent.length) {
    page.appendChild(
      h('div.empty-state', null,
        h('strong', null, 'Your first project starts here'),
        h('p', null, 'Open any tool and press Save. Projects are stored in this browser with a real preview, so you can pick up where you left off.'),
        button('Choose a tool', { variant: 'primary', onClick: () => openPicker() }),
      ),
    );
  } else {
    const list = h('div.project-list');
    for (const p of recent) list.appendChild(projectRow(p));
    page.appendChild(list);
  }

  page.appendChild(
    h('p.hint.center', null,
      `Everything runs locally in your browser. ${settings().theme === 'dark' ? 'Dark' : 'Light'} theme · v2.0`),
  );
}

export function projectRow(p: ProjectRecord): HTMLElement {
  const meta = TOOLS.find((t) => t.id === p.tool);
  const thumb = h('span.project-thumb');
  if (p.thumb) {
    const img = h('img', { alt: '' }) as HTMLImageElement;
    img.src = URL.createObjectURL(p.thumb);
    img.onload = () => setTimeout(() => URL.revokeObjectURL(img.src), 1000);
    thumb.appendChild(img);
  } else {
    thumb.appendChild(icon(meta?.icon ?? 'sparkle'));
  }
  const row = h('button.project-row', { type: 'button' },
    thumb,
    h('span', { style: { flex: '1', minWidth: '0' } },
      h('strong', null, p.title),
      h('small', null, `${meta?.name ?? p.tool} · ${new Date(p.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`),
    ),
  );
  row.addEventListener('click', () => navigate(`${meta?.path ?? '/'}?project=${p.id}`));
  return row;
}

export function openPicker(): void {
  modal('What would you like to make?', (m) => {
    m.body.appendChild(h('p', null, 'Pick a starting point — you can move work between tools later.'));
    const grid = h('div.tool-grid');
    for (const t of TOOLS) {
      const card = h('button.tool-card', { type: 'button' },
        h('span', { class: `tool-icon ${t.color}` }, icon(t.icon)),
        h('strong', null, t.name),
        h('small', null, t.desc));
      card.addEventListener('click', () => { m.close(); navigate(t.path); });
      grid.appendChild(card);
    }
    m.body.appendChild(grid);
  }, { width: 620 });
}
