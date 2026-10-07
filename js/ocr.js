// Lectura del texto (OCR) en el propio móvil con Tesseract. Nada sale del dispositivo.
// El motor (~4 MB) y el modelo de español (~2 MB) se descargan la primera vez y quedan en caché.

let workerP = null;

function obtener() {
  if (!workerP) {
    workerP = (async () => {
      const mod = await import('../vendor/tesseract/tesseract.esm.min.js');
      const T = mod.default || mod;
      const base = new URL('../vendor/tesseract/', import.meta.url).href;
      const w = await T.createWorker('spa', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base, // elige solo la variante (SIMD o no) que soporte el móvil
        langPath: `${base}lang`,
        workerBlobURL: false,
        cacheMethod: 'none', // ya lo cachea el service worker
      });
      // Una columna de texto de tamaños variables: así son los tickets. Con el modo por
      // defecto Tesseract se salta la cabecera grande, que es justo donde va el comercio.
      await w.setParameters({ tessedit_pageseg_mode: '4', user_defined_dpi: '300' });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/** Arranca la descarga del motor sin esperar (para que esté listo al escanear). */
export function precargar() {
  obtener().catch(() => {});
}

/** Texto de una imagen (canvas o blob). */
export async function leerTexto(imagen) {
  const w = await obtener();
  const { data } = await w.recognize(imagen);
  return data.text || '';
}
