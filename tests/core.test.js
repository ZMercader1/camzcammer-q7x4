import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  parseImporte, formatImporte, nombreArchivo, rutaDropbox, carpetaTrimestre, claveTrimestre,
  limpiar, jsonAscii, hoy,
} from '../js/naming.js';
import { crearPdf } from '../js/pdf.js';
import {
  homografia, aplicarH, enderezar, ordenarEsquinas, tamanoSalida, rotar, filtrar,
} from '../js/image.js';
import { fotoSintetica, HOJA, escenaPoste } from './sintetica.js';

const require = createRequire(import.meta.url);

// ------------------------------------------------------------------ nombres y rutas

test('parseImporte entiende los formatos habituales', () => {
  assert.equal(parseImporte('54,07'), 54.07);
  assert.equal(parseImporte('54.07'), 54.07);
  assert.equal(parseImporte('1.234,56'), 1234.56);
  assert.equal(parseImporte('1,234.56'), 1234.56);
  assert.equal(parseImporte('1.234'), 1234);
  assert.equal(parseImporte('12 €'), 12);
  assert.equal(parseImporte('3,5'), 3.5);
  assert.equal(parseImporte(''), null);
  assert.equal(parseImporte('abc'), null);
  assert.equal(formatImporte(113.34), '113,34');
  assert.equal(formatImporte(4.9), '4,90');
});

test('nombre de archivo sigue la convención de la carpeta FACTURAS', () => {
  assert.equal(
    nombreArchivo({ proveedor: 'Gasolina Ballenoil', fecha: '2026-07-12', importe: 54.07 }),
    'Gasolina Ballenoil 2026-07-12 (54,07).pdf');
  assert.equal(
    nombreArchivo({ proveedor: 'Envio Correos', fecha: '2026-09-11', ref: 'ES26FC05479947', importe: 3.98 }),
    'Envio Correos 2026-09-11 ES26FC05479947 (3,98).pdf');
  assert.equal(nombreArchivo({ proveedor: '', fecha: '2026-10-08', importe: null }), 'Factura 2026-10-08.pdf');
  assert.equal(limpiar(' Bar  "Pepe" / Hnos. '), 'Bar -Pepe- - Hnos');
});

test('ruta de Dropbox por trimestre, mes y Gastos', () => {
  const f = { proveedor: 'Gasolina Area 175', fecha: '2026-07-25', importe: 42.06 };
  assert.equal(rutaDropbox('/FACTURAS', f),
    '/FACTURAS/Julio Agosto Septiembre 2026/Julio/Gastos/Gasolina Area 175 2026-07-25 (42,06).pdf');
  assert.equal(rutaDropbox('FACTURAS/', { ...f, fecha: '2026-12-31' }).split('/').slice(1, 4).join('/'),
    'FACTURAS/Octubre Noviembre Diciembre 2026/Diciembre');
  assert.equal(carpetaTrimestre(2026, 0), 'Enero Febrero Marzo 2026');
  assert.equal(claveTrimestre('2026-10-08'), '2026-T4');
  assert.equal(claveTrimestre('2026-03-31'), '2026-T1');
  assert.match(hoy(), /^\d{4}-\d{2}-\d{2}$/);
});

test('cabecera de Dropbox en ASCII', () => {
  const s = jsonAscii({ path: '/FACTURAS/Panadería Muñoz.pdf' });
  assert.ok(/^[\x00-\x7f]*$/.test(s));
  assert.deepEqual(JSON.parse(s), { path: '/FACTURAS/Panadería Muñoz.pdf' });
});

// ------------------------------------------------------------------ PDF

test('PDF válido: tabla xref apunta a cada objeto', () => {
  // JPEG mínimo de relleno: el escritor no lo decodifica, solo lo incrusta.
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = crearPdf([
    { jpeg, width: 1000, height: 1400 },
    { jpeg, width: 800, height: 3000 },
  ], { title: 'Panadería' });
  const txt = Buffer.from(pdf).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  const startxref = +/startxref\n(\d+)/.exec(txt)[1];
  assert.equal(txt.slice(startxref, startxref + 4), 'xref');
  const filas = txt.slice(startxref).split('\n');
  const total = +filas[1].split(' ')[1];
  assert.equal(total, 1 + 3 + 2 * 3);
  for (let n = 1; n < total; n++) {
    const off = +filas[2 + n].slice(0, 10);
    assert.equal(txt.slice(off, off + `${n} 0 obj`.length), `${n} 0 obj`, `objeto ${n}`);
  }
  assert.match(txt, /\/Count 2/);
  // Una página alargada (ticket) cabe en A4 de alto.
  assert.match(txt, /MediaBox \[0 0 224\.5 841\.89\]/);
});

