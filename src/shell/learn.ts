import { h, button, icon } from '../core/dom';
import { beginScreen, pageBody } from './shell';
import { navigate } from '../core/router';
import { TOOLS } from '../tools/registry';

interface Tip { n: string; title: string; body: string; }

const TIPS: Tip[] = [
  { n: '01', title: 'Work non-destructively', body: 'In the Photo lab nothing is baked in until you export. Sliders, curves and crops are instructions stored next to your picture, so you can always dial them back to zero.' },
  { n: '02', title: 'Layers are the real superpower', body: 'In Paint, keep sketch, colour and highlights on separate layers. Lower a layer\'s opacity or switch its blend mode and the whole piece changes without redrawing anything.' },
  { n: '03', title: 'Mask instead of erasing', body: 'The cutout tool builds a mask. Painting it black hides pixels, white brings them back. Nothing is destroyed, so a wrong move is one brush stroke away from fixed.' },
  { n: '04', title: 'Change one thing at a time', body: 'When an edit stops feeling right, undo back to the last good state rather than stacking corrections. Every tool here has deep undo on ⌘/Ctrl + Z.' },
  { n: '05', title: 'Export bigger than you need', body: 'Set an export scale above 100% for print, below for social. Mosaic re-renders at full quality on export instead of upscaling the preview.' },
  { n: '06', title: 'Your files stay yours', body: 'Photos, clips and PDFs are opened straight from your device and never uploaded. The only moment anything leaves is if you deliberately connect your own AI provider in Setup.' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['⌘/Ctrl + Z', 'Undo'],
  ['⌘/Ctrl + Shift + Z', 'Redo'],
  ['⌘/Ctrl + S', 'Save project'],
  ['⌘/Ctrl + E', 'Export / download'],
  ['[ and ]', 'Brush size down / up'],
  ['Space + drag', 'Pan the canvas'],
];

export function renderLearn(): void {
  const ctx = beginScreen({ layout: 'page' });
  ctx.setTitle('Tips', 'A gentle start');
  ctx.setActions();
  const page = pageBody(ctx);

  page.appendChild(
    h('div.callout', null, icon('bulb'),
      h('div', null,
        h('strong', null, 'You can learn as you make'),
        h('p', null, 'Each tool opens with sensible defaults. Nothing here can break your original files — they are copied into the browser, never overwritten.'),
      ),
    ),
  );

  page.appendChild(h('div.section-head', null, h('h2', null, 'Six habits that help')));
  for (const t of TIPS) {
    page.appendChild(h('article.tip-card', null, h('span.n', null, t.n), h('div', null, h('strong', null, t.title), h('p', null, t.body))));
  }

  page.appendChild(h('div.section-head', null, h('h2', null, 'Keyboard shortcuts')));
  const list = h('div', { style: { display: 'grid', gap: '7px' } });
  for (const [key, what] of SHORTCUTS) {
    list.appendChild(h('div.row', { style: { justifyContent: 'space-between' } },
      h('span.kbd', null, key), h('span.hint', null, what)));
  }
  page.appendChild(h('section.panel', null, h('div.panel-body', { style: { paddingTop: '13px' } }, list)));

  page.appendChild(h('div.section-head', null, h('h2', null, 'Jump into a tool')));
  const grid = h('div.tool-grid');
  for (const t of TOOLS) {
    const card = h('button.tool-card', { type: 'button' },
      h('span', { class: `tool-icon ${t.color}` }, icon(t.icon)),
      h('strong', null, t.name), h('small', null, t.desc));
    card.addEventListener('click', () => navigate(t.path));
    grid.appendChild(card);
  }
  page.appendChild(grid);

  page.appendChild(button('Back to home', { icon: 'home', onClick: () => navigate('/') }));
}
