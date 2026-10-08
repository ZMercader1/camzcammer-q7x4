// Service worker: la app funciona sin conexión (en el coche, en un parking...).
// Al cambiar cualquier archivo, sube VERSION para que los móviles se actualicen.
const VERSION = 'cz-1.4.2';
// Las librerías pesadas (OpenCV, Tesseract) van en su propia caché y no se vuelven a
// descargar con cada versión de la app.
const VENDOR = 'cz-vendor-1';
const APP = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/config.js',
  'js/db.js',
  'js/dropbox.js',
  'js/icons.js',
  'js/image.js',
  'js/naming.js',
  'js/pdf.js',
  'js/scan.js',
  'js/settings.js',
  'js/sync.js',
  'js/detector.js',
  'js/detect-worker.js',
  'js/ocr.js',
  'js/extraer.js',
  'icons/logo.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(VERSION).then((c) => c.addAll(APP)),
    caches.open(VENDOR).then(async (c) => { if (!(await c.match('vendor/opencv.js'))) await c.add('vendor/opencv.js'); }),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VENDOR).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Dropbox y cualquier otro origen van directos a la red.
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // La vuelta de Dropbox (?code=...) es la página principal.
  const clave = url.search && req.mode === 'navigate' ? new Request('./') : req;
  e.respondWith(
    caches.match(clave, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copia = res.clone();
        caches.open(url.pathname.includes('/vendor/') ? VENDOR : VERSION).then((c) => c.put(req, copia));
      }
      return res;
    })),
  );
});
