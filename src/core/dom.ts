/** Tiny DOM helpers — enough structure to build a studio UI without a framework. */

type Child = Node | string | number | null | undefined | false;

export type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
};

/** Create an element: h('div.card', { onclick }, 'text') */
export function h<K extends keyof HTMLElementTagNameMap>(
  selector: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K];
export function h(selector: string, attrs?: Attrs | null, ...children: Child[]): HTMLElement;
export function h(selector: string, attrs?: Attrs | null, ...children: Child[]): HTMLElement {
  const parts = String(selector).split(/(?=[.#])/);
  const tag = parts[0] && !/^[.#]/.test(parts[0]) ? parts[0] : 'div';
  const el = document.createElement(tag);

  for (const p of parts) {
    if (p.startsWith('.')) el.classList.add(p.slice(1));
    else if (p.startsWith('#')) el.id = p.slice(1);
  }

  if (attrs) {
    for (const [key, raw] of Object.entries(attrs)) {
      if (raw === null || raw === undefined || raw === false) continue;
      if (key === 'class') {
        for (const c of String(raw).split(/\s+/).filter(Boolean)) el.classList.add(c);
      } else if (key === 'style') {
        if (typeof raw === 'string') el.setAttribute('style', raw);
        else Object.assign(el.style, raw);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, raw as Record<string, string>);
      } else if (key === 'html') {
        el.innerHTML = String(raw);
      } else if (key.startsWith('on') && typeof raw === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), raw as EventListener);
      } else if (raw === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(raw));
      }
    }
  }

  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function on<K extends keyof HTMLElementEventMap>(
  el: EventTarget,
  type: K | string,
  handler: (ev: never) => void,
  opts?: AddEventListenerOptions,
): () => void {
  el.addEventListener(type, handler as EventListener, opts);
  return () => el.removeEventListener(type, handler as EventListener, opts);
}

/** SVG icon set used across the shell and tool bars. */
const ICONS: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  folder: '<path d="M3 6.5h7l2 2H21v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 9h18"/>',
  bulb: '<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.8.6-1.2 1.5-1.3 2.5h-4.4c-.1-1-.5-1.9-1.3-2.5Z"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 3-2.5 4 3.5"/>',
  brush: '<path d="M15 4.5 19.5 9 11 17.5l-4.5-4.5z"/><path d="M6.5 13 4 20l7-2.5"/><path d="m15 4.5 2-2a2.1 2.1 0 0 1 3 3l-2 2"/>',
  design: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>',
  motion: '<path d="M4 12h4l2.5-6 3 13 2.5-7h4"/>',
  video: '<rect x="2.5" y="5.5" width="13" height="13" rx="3"/><path d="m16.5 10 5-3v10l-5-3z"/>',
  pdf: '<path d="M6 2.5h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-18a1 1 0 0 1 1-1z"/><path d="M14 2.5v5h5"/><path d="M8.5 17v-4.5h1.3a1.3 1.3 0 0 1 0 2.6H8.5M13.5 17v-4.5"/>',
  sparkle: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/><path d="M18.5 3v3M20 4.5h-3"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/>',
  undo: '<path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="m8 5-4 4 4 4"/>',
  redo: '<path d="M20 9H9a5 5 0 0 0 0 10h6"/><path d="m16 5 4 4-4 4"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  save: '<path d="M5 3.5h10.5L20.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M8 3.5v5h7M7.5 20v-6h9v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3.5 12.5 8.5 4.7 8.5-4.7"/><path d="m3.5 16.8 8.5 4.7 8.5-4.7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.9A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.4 4.2M6.3 7.8A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 3.4-.6"/>',
  crop: '<path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/>',
  wand: '<path d="m5 19 9-9"/><path d="m13 5 1 2.5L16.5 8.5 14 9.5 13 12l-1-2.5L9.5 8.5 12 7.5z"/><path d="M19 13.5 19.8 15l1.7.8-1.7.8-.8 1.7-.8-1.7L16.5 16l1.7-.8z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  play: '<path d="m7 4.5 12 7.5-12 7.5z"/>',
  pause: '<path d="M8 4.5v15M16 4.5v15"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  text: '<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15M9 19.5h6"/>',
  shape: '<circle cx="9" cy="9" r="5"/><rect x="10.5" y="10.5" width="9.5" height="9.5" rx="2"/>',
  eraser: '<path d="m14 4.5 5.5 5.5-8 8H6.5L3.5 15z"/><path d="M21 20.5H9.5"/>',
  bucket: '<path d="m9 3.5 9 9-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-5.4-5.4a1.5 1.5 0 0 1 0-2.1z"/><path d="M6 6.5 9 3.5"/><path d="M20 15.5c0 1.2-.9 2-2 2s-2-.8-2-2 2-3.5 2-3.5 2 2.3 2 3.5z"/>',
  dropper: '<path d="m13 7 4 4"/><path d="m5.5 18.5 9-9 1.5 1.5-9 9-2.5 1z"/><path d="m15 5.5 1.8-1.8a2.1 2.1 0 0 1 3 3L18 8.5z"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m8.5 6.5 3.5-3.5 3.5 3.5M8.5 17.5l3.5 3.5 3.5-3.5M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5"/>',
  rotate: '<path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1"/><path d="M3.5 19v-5h5"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M20 6 8 16.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 5.5h-9a3 3 0 0 0-3 3v9"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  key: '<circle cx="8" cy="12" r="4.5"/><path d="M12.5 12H21v3.5M17 12v3"/>',
  merge: '<path d="M4 4h7v7H4z"/><path d="M13 13h7v7h-7z"/><path d="M11 7.5h4.5a1.5 1.5 0 0 1 1.5 1.5v4"/>',
  frame: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 8.5h17M3.5 15.5h17M8.5 3.5v17M15.5 3.5v17"/>',
  align: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  adjust: '<path d="M5 20v-7M5 9V4M12 20v-10M12 6V4M19 20v-4M19 12V4"/><circle cx="5" cy="11" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="19" cy="14" r="2"/>',
};

