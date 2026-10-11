import { h, clear, button } from './dom';

/* ---------------- Toast ---------------- */

export function toast(message: string, kind: 'info' | 'ok' | 'err' = 'info', ms = 2600): void {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = h('div', { class: `toast ${kind === 'info' ? '' : kind}`.trim() }, message);
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ---------------- Modal ---------------- */

export interface ModalHandle {
  close(): void;
  body: HTMLElement;
  footer: HTMLElement;
}

export function modal(title: string, render: (m: ModalHandle) => void, opts: { width?: number } = {}): ModalHandle {
  const host = document.getElementById('overlay-host')!;
  const body = h('div', { style: { display: 'grid', gap: '12px' } });
  const footer = h('div.row', { style: { justifyContent: 'flex-end', marginTop: '4px' } });
  const card = h('div.modal', opts.width ? { style: { width: `min(${opts.width}px, 100%)` } } : null,
    h('h2', null, title), body, footer);
  const backdrop = h('div.modal-backdrop', null, card);

  const handle: ModalHandle = {
    body,
    footer,
    close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    },
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') handle.close();
  }
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) handle.close();
  });
  document.addEventListener('keydown', onKey);

  host.appendChild(backdrop);
  render(handle);
  return handle;
}

export function confirmDialog(title: string, message: string, confirmLabel = 'Confirm'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const m = modal(title, (mm) => {
      mm.body.appendChild(h('p', null, message));
      mm.footer.appendChild(button('Cancel', { onClick: () => { finish(false); m.close(); } }));
      mm.footer.appendChild(
        button(confirmLabel, { variant: 'primary', onClick: () => { finish(true); m.close(); } }),
      );
    });
    const originalClose = m.close;
    m.close = () => {
      originalClose();
      finish(false);
    };
  });
}

export function promptDialog(title: string, label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const m = modal(title, (mm) => {
      const input = h('input', { class: 'text-input', value }) as HTMLInputElement;
      mm.body.appendChild(h('label.field-label', null, label));
      mm.body.appendChild(input);
      const ok = () => { finish(input.value.trim() || null); m.close(); };
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') ok(); });
      mm.footer.appendChild(button('Cancel', { onClick: () => { finish(null); m.close(); } }));
      mm.footer.appendChild(button('Save', { variant: 'primary', onClick: ok }));
      setTimeout(() => input.focus(), 30);
    });
    const originalClose = m.close;
    m.close = () => { originalClose(); finish(null); };
  });
}

/* ---------------- Busy / progress overlay ---------------- */

export interface BusyHandle {
  update(label: string, ratio?: number): void;
  done(): void;
}

export function busy(label: string): BusyHandle {
  const text = h('p', null, label);
  const bar = h('i');
  const m = modal('Working…', (mm) => {
    mm.body.appendChild(text);
    mm.body.appendChild(h('div.progress', null, bar));
  }, { width: 380 });
  return {
    update(l: string, ratio?: number) {
      text.textContent = l;
      if (typeof ratio === 'number') bar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    },
    done() { m.close(); },
  };
}

/* ---------------- Misc ---------------- */

export function renderInto(host: HTMLElement, ...nodes: Array<Node | null | undefined>): void {
  clear(host);
  for (const n of nodes) if (n) host.appendChild(n);
}
