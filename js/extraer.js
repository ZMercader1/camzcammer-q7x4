// Interpreta el texto leído de un ticket o factura: proveedor (con su tipo), importe, fecha y
// referencia. Es deliberadamente conservador: si no hay una señal clara devuelve null y el
// campo se queda como estaba. Nunca inventa un importe.

import { hoy as hoyStr } from './naming.js';

/** Mayúsculas y sin tildes, para comparar. */
export const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const palabra = (term, linea) => new RegExp(`(^|[^A-Z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`).test(linea);

// ---------------------------------------------------------------- importe

const RE_NUM = /(?<![\d.,])(\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}|\d+[,.]\d{2})(?![\d])/g;
const FUERTES = ['TOTAL A PAGAR', 'TOTAL FACTURA', 'IMPORTE TOTAL', 'TOTAL EUROS', 'TOTAL EUR', 'A PAGAR', 'TOTAL COMPRA', 'TOTAL TICKET'];
const SUAVES = ['TOTAL', 'IMPORTE'];
const EXCLUIDAS = ['ENTREGADO', 'CAMBIO', 'EFECTIVO', 'DEVOLUCION', 'BASE', 'IVA', 'TARJETA', 'PROPINA', 'SUBTOTAL', 'CUOTA', 'DESCUENTO', 'PUNTOS', 'AHORRO'];
const DURAS = ['BASE IMPONIBLE', 'SUBTOTAL', 'TOTAL BASE', 'TOTAL IVA', 'CUOTA IVA', 'TOTAL PUNTOS', 'TOTAL AHORRO', 'TOTAL DESCUENTO'];

function numeros(linea) {
  const out = [];
  for (const m of linea.matchAll(RE_NUM)) {
    const s = m[1].replace(/\s/g, '');
    const dec = s.slice(-3);
    const ent = s.slice(0, -3).replace(/[.,]/g, '');
    const n = Number(`${ent}.${dec.slice(1)}`);
    if (Number.isFinite(n) && n > 0 && n < 100000) out.push(Math.round(n * 100) / 100);
  }
  return out;
}

/** El total a pagar, o null. Misma lógica que la app iOS anterior (ImporteParser). */
export function extraerImporte(texto) {
  const fuerte = [];
  const suave = [];
  const euro = [];
  const resto = [];
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const n = norm(linea);
    if (!n.trim() || DURAS.some((t) => n.includes(t))) continue;
    const esFuerte = FUERTES.some((t) => palabra(t, n));
    const esSuave = SUAVES.some((t) => palabra(t, n));
    const excluida = EXCLUIDAS.some((t) => palabra(t, n));
    // "TOTAL (IVA INCLUIDO) 56,72" es el total: la palabra TOTAL manda sobre la lista negra.
    if (!esFuerte && !esSuave && excluida) continue;
    const nums = numeros(linea);
    if (!nums.length) continue;
    if (esFuerte) fuerte.push(...nums);
    else if (esSuave) suave.push(...nums);
    else if (/€|EUR/.test(n)) euro.push(...nums);
    else resto.push(...nums);
  }
  if (fuerte.length) return Math.max(...fuerte);
  if (suave.length) return Math.max(...suave);
  if (euro.length) return euro[euro.length - 1];
  if (resto.length === 1) return resto[0];
  return null;
}

// ---------------------------------------------------------------- fecha

const MESES_ABR = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function valida(y, m, d, hoy) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(y, m - 1, d);
  if (f.getMonth() !== m - 1) return null; // 31 de febrero, etc.
  const dias = (f - hoy) / 86400000;
  // Una factura no es del futuro ni de hace más de ~15 meses.
  if (dias > 2 || dias < -460) return null;
  return hoyStr(f);
}

/** Fecha de la factura en AAAA-MM-DD, o null. Prefiere las líneas que dicen FECHA. */
export function extraerFecha(texto, hoy = new Date()) {
  const lineas = String(texto || '').split(/\r?\n/).map(norm);
  const candidatas = [];
  lineas.forEach((l) => {
    const prioridad = /FECHA|FRA|EMISION|EXPEDICION/.test(l) ? 0 : 1;
    for (const m of l.matchAll(/(?<!\d)(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4}|\d{2})(?!\d)/g)) {
      const f = valida(+m[3], +m[2], +m[1], hoy);
      if (f) candidatas.push({ f, prioridad });
    }
    for (const m of l.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
      const f = valida(+m[1], +m[2], +m[3], hoy);
      if (f) candidatas.push({ f, prioridad });
    }
    for (const m of l.matchAll(/(?<!\d)(\d{1,2})\s*(?:DE\s+)?([A-Z]{3})[A-Z]*\.?\s*(?:DE\s+)?(\d{4})(?!\d)/g)) {
      const mes = MESES_ABR.indexOf(m[2]) + 1;
      if (!mes) continue;
      const f = valida(+m[3], mes, +m[1], hoy);
      if (f) candidatas.push({ f, prioridad });
    }
  });
  candidatas.sort((a, b) => a.prioridad - b.prioridad);
  return candidatas[0]?.f || null;
}

