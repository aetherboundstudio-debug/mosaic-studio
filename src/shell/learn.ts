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

interface Guide { id: string; steps: string[]; }

/** Plain-language "what do I actually click" walkthrough for each tool. */
const GUIDES: Guide[] = [
  { id: 'photo', steps: [
    'Press Open and choose a picture from your device.',
    'Drag the sliders — Exposure makes it brighter, Contrast makes it punchier, Warmth makes it more orange or more blue.',
    'Not sure? Tap a Look along the top for a one-press style, then fine-tune from there.',
    'Press and hold the compare button any time to see the untouched original.',
    'Happy with it? Press Export to save the new picture to your device.',
  ] },
  { id: 'draw', steps: [
    'Pick a brush, a size and a colour, then draw straight onto the canvas.',
    'Use layers like sheets of tracing paper: sketch on one, colour on another. You can hide or redraw one without harming the rest.',
    'Got it wrong? Ctrl + Z (or Cmd + Z on a Mac) steps backwards as many times as you need.',
    'Export gives you a PNG. Turn the background layer off first if you want it see-through.',
  ] },
  { id: 'design', steps: [
    'Start from a template, or pick the size you need — Instagram post, A4, YouTube thumbnail and so on.',
    'Add text and shapes, then drag them around. They snap into line with each other automatically.',
    'Click anything to change its colour, font or size in the panel on the side.',
    'Export as a picture to post online, or as a PDF if it is going to a printer.',
  ] },
  { id: 'motion', steps: [
    'Type your words, then choose an animation and how it should move.',
    'Press play to preview it, or drag along the timeline to scrub through by hand.',
    'Export as WebM for a real video file, or as a GIF for a short looping clip.',
  ] },
  { id: 'video', steps: [
    'Open a video clip from your device.',
    'Drag the two handles under the filmstrip to mark where the clip should start and end.',
    'Optionally change the colours, the speed, or mute the sound.',
    'Export writes a genuinely new, shorter file — it is not just hiding the ends.',
  ] },
  { id: 'pdf', steps: [
    'Open one PDF, or several at once if you want to join them together.',
    'Every page appears as a thumbnail. Drag them to reorder, or use the buttons to rotate and delete.',
    'Export the whole thing as one PDF, or tick a few pages and export only those.',
  ] },
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

  page.appendChild(h('div.section-head', null,
    h('h2', null, 'How each tool works'),
    h('span.hint', null, 'No jargon'),
  ));
  for (const guide of GUIDES) {
    const tool = TOOLS.find((t) => t.id === guide.id);
    if (!tool) continue;
    const steps = h('ol.guide-steps');
    for (const step of guide.steps) steps.appendChild(h('li', null, step));

    const open = button(`Open ${tool.name}`, { icon: tool.icon, onClick: () => navigate(tool.path) });
    page.appendChild(
      h('section.panel.guide-card', null,
        h('div.guide-head', null,
          h('span', { class: `tool-icon ${tool.color}` }, icon(tool.icon)),
          h('div', null, h('strong', null, tool.name), h('small', null, tool.desc)),
        ),
        h('div.panel-body', null, steps, open),
      ),
    );
  }

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