export function icon(name: keyof typeof ICONS | string, cls = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ui-icon ${cls}`.trim());
  svg.innerHTML = ICONS[name] ?? ICONS.sparkle!;
  return svg;
}

/** Button with optional icon + label. */
export function button(
  label: string,
  opts: { icon?: string; variant?: string; onClick?: () => void; title?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const btn = h('button', {
    class: `btn ${opts.variant ? `btn-${opts.variant}` : ''}`.trim(),
    type: 'button',
    title: opts.title ?? label,
    'aria-label': label,
  });
  if (opts.icon) btn.appendChild(icon(opts.icon));
  if (label) btn.appendChild(h('span', null, label));
  if (opts.onClick) btn.addEventListener('click', opts.onClick);
  if (opts.disabled) btn.disabled = true;
  return btn;
}

export function iconButton(name: string, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const btn = h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', title: label, 'aria-label': label });
  btn.appendChild(icon(name));
  btn.addEventListener('click', onClick);
  return btn;
}

/** A labelled slider that reports live values. */
export function slider(opts: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  onInput: (value: number) => void;
  onCommit?: () => void;
}): { root: HTMLElement; input: HTMLInputElement; set: (v: number) => void } {
  const out = h('output', { class: 'slider-value' }, formatVal(opts.value, opts.unit));
  const input = h('input', {
    type: 'range',
    class: 'slider-input',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step ?? 1),
    value: String(opts.value),
    'aria-label': opts.label,
  }) as HTMLInputElement;

  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = formatVal(v, opts.unit);
    opts.onInput(v);
  });
  if (opts.onCommit) {
    input.addEventListener('change', () => opts.onCommit!());
    input.addEventListener('pointerup', () => opts.onCommit!());
  }

  const labelEl = h('label', { class: 'slider-label' }, opts.label);
  labelEl.addEventListener('dblclick', () => {
    set(opts.value);
    opts.onInput(opts.value);
    opts.onCommit?.();
  });

  const root = h('div.slider-row', null, labelEl, input, out);

  function set(v: number) {
    input.value = String(v);
    out.textContent = formatVal(v, opts.unit);
  }

  return { root, input, set };
}

function formatVal(v: number, unit?: string): string {
  const rounded = Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v);
  return `${rounded}${unit ?? ''}`;
}

export function section(title: string, ...children: Child[]): HTMLElement {
  const body = h('div.panel-body', null, ...children);
  const head = h('button.panel-head', { type: 'button' }, h('span', null, title), h('span.panel-caret', null, '⌄'));
  const root = h('section.panel', null, head, body);
  head.addEventListener('click', () => root.classList.toggle('collapsed'));
  return root;
}

export function fieldRow(label: string, control: HTMLElement): HTMLElement {
  return h('div.field-row', null, h('label.field-label', null, label), control);
}

export function selectInput(
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = h('select', { class: 'select-input' }) as HTMLSelectElement;
  for (const o of options) sel.appendChild(h('option', { value: o.value }, o.label));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function textInput(value: string, onInput: (v: string) => void, placeholder = ''): HTMLInputElement {
  const input = h('input', { class: 'text-input', type: 'text', value, placeholder }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function colorInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = h('input', { class: 'color-input', type: 'color', value }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

/** Segmented control for mutually exclusive modes. */
export function segmented<T extends string>(
  items: Array<{ value: T; label?: string; icon?: string; title?: string }>,
  value: T,
  onChange: (v: T) => void,
): { root: HTMLElement; set: (v: T) => void } {
  const root = h('div.segmented');
  const buttons = new Map<T, HTMLButtonElement>();
  for (const item of items) {
    const btn = h('button', {
      class: 'seg-btn',
      type: 'button',
      title: item.title ?? item.label ?? item.value,
      'aria-label': item.title ?? item.label ?? item.value,
    }) as HTMLButtonElement;
    if (item.icon) btn.appendChild(icon(item.icon));
    if (item.label) btn.appendChild(h('span', null, item.label));
    btn.addEventListener('click', () => {
      set(item.value);
      onChange(item.value);
    });
    buttons.set(item.value, btn);
    root.appendChild(btn);
  }
  function set(v: T) {
    for (const [key, btn] of buttons) btn.classList.toggle('active', key === v);
  }
  set(value);
  return { root, set };
}

export function emptyState(title: string, body: string, action?: HTMLElement): HTMLElement {
  return h('div.empty-state', null, h('strong', null, title), h('p', null, body), action);
}
