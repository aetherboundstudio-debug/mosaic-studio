import { h, clear, icon, iconButton } from '../core/dom';
import { settings, saveSettings } from '../core/storage';
import { navigate, currentPath } from '../core/router';

export interface ToolContext {
  /** Main canvas surface area. */
  stage: HTMLElement;
  /** Contextual toolbar above the stage. */
  toolstrip: HTMLElement;
  /** Right-hand inspector (bottom sheet on phones). */
  inspector: HTMLElement;
  setTitle(title: string, sub?: string): void;
  setActions(...nodes: Array<HTMLElement | null>): void;
  openInspector(): void;
  onDestroy(fn: () => void): void;
  signal: AbortSignal;
}

interface ShellParts {
  root: HTMLElement;
  topbar: HTMLElement;
  titleBox: HTMLElement;
  actions: HTMLElement;
  main: HTMLElement;
  stageCol: HTMLElement;
  toolstrip: HTMLElement;
  stage: HTMLElement;
  inspector: HTMLElement;
  inspectorInner: HTMLElement;
  backdrop: HTMLElement;
  sheetToggle: HTMLElement;
  nav: HTMLElement;
}

let parts: ShellParts | null = null;
let destroyers: Array<() => void> = [];
let abort: AbortController | null = null;

export const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home', path: '/' },
  { id: 'projects', label: 'Projects', icon: 'folder', path: '/projects' },
  { id: 'learn', label: 'Tips', icon: 'bulb', path: '/learn' },
  { id: 'settings', label: 'Setup', icon: 'settings', path: '/settings' },
];

export function buildShell(): ShellParts {
  if (parts) return parts;
  const root = document.getElementById('root') as HTMLElement;
  clear(root);

  const brand = h('button.brand', {
    type: 'button',
    title: 'Mosaic Studio home',
    style: { background: 'none', padding: '0' },
    onclick: () => navigate('/'),
  },
    h('span.brandmark', null, h('i'), h('i'), h('i'), h('i')),
  );

  const titleBox = h('div', null);
  const actions = h('div.topbar-actions');
  const topbar = h('header.topbar', null, brand, titleBox, h('div.topbar-spacer'), actions);

  const toolstrip = h('div.toolstrip');
  const stage = h('div.stage');
  const stageCol = h('div.stage-col', null, toolstrip, stage);

  const inspectorInner = h('div.inspector-inner');
  const inspector = h('aside.inspector', { 'aria-label': 'Tool options' },
    h('div.sheet-grab'), inspectorInner);

  const backdrop = h('div.sheet-backdrop');
  const sheetToggle = h('button.sheet-toggle', { type: 'button' }, icon('adjust'), h('span', null, 'Options'));

  const nav = h('nav.bottom-nav', { 'aria-label': 'Main navigation' });

  const main = h('div.main-area', null, stageCol, inspector, backdrop, sheetToggle);

  const closeSheet = () => {
    inspector.classList.remove('open');
    backdrop.classList.remove('open');
  };
  const openSheet = () => {
    inspector.classList.add('as-sheet', 'open');
    backdrop.classList.add('open');
  };
  sheetToggle.addEventListener('click', () => {
    if (inspector.classList.contains('open')) closeSheet();
    else openSheet();
  });
  backdrop.addEventListener('click', closeSheet);

  root.appendChild(topbar);
  root.appendChild(main);
  root.appendChild(nav);

  parts = {
    root, topbar, titleBox, actions, main, stageCol, toolstrip, stage,
    inspector, inspectorInner, backdrop, sheetToggle, nav,
  };
  renderNav();
  return parts;
}

function renderNav(): void {
  if (!parts) return;
  clear(parts.nav);
  const path = currentPath();
  for (const item of NAV_ITEMS) {
    const active = path === item.path || (item.path !== '/' && path.startsWith(item.path));
    const btn = h('button', { class: `nav-item ${active ? 'active' : ''}`.trim(), type: 'button' },
      icon(item.icon), h('span', null, item.label));
    btn.addEventListener('click', () => navigate(item.path));
    parts.nav.appendChild(btn);
  }
}

function teardown(): void {
  for (const fn of destroyers.splice(0)) {
    try { fn(); } catch { /* ignore teardown errors */ }
  }
  abort?.abort();
  abort = null;
}

/** Reset the shell for a new screen and return the fresh regions. */
export function beginScreen(opts: { layout?: 'studio' | 'page'; inspector?: boolean } = {}): ToolContext {
  const p = buildShell();
  teardown();
  abort = new AbortController();

  clear(p.titleBox);
  clear(p.actions);
  clear(p.toolstrip);
  clear(p.stage);
  clear(p.inspectorInner);

  const page = opts.layout === 'page';
  p.stage.className = page ? 'stage plain' : 'stage';
  p.toolstrip.classList.toggle('hidden', page);
  const wantInspector = opts.inspector !== false && !page;
  p.inspector.classList.toggle('hidden', !wantInspector);
  p.sheetToggle.classList.toggle('hidden', !wantInspector);
  p.inspector.classList.remove('open');
  p.backdrop.classList.remove('open');
  p.inspector.classList.add('as-sheet');

  // Theme toggle always available top-right.
  const themeBtn = iconButton(
    settings().theme === 'dark' ? 'eye' : 'eyeOff',
    'Switch light / dark',
    () => {
      const next = settings().theme === 'dark' ? 'light' : 'dark';
      saveSettings({ theme: next });
      applyTheme();
      themeBtn.replaceChildren(icon(next === 'dark' ? 'eye' : 'eyeOff'));
    },
  );

  renderNav();

  const ctx: ToolContext = {
    stage: p.stage,
    toolstrip: p.toolstrip,
    inspector: p.inspectorInner,
    setTitle(title, sub) {
      clear(p.titleBox);
      if (sub) p.titleBox.appendChild(h('div.topbar-sub', null, sub));
      p.titleBox.appendChild(h('div.topbar-title', null, title));
    },
    setActions(...nodes) {
      clear(p.actions);
      for (const n of nodes) if (n) p.actions.appendChild(n);
      p.actions.appendChild(themeBtn);
    },
    openInspector() {
      p.inspector.classList.add('as-sheet', 'open');
      p.backdrop.classList.add('open');
    },
    onDestroy(fn) { destroyers.push(fn); },
    signal: abort.signal,
  };

  ctx.setActions();
  return ctx;
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = settings().theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', settings().theme === 'dark' ? '#14161a' : '#f5f5ef');
}

/** A full-width scrolling page (home, projects, tips, settings). */
export function pageBody(ctx: ToolContext): HTMLElement {
  const inner = h('div.page-inner');
  const page = h('div.page', null, inner);
  ctx.stage.appendChild(page);
  return inner;
}
