// IndexedDB: las facturas viven aquí (con sus páginas JPEG) hasta que el usuario las borra,
// o hasta que se suben a Dropbox si eligió "solo Dropbox".
//
// Factura: {
//   id, creado, fecha 'AAAA-MM-DD', proveedor, ref, importe (número|null), tipo 'Gastos',
//   destino 'ambos'|'dropbox'|'movil',
//   paginas: [{ blob: Blob(jpeg), width, height }]   (vacío tras subir si destino = 'dropbox')
//   thumb: Blob, estado 'local'|'pendiente'|'subida'|'error', error?, rutaDropbox?, subidaEn?
// }

const DB = 'camzcammer';
const STORE = 'facturas';
let dbp = null;

function abrir() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('fecha', 'fecha');
      s.createIndex('estado', 'estado');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, modo);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción abortada'));
  });
}

export const guardar = (f) => tx('readwrite', (s) => s.put(f));
export const obtener = (id) => tx('readonly', (s) => s.get(id));
export const borrar = (id) => tx('readwrite', (s) => s.delete(id));
export const todas = () => tx('readonly', (s) => s.getAll());

export async function actualizar(id, cambios) {
  const f = await obtener(id);
  if (!f) return null;
  Object.assign(f, cambios);
  await guardar(f);
  return f;
}

export const nuevoId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
