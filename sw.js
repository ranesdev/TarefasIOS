/* Service Worker: rede primeiro (sempre pega a versão nova quando online),
   com cache como reserva para funcionar offline.
   Ao alterar os arquivos do app, incremente a versão do cache. */
const CACHE = 'tarefas-v3';
const ARQUIVOS = ['./', './index.html', './style.css', './script.js', './manifest.json', './icon.svg'];
const TEMPO_LIMITE_MS = 4000;   // se a rede demorar mais que isso, usa o cache

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // "reload" ignora o cache HTTP; um arquivo ausente não derruba a instalação
      .then((c) => Promise.all(ARQUIVOS.map((a) => c.add(new Request(a, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function redeOuCache(req) {
  const rede = fetch(req, { cache: 'no-cache' }).then((resp) => {
    if (resp && resp.ok) {
      const copia = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
    }
    return resp;
  });
  rede.catch(() => {});   // evita aviso de rejeição não tratada

  try {
    return await Promise.race([
      rede,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TEMPO_LIMITE_MS)),
    ]);
  } catch (err) {
    const guardado = await caches.match(req, { ignoreSearch: true });
    return guardado || rede;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // só arquivos do próprio site
  e.respondWith(redeOuCache(req));
});
