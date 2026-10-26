const { ipcRenderer } = require('electron');

window.addEventListener('click', event => {
  if (!event.isTrusted || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(target instanceof HTMLAnchorElement)) return;
  let url;
  try { url = new URL(target.href); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  event.preventDefault(); event.stopImmediatePropagation();
  ipcRenderer.send('open-source-link', url.href);
}, true);
