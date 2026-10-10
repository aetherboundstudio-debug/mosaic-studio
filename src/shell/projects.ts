import { h, button, icon, segmented } from '../core/dom';
import { beginScreen, pageBody } from './shell';
import { projects as projectStore, type ProjectRecord } from '../core/storage';
import { TOOLS } from '../tools/registry';
import { navigate } from '../core/router';
import { confirmDialog, toast } from '../core/ui';
import { download } from '../core/image';
import { openPicker } from './home';

let filter: string = 'all';

export async function renderProjects(): Promise<void> {
  const ctx = beginScreen({ layout: 'page' });
  ctx.setTitle('Projects', 'Saved on this device');
  ctx.setActions(button('New', { icon: 'plus', variant: 'primary', onClick: () => openPicker() }));
  const page = pageBody(ctx);

  const all = await projectStore.all();

  page.appendChild(segmented(
    [{ value: 'all', label: `All (${all.length})` }, ...TOOLS.map((t) => ({ value: t.id, label: t.name.split(' ')[0]! }))],
    filter,
    (v) => { filter = v; void renderProjects(); },
  ).root);

  const list = all.filter((p) => filter === 'all' || p.tool === filter);

  if (!list.length) {
    page.appendChild(
      h('div.empty-state', null,
        h('strong', null, all.length ? 'Nothing here yet' : 'No saved projects'),
        h('p', null, 'Projects save the whole document — layers, adjustments, text and all — so you can reopen and keep editing.'),
        button('Start something', { variant: 'primary', onClick: () => openPicker() }),
      ),
    );
    return;
  }

  const grid = h('div.project-list');
  for (const p of list) grid.appendChild(card(p));
  page.appendChild(grid);
}

function card(p: ProjectRecord): HTMLElement {
  const meta = TOOLS.find((t) => t.id === p.tool);
  const thumb = h('span.project-thumb');
  if (p.thumb) {
    const img = h('img', { alt: '' }) as HTMLImageElement;
    img.src = URL.createObjectURL(p.thumb);
    thumb.appendChild(img);
  } else thumb.appendChild(icon(meta?.icon ?? 'sparkle'));

  const open = () => navigate(`${meta?.path ?? '/'}?project=${p.id}`);

  const row = h('div.project-row', null,
    thumb,
    h('button', {
      type: 'button',
      style: { flex: '1', minWidth: '0', textAlign: 'left', background: 'none' },
      onclick: open,
    },
      h('strong', null, p.title),
      h('small', null, `${meta?.name ?? p.tool} · updated ${new Date(p.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
    ),
    h('div.row', { style: { flexWrap: 'nowrap' } },
      p.thumb
        ? button('', { icon: 'download', title: 'Download preview', onClick: () => download(p.thumb!, `${p.title.replace(/\s+/g, '-').toLowerCase()}-preview.jpg`) })
        : null,
      button('', { icon: 'trash', variant: 'danger', title: 'Delete project', onClick: async () => {
        if (await confirmDialog('Delete project', `Delete “${p.title}”? This cannot be undone.`, 'Delete')) {
          await projectStore.remove(p.id);
          toast('Project deleted');
          void renderProjects();
        }
      } }),
    ),
  );
  return row;
}
