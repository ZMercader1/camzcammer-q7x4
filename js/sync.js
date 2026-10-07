// Cola de subida a Dropbox. iOS no deja subir en segundo plano con la app cerrada, así que la
// cola se procesa al abrir la app, al recuperar conexión y al volver a primer plano.

import * as db from './db.js';
import * as dbx from './dropbox.js';
import { crearPdf } from './pdf.js';
import { rutaDropbox, nombreArchivo } from './naming.js';
import { ajustes } from './settings.js';

let corriendo = false;
let otraVez = false;

export async function pdfDe(f) {
  if (!f.paginas?.length) throw new Error('Esta factura ya no tiene las páginas en el móvil');
  const paginas = await Promise.all(f.paginas.map(async (p) => ({
    jpeg: new Uint8Array(await p.blob.arrayBuffer()), width: p.width, height: p.height,
  })));
  const bytes = crearPdf(paginas, { title: nombreArchivo(f).replace(/\.pdf$/, '') });
  return new Blob([bytes], { type: 'application/pdf' });
}

export const necesitaSubida = (f) => f.destino !== 'movil' && (f.estado === 'pendiente' || f.estado === 'error');

/** Sube lo pendiente, de una en una. `alCambiar` se llama tras cada factura. */
export async function sincronizar(alCambiar = () => {}) {
  if (corriendo) { otraVez = true; return; }
  if (!dbx.conectado() || navigator.onLine === false) return;
  corriendo = true;
  try {
    do {
      otraVez = false;
      const cola = (await db.todas()).filter(necesitaSubida).sort((a, b) => a.creado - b.creado);
      for (const f of cola) {
        try {
          const meta = await dbx.subir(await pdfDe(f), rutaDropbox(ajustes().carpeta, f));
          const cambios = { estado: 'subida', rutaDropbox: meta.path_display, subidaEn: Date.now(), error: null };
          if (f.destino === 'dropbox') cambios.paginas = [];
          await db.actualizar(f.id, cambios);
        } catch (e) {
          if (e instanceof dbx.SinConexion) return;
          await db.actualizar(f.id, { estado: 'error', error: e.message });
          // Sin red no tiene sentido seguir con el resto.
          if (e instanceof TypeError) return;
        } finally {
          alCambiar();
        }
      }
    } while (otraVez);
  } finally {
    corriendo = false;
  }
}
