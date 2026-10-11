/** Hash router — keeps the app deep-linkable on static hosting like GitHub Pages. */

export type RouteHandler = (params: URLSearchParams) => void | Promise<void>;

const routes = new Map<string, RouteHandler>();
let fallback: RouteHandler | null = null;
let current = '';

export function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function setFallback(handler: RouteHandler): void {
  fallback = handler;
}

export function currentPath(): string {
  return current;
}

export function navigate(path: string, replace = false): void {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === hash) {
    resolve();
    return;
  }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) resolve();
}

function parse(): { path: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function resolve(): void {
  const { path, params } = parse();
  current = path;
  const handler = routes.get(path) ?? fallback;
  if (handler) void handler(params);
}

export function startRouter(): void {
  window.addEventListener('hashchange', resolve);
  resolve();
}