// ------------------------------------------------------------------ geometría

test('homografía lleva las esquinas a su sitio', () => {
  const src = [{ x: 0, y: 0 }, { x: 99, y: 0 }, { x: 99, y: 199 }, { x: 0, y: 199 }];
  const dst = [{ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 320, y: 400 }, { x: 0, y: 380 }];
  const H = homografia(src, dst);
  src.forEach((p, i) => {
    const q = aplicarH(H, p.x, p.y);
    assert.ok(Math.abs(q.x - dst[i].x) < 1e-6 && Math.abs(q.y - dst[i].y) < 1e-6);
  });
});

test('ordenarEsquinas devuelve tl, tr, br, bl', () => {
  const desorden = [HOJA[2], HOJA[0], HOJA[3], HOJA[1]];
  assert.deepEqual(ordenarEsquinas(desorden), HOJA);
});

test('enderezar saca solo papel y rotar cambia dimensiones', () => {
  const foto = fotoSintetica();
  const out = enderezar(foto, HOJA, tamanoSalida(HOJA));
  assert.ok(out.width > 400 && out.height > 550);
  // Las esquinas (con margen) son papel claro, no mesa.
  const px = (x, y) => out.data[(y * out.width + x) * 4];
  for (const [x, y] of [[5, 5], [out.width - 6, 5], [5, out.height - 6], [out.width - 6, out.height - 6]]) {
    assert.ok(px(x, y) > 140, `esquina ${x},${y} = ${px(x, y)}`);
  }
  const r = rotar(out, 1);
  assert.equal(r.width, out.height);
  assert.equal(r.height, out.width);
});

test('filtro documento: fondo blanco y texto negro pese a la sombra', () => {
  const foto = fotoSintetica();
  const hoja = enderezar(foto, HOJA, tamanoSalida(HOJA));
  const bn = filtrar(hoja, 'documento');
  let blancos = 0;
  let negros = 0;
  for (let i = 0; i < bn.data.length; i += 4) {
    if (bn.data[i] >= 250) blancos++;
    else if (bn.data[i] <= 40) negros++;
  }
  const n = bn.width * bn.height;
  assert.ok(blancos / n > 0.6, `blancos ${blancos / n}`);
  assert.ok(negros / n > 0.05, `negros ${negros / n}`);
  for (const f of ['gris', 'color', 'original']) assert.equal(filtrar(hoja, f).width, hoja.width);
});

// ------------------------------------------------------------------ detección (OpenCV)

test('OpenCV detecta la hoja en la foto sintética', async () => {
  let cv = require('../vendor/opencv.js');
  if (cv instanceof Promise) cv = await cv;
  else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  const { detectarDocumento } = require('../js/detector.js');
  const res = detectarDocumento(cv, fotoSintetica());
  assert.ok(res, 'sin detección');
  const q = ordenarEsquinas(res.puntos);
  q.forEach((p, i) => {
    const err = Math.hypot(p.x - HOJA[i].x, p.y - HOJA[i].y);
    assert.ok(err < 12, `esquina ${i} desviada ${err.toFixed(1)} px`);
  });
});

test('encoger mete las esquinas hacia dentro', async () => {
  const { encoger } = await import('../js/image.js');
  const q = encoger([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }], 0.01);
  assert.deepEqual(q.map((p) => [Math.round(p.x), Math.round(p.y)]), [[1, 2], [99, 2], [99, 198], [1, 198]]);
});

test('sin documento (poste de noche) no inventa un recuadro', async () => {
  let cv = require('../vendor/opencv.js');
  if (cv instanceof Promise) cv = await cv;
  else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  const { detectarDocumento } = require('../js/detector.js');
  const res = detectarDocumento(cv, escenaPoste());
  assert.ok(!res || res.cobertura < 0.12, `detectó ${JSON.stringify(res)}`);
});
