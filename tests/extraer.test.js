import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerImporte, extraerFecha, extraerRef, detectarTipo, extraerComercio, proveedorConocido,
  analizar, conTipo, tipoDe,
} from '../js/extraer.js';

const HOY = new Date(2026, 9, 8); // 8 oct 2026

const GASOLINERA = `GASOLINERA BALLENOIL
CIF B-12345678 · Av. Mediterráneo 12
FACTURA SIMPLIFICADA Nº 2026-004512
Fecha: 07/10/2026 Hora 08:41
Gasóleo A 38,12 L x 1,419 54,07
Base imponible 44,69
IVA 21% 9,38
TOTAL A PAGAR 54,07 €
Entregado 60,00
Cambio 5,93`;

const BAR = `CAFE BAR EL RINCON S.L.
C/ Mayor 3 - 28013 Madrid
Mesa 4 Comensales 2
2 MENU DEL DIA 25,00
1 CERVEZA 2,50
TOTAL (IVA INCLUIDO) 27,50
Tarjeta 27,50
3 oct. 2026 14:32`;

test('importe: el total, no el entregado ni la base', () => {
  assert.equal(extraerImporte(GASOLINERA), 54.07);
  assert.equal(extraerImporte(BAR), 27.5);
  assert.equal(extraerImporte('Gracias por su visita'), null);
  assert.equal(extraerImporte('TOTAL 1.234,56 EUR'), 1234.56);
});

test('fecha: formatos españoles y rango razonable', () => {
  assert.equal(extraerFecha(GASOLINERA, HOY), '2026-10-07');
  assert.equal(extraerFecha(BAR, HOY), '2026-10-03');
  assert.equal(extraerFecha('Fecha 05-09-26', HOY), '2026-09-05');
  assert.equal(extraerFecha('Emitida 2026-08-31', HOY), '2026-08-31');
  // Futura o absurda: nada.
  assert.equal(extraerFecha('Caduca 12/12/2030', HOY), null);
  assert.equal(extraerFecha('31/02/2026', HOY), null);
  // Prefiere la línea que dice FECHA.
  assert.equal(extraerFecha('Alta 01/01/2026\nFecha factura: 02/10/2026', HOY), '2026-10-02');
});

test('referencia de factura', () => {
  assert.equal(extraerRef(GASOLINERA), '2026-004512');
  assert.equal(extraerRef(BAR), null);
  assert.equal(extraerRef('Nº Factura: F260047'), 'F260047');
});

test('tipo y marca', () => {
  const g = detectarTipo(GASOLINERA);
  assert.equal(g.tipo, 'Gasolina');
  assert.equal(g.marca, 'Ballenoil');
  assert.equal(detectarTipo(BAR).tipo, 'Comida');
  assert.equal(detectarTipo('CORREOS Y TELEGRAFOS envío certificado').tipo, 'Envio');
  assert.equal(detectarTipo('Recibo genérico'), null);
});

test('comercio de la cabecera', () => {
  assert.equal(extraerComercio(BAR), 'Cafe Bar el Rincon');
  assert.equal(extraerComercio('TICKET 0042\nFERRETERIA LOPEZ\nC/ Sol 2'), 'Ferreteria Lopez');
});

test('aprende de los proveedores anteriores', () => {
  const anteriores = ['Gasolina Area 175', 'Gasolina Ballenoil', 'Envio Correos'];
  assert.equal(proveedorConocido(GASOLINERA, anteriores), 'Gasolina Ballenoil');
  assert.equal(proveedorConocido('CORREOS oficina 123', anteriores), 'Envio Correos');
  assert.equal(proveedorConocido('Otra cosa', anteriores), null);
});

