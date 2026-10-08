// Nombres de archivo y rutas de Dropbox. Sigue la convención que ya existe en
// Dropbox/FACTURAS:  "<Trimestre> <año>/<Mes>/Gastos/<Proveedor> <AAAA-MM-DD> [ref] (importe).pdf"

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** "2026-10-08" -> { y: 2026, m: 9, d: 8 } (m empieza en 0). Sin zonas horarias. */
export function partesFecha(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha || '');
  if (!m) throw new Error(`Fecha no válida: ${fecha}`);
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}

/** Fecha local de hoy en formato AAAA-MM-DD. */
export function hoy(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Índice de trimestre 0..3 */
export const trimestreDe = (mes) => Math.floor(mes / 3);

/** "Octubre Noviembre Diciembre 2026" */
export function carpetaTrimestre(y, mes) {
  const q = trimestreDe(mes) * 3;
  return `${MESES[q]} ${MESES[q + 1]} ${MESES[q + 2]} ${y}`;
}

/** Clave ordenable de trimestre: "2026-T4" */
export function claveTrimestre(fecha) {
  const { y, m } = partesFecha(fecha);
  return `${y}-T${trimestreDe(m) + 1}`;
}

/** Lee "54,07", "54.07", "1.234,56", "1,234.56", "54 €" -> número. null si no hay importe. */
export function parseImporte(texto) {
  if (texto == null) return null;
  let s = String(texto).replace(/[€\s]/g, '').replace(/eur$/i, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decPos = Math.max(lastComma, lastDot);
  // Un separador seguido de exactamente 3 dígitos y sin otro separador es de miles ("1.234").
  const decimales = decPos >= 0 ? s.length - decPos - 1 : 0;
  const sepUnico = (s.match(/[.,]/g) || []).length === 1;
  let entero, dec;
  if (decPos < 0 || (sepUnico && decimales === 3)) {
    entero = s.replace(/[.,]/g, '');
    dec = '';
  } else {
    entero = s.slice(0, decPos).replace(/[.,]/g, '');
    dec = s.slice(decPos + 1);
  }
  const n = Number(`${entero || '0'}${dec ? '.' + dec : ''}`);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 54.07 -> "54,07" */
export function formatImporte(n) {
  return n.toFixed(2).replace('.', ',');
}

/** Quita lo que Windows/Dropbox no aceptan en un nombre y normaliza espacios. */
export function limpiar(texto) {
  return String(texto || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/** "Gasolina Ballenoil 2026-07-12 (54,07).pdf" */
export function nombreArchivo({ proveedor, fecha, ref, importe }) {
  partesFecha(fecha);
  const partes = [limpiar(proveedor) || 'Factura', fecha];
  const r = limpiar(ref);
  if (r) partes.push(r);
  if (importe != null && Number.isFinite(importe)) partes.push(`(${formatImporte(importe)})`);
  return `${partes.join(' ')}.pdf`;
}

/** Ruta completa en Dropbox para una factura. */
export function rutaDropbox(base, factura, tipo = 'Gastos') {
  const { y, m } = partesFecha(factura.fecha);
  // base "/" (o vacía a propósito) = la raíz: así se usa con una app de Dropbox de carpeta aislada.
  const limpia = String(base ?? '/FACTURAS').trim().replace(/^\/+|\/+$/g, '');
  const b = limpia ? `/${limpia}` : '';
  return `${b}/${carpetaTrimestre(y, m)}/${MESES[m]}/${tipo}/${nombreArchivo(factura)}`;
}

/** Dropbox exige que la cabecera Dropbox-API-Arg sea ASCII: escapa el resto como \uXXXX. */
export function jsonAscii(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