// ---------------------------------------------------------------- referencia

export function extraerRef(texto) {
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const n = norm(linea);
    const m = /(?:FACTURA(?:\s+SIMPLIFICADA)?|FRA\.?|TICKET|N[º°O]\s*(?:DE\s*)?FACTURA)[^A-Z0-9]{0,6}(?:N[º°O*.]*|NUM(?:ERO)?\.?)?\s*[:#]?\s*([A-Z]{0,4}[\d][A-Z0-9\-/]{3,20})/.exec(n);
    if (m && /\d{3,}/.test(m[1])) return m[1].replace(/[-/]+$/, '');
  }
  return null;
}

// ---------------------------------------------------------------- tipo y proveedor

/** Tipos con el prefijo que se usa en el nombre del archivo (como "Gasolina Ballenoil"). */
export const TIPOS = [
  { id: 'Gasolina', señales: ['GASOLEO', 'GASOLINA', 'DIESEL', 'SIN PLOMO', 'CARBURANTE', 'LITROS', 'SURTIDOR', 'ESTACION DE SERVICIO', 'GASOLINERA', 'ADBLUE'],
    marcas: ['REPSOL', 'CEPSA', 'MOEVE', 'BALLENOIL', 'PLENOIL', 'PETROPRIX', 'GALP', 'SHELL', 'BP', 'PETRONOR', 'AVIA', 'CAMPSA', 'DISA', 'BONAREA', 'ESCLATOIL', 'BEROIL', 'Q8', 'TAMOIL', 'MEROIL', 'VALCARCE', 'PETROCAT'] },
  { id: 'Parking', señales: ['PARKING', 'APARCAMIENTO', 'ESTACIONAMIENTO', 'ZONA AZUL', 'ORA '], marcas: ['EMPARK', 'SABA', 'TELPARK', 'INDIGO', 'EASYPARK', 'PARCLICK'] },
  { id: 'Peaje', señales: ['PEAJE', 'AUTOPISTA', 'TELEPEAJE'], marcas: ['AUDASA', 'ABERTIS', 'AUMAR', 'AUSOL', 'VIA-T', 'VIAT'] },
  { id: 'Transporte', señales: ['BILLETE', 'TAXI', 'TRAYECTO', 'VIAJERO'], marcas: ['RENFE', 'CABIFY', 'UBER', 'BOLT', 'BLABLACAR', 'ALSA', 'AVLO', 'IRYO', 'OUIGO', 'FREENOW', 'VUELING', 'RYANAIR', 'IBERIA'] },
  { id: 'Envio', señales: ['ENVIO', 'PAQUETERIA', 'CERTIFICADO'], marcas: ['CORREOS', 'SEUR', 'MRW', 'GLS', 'NACEX', 'DHL', 'UPS', 'INPOST'] },
  { id: 'Comida', señales: ['RESTAURANTE', 'CAFETERIA', 'CAFE BAR', 'MENU', 'COMEDOR', 'BOCADILLO', 'TAPAS', 'CERVEZA', 'MESA', 'COMENSALES', 'BEBIDAS'], marcas: ['TELEPIZZA', 'BURGER KING', 'MCDONALD', 'VIPS', 'GOIKO', 'RODILLA', '100 MONTADITOS'] },
  { id: 'Alojamiento', señales: ['HOTEL', 'HOSTAL', 'ALOJAMIENTO', 'HABITACION', 'PERNOCTACION', 'APARTAMENTO'], marcas: ['BOOKING', 'AIRBNB', 'NH', 'MELIA', 'IBIS', 'B&B'] },
  { id: 'Material', señales: ['FERRETERIA', 'PAPELERIA', 'INFORMATICA', 'ELECTRONICA'], marcas: ['LEROY MERLIN', 'BRICOMART', 'BRICO DEPOT', 'MEDIA MARKT', 'MEDIAMARKT', 'FNAC', 'AMAZON', 'IKEA', 'DECATHLON', 'STAPLES', 'PCCOMPONENTES', 'WORTEN', 'CARREFOUR', 'ALCAMPO', 'MERCADONA', 'LIDL'] },
];
export const TIPO_IDS = TIPOS.map((t) => t.id);