test('analizar lo junta todo', () => {
  assert.deepEqual(analizar(GASOLINERA, { hoy: HOY }), {
    proveedor: 'Gasolina Ballenoil', tipo: 'Gasolina', importe: 54.07, fecha: '2026-10-07', ref: '2026-004512',
  });
  const bar = analizar(BAR, { hoy: HOY });
  assert.equal(bar.proveedor, 'Comida Cafe Bar el Rincon');
  assert.equal(bar.importe, 27.5);
  // Con historial gana el nombre que ya usaste.
  assert.equal(analizar(GASOLINERA, { hoy: HOY, anteriores: ['Gasolina Ballenoil Murcia'] }).proveedor, 'Gasolina Ballenoil Murcia');
  // Texto vacío: nada inventado.
  assert.deepEqual(analizar('', { hoy: HOY }), { proveedor: null, tipo: null, importe: null, fecha: null, ref: null });
});

test('conTipo cambia el prefijo sin duplicarlo', () => {
  assert.equal(conTipo('Ballenoil', 'Gasolina'), 'Gasolina Ballenoil');
  assert.equal(conTipo('Comida Ballenoil', 'Gasolina'), 'Gasolina Ballenoil');
  assert.equal(conTipo('', 'Parking'), 'Parking');
  assert.equal(conTipo('Gasolina Ballenoil', null), 'Ballenoil');
  assert.equal(tipoDe('Gasolina Ballenoil'), 'Gasolina');
  assert.equal(tipoDe('Ballenoil'), null);
});

test('texto real de Tesseract (sin cabecera y con Nº leído como N*)', () => {
  const ocr = `CIF B-12345678 - Av. Mediterráneo 12
FACTURA SIMPLIFICADA N* 2026-004512
Gasóleo A 38,12 L x 1,419 54,07
Base imponible 44,69
IVA 21% 9,38
TOTAL A PAGAR 54,07 €`;
  const r = analizar(ocr, { hoy: HOY });
  assert.equal(r.proveedor, 'Gasolina');
  assert.equal(r.importe, 54.07);
  assert.equal(r.ref, '2026-004512');
});

test('ticket real de gasolinera: el total es lo suministrado, no la reserva', () => {
  const ocr = `Ballenoil, S.A
C/ Tres Rieres, s/n
08292 Esparrayuera
Fecha: 07/10/2026 20:70
Turno: 4301
Albarán + 2620122650
Factura + 260702013172
Producto ; Sin Plomo 95
Litros +1 36,18
Precio : 1,719
Importe 1 62,19
IVA 1 21,00%
B.Imp. 1: 51,40
Imp. IVA : 10,79
Total reservado : 124,00 Eur
Total suminist. : 62,19 Eur
VISA CREDITO/DEB
Fecha: 07.10.26 Hora: 20:20
60,19 EUR`;
  const r = analizar(ocr, { hoy: HOY });
  assert.equal(r.importe, 62.19);
  assert.equal(r.fecha, '2026-10-07');
  assert.equal(r.ref, '260702013172');
  assert.equal(r.proveedor, 'Gasolina Ballenoil');
  // La reserva sola nunca se toma como total.
  assert.equal(extraerImporte('Total reservado : 124,00 Eur'), null);
});

test('marca con una letra mal leída por el OCR', () => {
  const r = analizar(`DALLENOIL - ARNES
Ballenoil S A
Fecha: 07/10/2026
Total suminist. : 62,19 Eur`, { hoy: HOY });
  assert.equal(r.proveedor, 'Gasolina Ballenoil');
  assert.equal(detectarTipo('REPSOL estacion').marca, 'Repsol');
  assert.equal(detectarTipo('REPSAL estacion').marca, 'Repsol');
  // Palabras normales no se confunden con marcas.
  assert.equal(detectarTipo('Ballena azul y bolleras'), null);
  assert.equal(proveedorConocido('DALLENOIL', ['Gasolina Ballenoil']), 'Gasolina Ballenoil');
});

test('nº de factura cuando el OCR lee el símbolo º como una comilla', () => {
  assert.equal(extraerRef('FACTURA SIMPLIFICADA N” 2026-004512'), '2026-004512');
  assert.equal(extraerRef('FACTURA SIMPLIFICADA N* 2026-004512'), '2026-004512');
  assert.equal(extraerRef('Factura Nº F260047'), 'F260047');
  assert.equal(extraerRef('Factura + 260702013172'), '260702013172');
});
