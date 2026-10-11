import './styles/app.css';
import { route, setFallback, startRouter, navigate } from './core/router';
import { buildShell, applyTheme, beginScreen, pageBody } from './shell/shell';
import { renderHome } from './shell/home';
import { renderProjects } from './shell/projects';
import { renderLearn } from './shell/learn';
import { renderSettings } from './shell/settings';
import { h, button } from './core/dom';
import { toast } from './core/ui';

applyTheme();
buildShell();

route('/', () => void renderHome());
route('/projects', () => void renderProjects());
route('/learn', () => renderLearn());
route('/settings', () => void renderSettings());

route('/photo', async (p) => {
  const { renderPhotoTool } = await import('./tools/photo/index');
  await renderPhotoTool(p);
});
route('/draw', async (p) => {
  const { renderDrawTool } = await import('./tools/draw/index');
  await renderDrawTool(p);
});
route('/design', async (p) => {
  const { renderDesignTool } = await import('./tools/design/index');
  await renderDesignTool(p);
});
route('/motion', async (p) => {
  const { renderMotionTool } = await import('./tools/motion/index');
  await renderMotionTool(p);
});
route('/video', async (p) => {
  const { renderVideoTool } = await import('./tools/video/index');
  await renderVideoTool(p);
});
route('/pdf', async (p) => {
  const { renderPdfTool } = await import('./tools/pdf/index');
  await renderPdfTool(p);
});

setFallback(() => {
  const ctx = beginScreen({ layout: 'page' });
  ctx.setTitle('Not found', 'Mosaic');
  const page = pageBody(ctx);
  page.appendChild(h('div.empty-state', null,
    h('strong', null, 'That screen does not exist'),
    h('p', null, 'The link may be from an older version of Mosaic Studio.'),
    button('Back to home', { variant: 'primary', onClick: () => navigate('/') }),
  ));
});

window.addEventListener('error', (e) => {
  // Surface unexpected failures instead of leaving a blank canvas.
  console.error(e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  const message = (e.reason as Error)?.message;
  if (message) toast(message, 'err', 4000);
});

startRouter();

/* ---------------- PWA ---------------- */

let deferredInstall: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as Event & { prompt(): Promise<void> };
  showInstallChip();
});

function showInstallChip(): void {
  if (document.getElementById('install-chip')) return;
  const chip = h('button', {
    id: 'install-chip',
    class: 'btn btn-primary',
    style: {
      position: 'fixed', right: '14px', top: '10px', zIndex: '150',
    },
  }, 'Install app');
  chip.addEventListener('click', async () => {
    chip.remove();
    await deferredInstall?.prompt();
    deferredInstall = null;
  });
  document.body.appendChild(chip);
  setTimeout(() => chip.remove(), 12000);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || './';
    navigator.serviceWorker.register(`${base}service-worker.js`, { scope: base }).catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  });
}