const titulo = (s) => s.toLowerCase().replace(/(^|[\s\-&])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Del|La|El|Y|Los|Las)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());

/** Detecta el tipo y, si aparece, la marca conocida. */
export function detectarTipo(texto) {
  const n = norm(texto);
  let mejor = null;
  for (const t of TIPOS) {
    const marca = t.marcas.find((m) => palabra(m, n));
    const señales = t.señales.filter((s) => palabra(s.trim(), n)).length;
    const puntos = (marca ? 3 : 0) + señales;
    if (puntos > 0 && (!mejor || puntos > mejor.puntos)) mejor = { tipo: t.id, marca: marca ? titulo(marca) : null, puntos };
  }
  return mejor;
}

const RUIDO = /\d+[.,]\d{2}|TOTAL|BASE|IMPONIBLE|IMPORTE|EUROS?\b|FACTURA|TICKET|SIMPLIFICADA|C\.?I\.?F|N\.?I\.?F|TEL[EÉF.:]|FECHA|HORA|CALLE|C\/|AVDA|AVENIDA|PLAZA|CTRA|CP\b|\d{5}|WWW|HTTP|@|GRACIAS|BIENVENID|CAJA|OPERADOR|ATENDIDO|MESA|COPIA|CLIENTE|DOCUMENTO|IVA|PAGINA/;

/** Nombre del comercio: la primera línea "de nombre" de la cabecera. */
export function extraerComercio(texto) {
  const lineas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const l of lineas) {
    const n = norm(l);
    const letras = (n.match(/[A-Z]/g) || []).length;
    if (letras < 3 || letras / n.replace(/\s/g, '').length < 0.8 || RUIDO.test(n)) continue;
    const limpio = n.replace(/\b(S\.?\s?L\.?U?|S\.?\s?A\.?U?|S\.?\s?COOP\.?)\b\.?/g, '').replace(/[^A-Z0-9&'\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (limpio.length < 3) continue;
    return titulo(limpio.split(' ').slice(0, 4).join(' '));
  }
  return null;
}

const PALABRAS_TIPO = new Set(TIPO_IDS.map(norm));

/**
 * Busca en las facturas anteriores un proveedor cuyo nombre aparezca en el texto
 * ("Gasolina Ballenoil" si el ticket dice BALLENOIL). Devuelve el nombre tal cual lo usó.
 */
export function proveedorConocido(texto, anteriores) {
  const n = norm(texto);
  const votos = new Map();
  for (const nombre of anteriores) {
    const claves = norm(nombre).split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !PALABRAS_TIPO.has(w) && !/^\d+$/.test(w));
    if (claves.length && claves.some((w) => palabra(w, n))) votos.set(nombre, (votos.get(nombre) || 0) + 1);
  }
  return [...votos].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Todo junto. `anteriores` son los nombres de proveedor ya usados (los más frecuentes primero). */
export function analizar(texto, { hoy = new Date(), anteriores = [] } = {}) {
  const tipo = detectarTipo(texto);
  const comercio = extraerComercio(texto);
  let proveedor = proveedorConocido(texto, anteriores);
  if (!proveedor && tipo) {
    const nombre = tipo.marca || (comercio && !norm(comercio).includes(norm(tipo.tipo)) ? comercio : null);
    proveedor = nombre ? `${tipo.tipo} ${nombre}` : tipo.tipo;
  }
  if (!proveedor) proveedor = comercio;
  return {
    proveedor,
    tipo: tipo?.tipo || null,
    importe: extraerImporte(texto),
    fecha: extraerFecha(texto, hoy),
    ref: extraerRef(texto),
  };
}

/** Pone o cambia el tipo al principio del nombre del proveedor. */
export function conTipo(proveedor, tipo) {
  const partes = String(proveedor || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length && PALABRAS_TIPO.has(norm(partes[0]))) partes.shift();
  return [tipo, ...partes].filter(Boolean).join(' ');
}

export const tipoDe = (proveedor) => {
  const p = norm(String(proveedor || '').trim().split(/\s+/)[0]);
  return TIPO_IDS.find((t) => norm(t) === p) || null;
};
