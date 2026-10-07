// Worker de detección: OpenCV pesa 13 MB y tarda en arrancar, así que vive fuera del hilo
// de la interfaz. La cámara se puede usar desde el primer segundo; la detección llega después.
/* global cv, detectarDocumento */

importScripts('../vendor/opencv.js', 'detector.js');

const listo = (async () => {
  let c = self.cv;
  if (c instanceof Promise) c = await c;
  else if (!c.Mat) await new Promise((r) => { c.onRuntimeInitialized = r; });
  return c;
})();

listo.then(() => self.postMessage({ type: 'ready' }),
  (e) => self.postMessage({ type: 'error', message: String(e) }));

self.onmessage = async (ev) => {
  const { id, image } = ev.data;
  try {
    const c = await listo;
    self.postMessage({ id, result: detectarDocumento(c, image) });
  } catch (e) {
    self.postMessage({ id, error: String(e && e.message || e) });
  }
};
