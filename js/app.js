import * as db from './db.js';
import * as dbx from './dropbox.js';
import { icon } from './icons.js';
import { ajustes, guardarAjustes, DESTINOS } from './settings.js';
import { sincronizar, pdfDe, necesitaSubida } from './sync.js';
import {
  Camara, Detector, cargarArchivo, nuevaPagina, renderizar, miniatura, marcoCompleto, reducir, imagenOcr,
} from './scan.js';
import { FILTROS, ordenarEsquinas } from './image.js';
import { crearPdf } from './pdf.js';
import {
  hoy, partesFecha, MESES, claveTrimestre, carpetaTrimestre, parseImporte, formatImporte,
  rutaDropbox, nombreArchivo,
} from './naming.js';
import { VERSION } from './config.js';
import { leerTexto, precargar } from './ocr.js';
import { analizar, TIPO_IDS, conTipo, tipoDe } from './extraer.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const estado = {
  vista: 'lista',
  trimestre: claveTrimestre(hoy()),
  facturas: [],
  borrador: null, // { paginas: [], filtro }
  detalle: null, // id
};
const camara = new Camara($('#video'));
let detector = null;

// ================================================================= utilidades de interfaz

function mostrar(v) {
  document.querySelectorAll('.vista').forEach((el) => el.classList.toggle('activa', el.id === `v-${v}`));
  estado.vista = v;
  if (v !== 'camara' && v !== 'recorte') pararCamara();
  if (v !== 'detalle') liberarUrls('detalle');
}

const urlsPorGrupo = new Map();
function url(grupo, blob) {
  const u = URL.createObjectURL(blob);
  if (!urlsPorGrupo.has(grupo)) urlsPorGrupo.set(grupo, []);
  urlsPorGrupo.get(grupo).push(u);
  return u;
}
function liberarUrls(grupo) {
  (urlsPorGrupo.get(grupo) || []).forEach((u) => URL.revokeObjectURL(u));
  urlsPorGrupo.delete(grupo);
}

let toastTimer = 0;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.className = `toast visible ${tipo}`;
  t.innerHTML = `${tipo === 'error' ? icon('alert') : icon('check')}<span>${esc(msg)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, tipo === 'error' ? 4500 : 2200);
}

function ocupado(texto) {
  $('#ocupado-txt').textContent = texto || '';
  $('#ocupado').hidden = !texto;
}

let alCerrarHoja = null;
function abrirHoja(html, montar) {
  const h = $('#hoja');
  h.innerHTML = `<div class="hoja-asa"></div>${html}`;
  h.hidden = false;
  $('#velo').hidden = false;
  requestAnimationFrame(() => { h.classList.add('abierta'); $('#velo').classList.add('visible'); });
  montar?.(h);
}
function cerrarHoja() {
  const h = $('#hoja');
  h.classList.remove('abierta');
  $('#velo').classList.remove('visible');
  setTimeout(() => { h.hidden = true; $('#velo').hidden = true; h.innerHTML = ''; }, 220);
  const cb = alCerrarHoja;
  alCerrarHoja = null;
  cb?.();
}
$('#velo').addEventListener('click', cerrarHoja);

function confirmar({ titulo, texto, ok = 'Aceptar', peligro = false }) {
  return new Promise((resolve) => {
    let respuesta = false;
    alCerrarHoja = () => resolve(respuesta);
    abrirHoja(`
      <h2 class="hoja-titulo">${esc(titulo)}</h2>
      ${texto ? `<p class="hoja-texto">${esc(texto)}</p>` : ''}
      <div class="hoja-botones">
        <button class="btn-secundario" data-r="no" type="button">Cancelar</button>
        <button class="${peligro ? 'btn-peligro' : 'btn-primario'}" data-r="si" type="button">${esc(ok)}</button>
      </div>`, (h) => {
      h.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        respuesta = b.dataset.r === 'si';
        cerrarHoja();
      }));
    });
  });
}

function segmentos(cont, opciones, valor, alCambiar) {
  cont.innerHTML = Object.entries(opciones).map(([k, o]) => `
    <button type="button" role="radio" data-v="${k}" aria-checked="${k === valor}" class="seg ${k === valor ? 'on' : ''}">
      ${o.icono ? icon(o.icono) : ''}<span>${esc(o.corto || o)}</span>
    </button>`).join('');
  cont.onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    cont.querySelectorAll('.seg').forEach((s) => {
      const on = s === b;
      s.classList.toggle('on', on);
      s.setAttribute('aria-checked', on);
    });
    alCambiar(b.dataset.v);
  };
}

const fechaCorta = (f) => { const { m, d } = partesFecha(f); return `${d} ${MESES[m].slice(0, 3).toLowerCase()}`; };
const fechaLarga = (f) => { const { y, m, d } = partesFecha(f); return `${d} de ${MESES[m].toLowerCase()} de ${y}`; };
const euros = (n) => (n == null ? '' : `${formatImporte(n)} €`);

// ================================================================= lista

let recarga = 0;
async function cargar() {
  const id = ++recarga;
  const fs = await db.todas();
  if (id !== recarga) return;
  estado.facturas = fs;
  pintarLista();
  pintarSync();
}

function estadoDe(f) {
  if (f.destino === 'movil') return { cls: 'movil', ico: 'phone', txt: 'Solo en el móvil' };
  if (f.estado === 'subida') return { cls: 'ok', ico: 'cloudCheck', txt: f.paginas?.length ? 'En el móvil y en Dropbox' : 'Solo en Dropbox' };
  if (f.estado === 'error') return { cls: 'error', ico: 'alert', txt: `No se pudo subir: ${f.error || 'error'}` };
  if (!dbx.conectado()) return { cls: 'aviso', ico: 'cloudOff', txt: 'Pendiente: conecta Dropbox' };
  return { cls: 'pendiente', ico: 'cloudUp', txt: 'Pendiente de subir' };
}

function pintarLista() {
  const [y, q] = estado.trimestre.split('-T').map(Number);
  $('#t-titulo').textContent = `T${q} · ${y}`;
  $('#t-sub').textContent = `${MESES[(q - 1) * 3]} – ${MESES[(q - 1) * 3 + 2]}`;

  const delT = estado.facturas
    .filter((f) => claveTrimestre(f.fecha) === estado.trimestre)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
  const total = delT.reduce((s, f) => s + (f.importe || 0), 0);

  $('#resumen').innerHTML = delT.length ? `
    <div><b>${delT.length}</b> ${delT.length === 1 ? 'factura' : 'facturas'}${total ? ` · <b>${formatImporte(total)} €</b>` : ''}</div>
    <button id="btn-exportar" class="btn-chip" type="button">${icon('share')}Exportar</button>` : '';
  $('#btn-exportar')?.addEventListener('click', () => exportarTrimestre(delT));

  liberarUrls('lista');
  if (!delT.length) {
    $('#lista').innerHTML = `
      <div class="vacio">
        <div class="vacio-ico">${icon('scan')}</div>
        <h3>Nada en este trimestre</h3>
        <p>Pulsa <b>Escanear</b> y la factura irá directa a su carpeta.</p>
      </div>`;
    return;
  }
  const porMes = new Map();
  for (const f of delT) {
    const m = partesFecha(f.fecha).m;
    if (!porMes.has(m)) porMes.set(m, []);
    porMes.get(m).push(f);
  }
  $('#lista').innerHTML = [...porMes].map(([m, fs]) => {
    const sub = fs.reduce((s, f) => s + (f.importe || 0), 0);
    return `
    <section class="mes">
      <h3><span>${MESES[m]}</span><small>${fs.length}${sub ? ` · ${formatImporte(sub)} €` : ''}</small></h3>
      ${fs.map((f) => {
        const e = estadoDe(f);
        return `
        <button class="item" type="button" data-id="${f.id}">
          <img class="thumb" src="${f.thumb ? url('lista', f.thumb) : ''}" alt="" loading="lazy">
          <div class="item-txt">
            <b>${esc(f.proveedor || 'Factura')}</b>
            <span>${fechaCorta(f.fecha)}${f.ref ? ` · ${esc(f.ref)}` : ''}</span>
          </div>
          <div class="item-der">
            ${f.importe != null ? `<b class="importe">${euros(f.importe)}</b>` : ''}
            <span class="est ${e.cls}" title="${esc(e.txt)}">${icon(e.ico)}</span>
          </div>
        </button>`;
      }).join('')}
    </section>`;
  }).join('');
}

$('#lista').addEventListener('click', (e) => {
  const it = e.target.closest('.item');
  if (it) abrirDetalle(it.dataset.id);
});

function moverTrimestre(delta) {
  let [y, q] = estado.trimestre.split('-T').map(Number);
  q += delta;
  if (q < 1) { q = 4; y--; }
  if (q > 4) { q = 1; y++; }
  estado.trimestre = `${y}-T${q}`;
  pintarLista();
}

let sincronizando = false;
function pintarSync() {
  const chip = $('#chip-sync');
  const pend = estado.facturas.filter(necesitaSubida);
  const errores = pend.filter((f) => f.estado === 'error').length;
  if (!dbx.conectado()) {
    chip.className = 'chip-sync aviso';
    chip.innerHTML = `${icon('cloudOff')}<span>Conectar</span>`;
  } else if (pend.length) {
    chip.className = `chip-sync ${errores && !sincronizando ? 'error' : 'pendiente'}`;
    chip.innerHTML = `${icon(sincronizando ? 'loader' : errores ? 'alert' : 'cloudUp', sincronizando ? 'gira' : '')}<span>${pend.length}</span>`;
  } else {
    chip.className = 'chip-sync ok';
    chip.innerHTML = `${icon('cloudCheck')}<span>Dropbox</span>`;
  }
}

async function sincronizarYA() {
  if (!dbx.conectado()) return;
  sincronizando = true;
  pintarSync();
  try {
    await sincronizar(() => refrescar());
  } finally {
    sincronizando = false;
    await cargar();
    if (estado.vista === 'detalle' && estado.detalle) pintarDetalle(estado.detalle, false);
  }
}

let refrescoT = 0;
function refrescar() {
  clearTimeout(refrescoT);
  refrescoT = setTimeout(cargar, 150);
}

// ================================================================= cámara

let bucle = 0;
let quadObjetivo = null;
let quadVisible = null;
let capturando = false;
let quieto = { desde: 0, ref: null };
const QUIETO_MS = 1200;

async function abrirCamara() {
  if (!estado.borrador) estado.borrador = { paginas: [], filtro: ajustes().filtro };
  if (ajustes().camaraNativa) {
    // La cámara del iPhone: máxima resolución y su propio flash. Luego sigue el mismo flujo.
    elegirArchivo(true);
    return;
  }
  mostrar('camara');
  pintarCamUI();
  pintarAuto();
  avisoCam(null);
  $('#cam-estado').textContent = 'Abriendo cámara…';
  $('#cam-estado').classList.remove('ok');
  try {
    await camara.iniciar();
  } catch (e) {
    const msg = e.name === 'NotAllowedError'
      ? 'No hay permiso para usar la cámara.'
      : 'No se pudo abrir la cámara.';
    avisoCam(msg);
    return;
  }
  if (estado.vista !== 'camara') return;
  pintarFlash();
  arrancarBucle();
}

function pararCamara() {
  bucle++;
  quadObjetivo = quadVisible = null;
  camara.detener();
}

function avisoCam(msg) {
  const a = $('#cam-aviso');
  a.hidden = !msg;
  if (!msg) return;
  a.innerHTML = `
    <div class="cam-aviso-caja">
      ${icon('camera')}
      <p>${esc(msg)}</p>
      <button class="btn-primario" id="cam-sistema" type="button">Usar la cámara del iPhone</button>
      <button class="btn-texto" id="cam-reintentar" type="button">Reintentar</button>
    </div>`;
  $('#cam-sistema').onclick = () => elegirArchivo(true);
  $('#cam-reintentar').onclick = abrirCamara;
}

function pintarCamUI() {
  const n = estado.borrador?.paginas.length || 0;
  $('#cam-listo').hidden = n === 0;
  $('#cam-hueco').hidden = n > 0;
  $('#cam-num').textContent = n;
  const ultima = estado.borrador?.paginas[n - 1];
  if (ultima?.salida) $('#cam-mini').src = ultima.salida.url;
}

function pintarAuto() {
  $('#cam-auto').classList.toggle('on', ajustes().autoDisparo);
}

function pintarFlash() {
  $('#cam-flash').innerHTML = icon(camara.linterna ? 'flash' : 'flashOff');
  $('#cam-flash').classList.toggle('on', camara.linterna);
}

function arrancarBucle() {
  const id = ++bucle;
  const video = camara.video;
  // Detección continua (a la velocidad que dé el worker).
  (async () => {
    while (id === bucle) {
      if (detector?.listo && video.videoWidth) {
        try {
          const r = await detector.detectar(video, video.videoWidth, video.videoHeight, 360);
          if (id !== bucle) return;
          estabilizar(r, video);
          vigilarQuietud(r, video);
        } catch { /* siguiente vuelta */ }
      }
      await sleep(90);
    }
  })();
  // Dibujo suavizado del contorno.
  const ov = $('#overlay');
  const ctx = ov.getContext('2d');
  const frame = () => {
    if (id !== bucle) { ctx.clearRect(0, 0, ov.width, ov.height); return; }
    const dpr = devicePixelRatio || 1;
    const cw = ov.clientWidth;
    const ch = ov.clientHeight;
    if (ov.width !== Math.round(cw * dpr)) { ov.width = Math.round(cw * dpr); ov.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const est = $('#cam-estado');
    if (!detector?.listo) est.textContent = detector?.fallo ? 'Sin detección automática' : 'Preparando detector…';
    else if (!quadObjetivo) est.textContent = 'Encuadra la factura';
    else est.textContent = ajustes().autoDisparo && quieto.ref ? 'Quieto… disparando' : 'Documento detectado';
    est.classList.toggle('ok', !!quadObjetivo);
    if (vw && quadObjetivo) {
      const s = Math.max(cw / vw, ch / vh);
      const ox = (cw - vw * s) / 2;
      const oy = (ch - vh * s) / 2;
      const destino = quadObjetivo.map((p) => ({ x: p.x * s + ox, y: p.y * s + oy }));
      quadVisible = quadVisible
        ? quadVisible.map((p, i) => ({ x: p.x + (destino[i].x - p.x) * 0.35, y: p.y + (destino[i].y - p.y) * 0.35 }))
        : destino;
      ctx.beginPath();
      quadVisible.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(200,255,46,0.14)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#c8ff2e';
      ctx.shadowColor = 'rgba(200,255,46,0.8)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      quadVisible = null;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// El recuadro solo aparece cuando dos detecciones seguidas coinciden, y desaparece tras
// varios fallos seguidos. Así no salta de un sitio a otro con cada fotograma.
let candidato = null;
let fallos = 0;
function estabilizar(r, video) {
  const tol = 0.05 * Math.max(video.videoWidth, video.videoHeight);
  const cerca = (a, b) => a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < tol);
  if (r && r.cobertura > 0.12) {
    if (candidato && cerca(r.puntos, candidato)) quadObjetivo = r.puntos;
    else if (quadObjetivo && !cerca(r.puntos, quadObjetivo)) fallos++;
    candidato = r.puntos;
    if (quadObjetivo && cerca(r.puntos, quadObjetivo)) fallos = 0;
  } else {
    candidato = null;
    fallos++;
  }
  if (fallos >= 3) { quadObjetivo = null; fallos = 0; }
}

/** Con el disparo automático activo, dispara cuando las esquinas no se mueven durante un rato. */
function vigilarQuietud(r, video) {
  if (!ajustes().autoDisparo || capturando || !r || r.cobertura < 0.2) { quieto.ref = null; return; }
  const tol = 0.02 * Math.max(video.videoWidth, video.videoHeight);
  const igual = quieto.ref && r.puntos.every((p, i) => Math.hypot(p.x - quieto.ref[i].x, p.y - quieto.ref[i].y) < tol);
  if (!igual) { quieto = { desde: Date.now(), ref: r.puntos }; return; }
  if (Date.now() - quieto.desde >= QUIETO_MS) {
    quieto.ref = null;
    disparar();
  }
}

async function detectarEn(c) {
  if (!detector?.listo) return null;
  try {
    const r = await detector.detectar(c, c.width, c.height);
    return r && r.cobertura > 0.12 ? r.puntos : null;
  } catch {
    return null;
  }
}

async function disparar() {
  if (capturando || !camara.stream) return;
  capturando = true;
  const fl = document.createElement('div');
  fl.className = 'destello';
  $('#v-camara').append(fl);
  setTimeout(() => fl.remove(), 350);
  try {
    const foto = camara.capturar();
    await nuevaFoto(foto);
  } finally {
    capturando = false;
  }
}

async function nuevaFoto(foto) {
  const quad = await detectarEn(foto);
  const pag = nuevaPagina(foto, quad || marcoCompleto(foto.width, foto.height, 0.1));
  pag.detectado = quad;
  if (quad && !ajustes().confirmarRecorte) {
    estado.borrador.paginas.push(pag);
    abrirRevisar();
  } else {
    abrirRecorte(pag, { nueva: true });
  }
}

function elegirArchivo(conCamara = false) {
  const inp = $('#file-in');
  if (conCamara) inp.setAttribute('capture', 'environment');
  else inp.removeAttribute('capture');
  inp.multiple = !conCamara;
  inp.value = '';
  inp.click();
}

$('#file-in').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  if (!estado.borrador) estado.borrador = { paginas: [], filtro: ajustes().filtro };
  ocupado('Cargando…');
  try {
    if (files.length === 1) {
      const foto = await cargarArchivo(files[0]);
      ocupado('');
      await nuevaFoto(foto);
      return;
    }
    for (const f of files) {
      const foto = await cargarArchivo(f);
      const quad = await detectarEn(foto);
      const pag = nuevaPagina(foto, quad || marcoCompleto(foto.width, foto.height));
      pag.detectado = quad;
      estado.borrador.paginas.push(pag);
    }
    abrirRevisar();
  } catch (err) {
    toast(`No se pudo abrir la imagen: ${err.message}`, 'error');
  } finally {
    ocupado('');
  }
});

// ================================================================= recorte

let rec = null; // { pag, puntos, nueva, escala }

function abrirRecorte(pag, { nueva }) {
  rec = { pag, puntos: pag.quad.map((p) => ({ ...p })), nueva };
  $('#rec-cancelar').textContent = nueva ? 'Repetir' : 'Cancelar';
  mostrar('recorte');
  requestAnimationFrame(pintarRecorte);
}

// El cuadro y las esquinas se pintan en un canvas que cubre toda la escena (no en SVG: en
// Safari de iPhone no se veían), así las esquinas no se cortan aunque estén en el borde.
function pintarRecorte() {
  if (!rec) return;
  const escena = $('#rec-escena');
  const W = escena.clientWidth;
  const H = escena.clientHeight;
  const o = rec.pag.original;
  const margen = 28;
  const s = Math.min((W - margen * 2) / o.width, (H - margen * 2) / o.height);
  const cw = Math.round(o.width * s);
  const ch = Math.round(o.height * s);
  rec.escala = s;
  rec.ox = Math.round((W - cw) / 2);
  rec.oy = Math.round((H - ch) / 2);
  const dpr = devicePixelRatio || 1;
  const c = $('#rec-canvas');
  c.width = Math.round(cw * dpr);
  c.height = Math.round(ch * dpr);
  c.style.width = `${cw}px`;
  c.style.height = `${ch}px`;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(o, 0, 0, c.width, c.height);
  const capa = $('#rec-capa');
  capa.width = Math.round(W * dpr);
  capa.height = Math.round(H * dpr);
  pintarQuad();
}

const aPantalla = (q) => ({ x: rec.ox + q.x * rec.escala, y: rec.oy + q.y * rec.escala });

function pintarQuad() {
  const capa = $('#rec-capa');
  const ctx = capa.getContext('2d');
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, capa.width, capa.height);
  const { width: w, height: h } = rec.pag.original;
  const p = rec.puntos.map(aPantalla);
  const esq = aPantalla({ x: 0, y: 0 });
  const fin = aPantalla({ x: w, y: h });
  // Oscurece lo que queda fuera del recorte.
  ctx.beginPath();
  ctx.rect(esq.x, esq.y, fin.x - esq.x, fin.y - esq.y);
  p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill('evenodd');
  // Contorno.
  ctx.beginPath();
  p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(200,255,46,0.08)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#c8ff2e';
  ctx.stroke();
  // Esquinas.
  for (const q of p) {
    ctx.beginPath();
    ctx.arc(q.x, q.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200,255,46,0.2)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(q.x, q.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0d10';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c8ff2e';
    ctx.stroke();
  }
}

(() => {
  const capa = $('#rec-capa');
  let arrastre = null;
  const aImagen = (e) => {
    const r = capa.getBoundingClientRect();
    return { x: (e.clientX - r.left - rec.ox) / rec.escala, y: (e.clientY - r.top - rec.oy) / rec.escala };
  };
  capa.addEventListener('pointerdown', (e) => {
    if (!rec) return;
    const pt = aImagen(e);
    let mejor = -1;
    let dmin = 50 / rec.escala;
    rec.puntos.forEach((q, i) => {
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < dmin) { dmin = d; mejor = i; }
    });
    if (mejor < 0) return;
    arrastre = { i: mejor, dx: rec.puntos[mejor].x - pt.x, dy: rec.puntos[mejor].y - pt.y };
    capa.setPointerCapture(e.pointerId);
    e.preventDefault();
    lupa(rec.puntos[mejor], e);
  });
  capa.addEventListener('pointermove', (e) => {
    if (!arrastre) return;
    const pt = aImagen(e);
    const { width: w, height: h } = rec.pag.original;
    const q = rec.puntos[arrastre.i];
    q.x = Math.min(w, Math.max(0, pt.x + arrastre.dx));
    q.y = Math.min(h, Math.max(0, pt.y + arrastre.dy));
    pintarQuad();
    lupa(q, e);
  });
  const fin = () => { arrastre = null; $('#rec-lupa').hidden = true; };
  capa.addEventListener('pointerup', fin);
  capa.addEventListener('pointercancel', fin);
})();

function lupa(punto, e) {
  const l = $('#rec-lupa');
  l.hidden = false;
  const ctx = l.getContext('2d');
  const zoom = 3;
  // Lado de la zona ampliada, en píxeles de la foto: lo que mide la lupa en pantalla / (escala * zoom).
  const lado = (l.clientWidth || 110) / (rec.escala * zoom);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, l.width, l.height);
  ctx.drawImage(rec.pag.original, punto.x - lado / 2, punto.y - lado / 2, lado, lado, 0, 0, l.width, l.height);
  ctx.strokeStyle = '#c8ff2e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(l.width / 2 - 18, l.height / 2); ctx.lineTo(l.width / 2 + 18, l.height / 2);
  ctx.moveTo(l.width / 2, l.height / 2 - 18); ctx.lineTo(l.width / 2, l.height / 2 + 18);
  ctx.stroke();
  // La lupa se aparta del dedo.
  const escena = $('#rec-escena').getBoundingClientRect();
  const izquierda = e.clientX > escena.left + escena.width / 2;
  l.style.left = izquierda ? '16px' : 'auto';
  l.style.right = izquierda ? 'auto' : '16px';
}

$('#rec-cancelar').addEventListener('click', () => {
  const nueva = rec?.nueva;
  rec = null;
  if (!nueva) { abrirRevisar(); return; }
  // Con la cámara del iPhone, si se cancela el selector hay que quedar en una pantalla válida.
  if (estado.borrador?.paginas.length) abrirRevisar(); else mostrar('lista');
  abrirCamara();
});
$('#rec-auto').addEventListener('click', () => {
  const { width: w, height: h } = rec.pag.original;
  rec.puntos = marcoCompleto(w, h);
  pintarQuad();
});
$('#rec-detectar').addEventListener('click', async () => {
  let q = rec.pag.detectado;
  if (!q) {
    ocupado('Buscando bordes…');
    q = await detectarEn(rec.pag.original);
    ocupado('');
    rec.pag.detectado = q;
  }
  if (!q) { toast('No encuentro los bordes; ajústalos a mano', 'error'); return; }
  rec.puntos = q.map((p) => ({ ...p }));
  pintarQuad();
});
$('#rec-ok').addEventListener('click', () => {
  const { pag, puntos, nueva } = rec;
  pag.quad = ordenarEsquinas(puntos);
  pag.enderezada = null;
  pag.salida = null;
  if (nueva) estado.borrador.paginas.push(pag);
  rec = null;
  abrirRevisar();
});
window.addEventListener('resize', () => { if (estado.vista === 'recorte') pintarRecorte(); });

// ================================================================= revisar y guardar

let colaRender = Promise.resolve();
function asegurarRender(p) {
  const filtro = estado.borrador.filtro;
  if (p.salida && p.salida.filtro === filtro && !p.sucia) return Promise.resolve(p.salida);
  const tarea = colaRender.then(async () => {
    if (p.salida && p.salida.filtro === filtro && !p.sucia) return p.salida;
    p.sucia = false;
    await sleep(16); // deja pintar el spinner antes del cálculo
    return renderizar(p, estado.borrador.filtro);
  });
  colaRender = tarea.catch(() => {});
  return tarea;
}

function abrirRevisar() {
  const b = estado.borrador;
  if (!b?.paginas.length) { abrirCamara(); return; }
  mostrar('revisar');
  if (!b.formIniciado) {
    b.formIniciado = true;
    $('#f-proveedor').value = '';
    $('#f-importe').value = '';
    $('#f-ref').value = '';
    $('#f-fecha').value = hoy();
    document.querySelectorAll('#rev-form input').forEach((i) => i.classList.remove('auto'));
    b.destino = ajustes().destino;
    b.tocados = new Set();
    pintarSugeridos();
    pintarTipos();
  }
  segmentos($('#rev-filtros'), FILTROS, b.filtro, (v) => { b.filtro = v; pintarPaginas(); });
  segmentos($('#f-destino'), DESTINOS, b.destino, (v) => { b.destino = v; pintarRuta(); });
  pintarPaginas();
  pintarRuta();
  pintarOcr();
  if (ajustes().leerFacturas && !b.ocr) leerFactura(b);
}

// ----------------------------------------------------------------- lectura automática

function proveedoresOrdenados() {
  const cuenta = new Map();
  for (const f of estado.facturas) {
    if (!f.proveedor) continue;
    const c = cuenta.get(f.proveedor) || { n: 0, ult: 0 };
    c.n++;
    c.ult = Math.max(c.ult, f.creado);
    cuenta.set(f.proveedor, c);
  }
  return [...cuenta].sort((a, b) => b[1].n - a[1].n || b[1].ult - a[1].ult).map(([p]) => p);
}

/** Lee la primera página y rellena los campos que el usuario no ha tocado. Nunca bloquea. */
async function leerFactura(b) {
  const pag = b.paginas[0];
  b.ocr = { estado: 'leyendo', pag };
  pintarOcr();
  try {
    await asegurarRender(pag); // primero la vista previa; luego se lee
    const texto = await leerTexto(imagenOcr(pag));
    if (estado.borrador !== b || b.ocr?.pag !== pag) return;
    const r = analizar(texto, { anteriores: proveedoresOrdenados() });
    let rellenos = 0;
    const poner = (campo, sel, valor) => {
      if (valor == null || valor === '' || b.tocados.has(campo)) return;
      const el = $(sel);
      el.value = valor;
      el.classList.add('auto');
      rellenos++;
    };
    poner('proveedor', '#f-proveedor', r.proveedor);
    poner('importe', '#f-importe', r.importe != null ? formatImporte(r.importe) : null);
    poner('fecha', '#f-fecha', r.fecha);
    poner('ref', '#f-ref', r.ref);
    b.ocr.estado = rellenos ? 'hecho' : 'nada';
    window.__czUltimoOcr = { texto, r };
  } catch (e) {
    if (estado.borrador !== b || !b.ocr) return;
    b.ocr.estado = 'error';
    b.ocr.error = e.message;
  }
  pintarOcr();
  pintarTipos();
  pintarRuta();
}

function pintarOcr() {
  const el = $('#f-ocr');
  const o = estado.borrador?.ocr;
  if (!o || !ajustes().leerFacturas) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `ocr-estado ${o.estado}`;
  el.innerHTML = {
    leyendo: `${icon('loader', 'gira')}<span>Leyendo la factura…</span>`,
    hecho: `${icon('wand')}<span>Datos leídos de la factura. Revísalos.</span>`,
    nada: `${icon('wand')}<span>No he sacado datos claros; rellénalos tú.</span>`,
    error: `${icon('alert')}<span>No se pudo leer la factura.</span>`,
  }[o.estado] || '';
}

const ETIQUETA_TIPO = { Envio: 'Envío' };

function pintarTipos() {
  const actual = tipoDe($('#f-proveedor').value);
  $('#f-tipos').innerHTML = TIPO_IDS.map((t) =>
    `<button type="button" class="btn-chip ${t === actual ? 'on' : ''}" data-tipo="${t}">${ETIQUETA_TIPO[t] || t}</button>`).join('');
}

$('#f-tipos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tipo]');
  if (!b || !estado.borrador) return;
  const inp = $('#f-proveedor');
  const tipo = b.dataset.tipo === tipoDe(inp.value) ? null : b.dataset.tipo;
  inp.value = conTipo(inp.value, tipo);
  estado.borrador.tocados.add('proveedor');
  inp.classList.remove('auto');
  pintarTipos();
  pintarRuta();
});

function pintarPaginas() {
  const b = estado.borrador;
  const n = b.paginas.length;
  $('#rev-paginas').innerHTML = b.paginas.map((p, i) => `
    <div class="pagina" data-i="${i}">
      <div class="pagina-img">${p.salida && p.salida.filtro === b.filtro && !p.sucia
        ? `<img src="${p.salida.url}" alt="Página ${i + 1}">` : '<div class="spinner"></div>'}</div>
      <div class="pagina-barra">
        <span class="pagina-num">${i + 1}/${n}</span>
        <button type="button" data-acc="mas" class="mas" aria-label="Añadir página">${icon('plus')}<span>Página</span></button>
        <button type="button" data-acc="girar" aria-label="Girar">${icon('rotate')}</button>
        <button type="button" data-acc="recortar" aria-label="Recortar">${icon('crop')}</button>
        <button type="button" data-acc="borrar" aria-label="Quitar página">${icon('trash')}</button>
      </div>
    </div>`).join('') + `
    <button class="pagina pagina-nueva" type="button" id="rev-mas">${icon('plus')}<span>Añadir página</span></button>`;
  $('#rev-mas').onclick = abrirCamara;
  b.paginas.forEach((p) => {
    asegurarRender(p).then((s) => {
      if (estado.borrador !== b) return;
      const i = b.paginas.indexOf(p);
      const cont = $(`#rev-paginas .pagina[data-i="${i}"] .pagina-img`);
      if (cont && s.filtro === b.filtro) cont.innerHTML = `<img src="${s.url}" alt="Página ${i + 1}">`;
    }, (e) => toast(`Error al procesar: ${e.message}`, 'error'));
  });
}

$('#rev-paginas').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-acc]');
  if (!btn) return;
  const b = estado.borrador;
  const i = +btn.closest('.pagina').dataset.i;
  const p = b.paginas[i];
  if (btn.dataset.acc === 'mas') {
    abrirCamara();
  } else if (btn.dataset.acc === 'girar') {
    p.rotacion = (p.rotacion + 1) % 4;
    p.sucia = true;
    pintarPaginas();
  } else if (btn.dataset.acc === 'recortar') {
    abrirRecorte(p, { nueva: false });
  } else if (btn.dataset.acc === 'borrar') {
    b.paginas.splice(i, 1);
    if (p.salida?.url) URL.revokeObjectURL(p.salida.url);
    if (i === 0) b.ocr = null; // se leerá la nueva primera página
    if (!b.paginas.length) abrirCamara(); else abrirRevisar();
  }
});

function pintarSugeridos() {
  const cuenta = new Map();
  for (const f of estado.facturas) {
    if (!f.proveedor) continue;
    const c = cuenta.get(f.proveedor) || { n: 0, ult: 0 };
    c.n++;
    c.ult = Math.max(c.ult, f.creado);
    cuenta.set(f.proveedor, c);
  }
  const orden = [...cuenta].sort((a, b) => b[1].n - a[1].n || b[1].ult - a[1].ult).map(([p]) => p);
  $('#proveedores').innerHTML = orden.map((p) => `<option value="${esc(p)}">`).join('');
  $('#f-sugeridos').innerHTML = orden.slice(0, 8).map((p) => `<button type="button" class="btn-chip">${esc(p)}</button>`).join('');
}
$('#f-sugeridos').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('#f-proveedor').value = b.textContent;
  estado.borrador?.tocados?.add('proveedor');
  $('#f-proveedor').classList.remove('auto');
  pintarTipos();
  pintarRuta();
});
['#f-proveedor', '#f-importe', '#f-fecha', '#f-ref'].forEach((s) => $(s).addEventListener('input', (e) => {
  // Lo que toca el usuario ya no lo sobrescribe la lectura automática.
  estado.borrador?.tocados?.add(e.target.name);
  e.target.classList.remove('auto');
  if (e.target.name === 'proveedor') pintarTipos();
  pintarRuta();
}));

function datosForm() {
  const txtImporte = $('#f-importe').value.trim();
  const importe = parseImporte(txtImporte);
  return {
    proveedor: $('#f-proveedor').value.trim(),
    importe,
    importeInvalido: !!txtImporte && importe == null,
    fecha: $('#f-fecha').value || hoy(),
    ref: $('#f-ref').value.trim(),
  };
}

function pintarRuta() {
  const b = estado.borrador;
  if (!b) return;
  const d = datosForm();
  const nombre = nombreArchivo(d);
  const { y, m } = partesFecha(d.fecha);
  let html;
  if (b.destino === 'movil') {
    html = `${icon('phone')}<div><small>Solo en este móvil</small><b>${esc(nombre)}</b></div>`;
  } else {
    const carpeta = ajustes().carpeta.replace(/^\/+|\/+$/g, '');
    html = `${icon('cloud')}<div><small>${esc(carpeta)} › ${esc(carpetaTrimestre(y, m))} › ${MESES[m]} › Gastos</small><b>${esc(nombre)}</b>
      ${dbx.conectado() ? '' : '<em>Dropbox no está conectado: se subirá cuando lo conectes.</em>'}</div>`;
  }
  $('#f-ruta').innerHTML = html;
}

async function guardarBorrador() {
  const b = estado.borrador;
  const d = datosForm();
  if (d.importeInvalido) { toast('El importe no se entiende', 'error'); $('#f-importe').focus(); return; }
  ocupado('Guardando…');
  try {
    const salidas = [];
    for (const p of b.paginas) salidas.push(await asegurarRender(p));
    const paginas = salidas.map((s) => ({ blob: s.blob, width: s.width, height: s.height }));
    const f = {
      id: db.nuevoId(),
      creado: Date.now(),
      fecha: d.fecha,
      proveedor: d.proveedor,
      ref: d.ref,
      importe: d.importe,
      tipo: 'Gastos',
      destino: b.destino,
      paginas,
      thumb: await miniatura(paginas[0].blob),
      estado: b.destino === 'movil' ? 'local' : 'pendiente',
    };
    await db.guardar(f);
    guardarAjustes({ destino: b.destino });
    navigator.storage?.persist?.().catch(() => {});
    descartarBorrador();
    estado.trimestre = claveTrimestre(f.fecha);
    await cargar();
    mostrar('lista');
    toast(f.destino === 'movil' ? 'Guardada en el móvil' : 'Guardada · subiendo a Dropbox');
    sincronizarYA();
  } catch (e) {
    toast(`No se pudo guardar: ${e.message}`, 'error');
  } finally {
    ocupado('');
  }
}

function descartarBorrador() {
  estado.borrador?.paginas.forEach((p) => p.salida?.url && URL.revokeObjectURL(p.salida.url));
  estado.borrador = null;
}

$('#rev-guardar').addEventListener('click', guardarBorrador);
$('#rev-form').addEventListener('submit', (e) => { e.preventDefault(); guardarBorrador(); });
$('#rev-descartar').addEventListener('click', async () => {
  const ok = await confirmar({ titulo: '¿Descartar este escaneo?', texto: 'Las páginas no se guardarán.', ok: 'Descartar', peligro: true });
  if (!ok) return;
  descartarBorrador();
  mostrar('lista');
});

// ================================================================= detalle

async function abrirDetalle(id) {
  estado.detalle = id;
  await pintarDetalle(id, true);
}

async function pintarDetalle(id, cambiarVista) {
  const f = await db.obtener(id);
  if (!f) { mostrar('lista'); return; }
  if (cambiarVista) mostrar('detalle');
  liberarUrls('detalle');
  $('#det-titulo').textContent = f.proveedor || 'Factura';
  const e = estadoDe(f);
  $('#det-paginas').innerHTML = f.paginas?.length
    ? f.paginas.map((p, i) => `<img src="${url('detalle', p.blob)}" alt="Página ${i + 1}" class="det-pagina">`).join('')
    : `<div class="solo-nube"><img src="${f.thumb ? url('detalle', f.thumb) : ''}" alt=""><p>${icon('cloudCheck')}Está guardada solo en Dropbox.</p></div>`;
  const fila = (k, v, cls = '') => (v ? `<div class="fila ${cls}"><span>${k}</span><b>${v}</b></div>` : '');
  $('#det-info').innerHTML = `
    <div class="det-estado ${e.cls}">${icon(e.ico)}<span>${esc(e.txt)}</span></div>
    ${fila('Fecha', fechaLarga(f.fecha))}
    ${fila('Importe', euros(f.importe))}
    ${fila('Referencia', esc(f.ref))}
    ${fila('Páginas', f.paginas?.length ? String(f.paginas.length) : '')}
    ${fila('Archivo', esc(nombreArchivo(f)), 'mono')}
    ${f.rutaDropbox ? fila('En Dropbox', esc(f.rutaDropbox), 'mono') : ''}`;

  const acc = [];
  if (f.paginas?.length) acc.push(['compartir', 'share', 'Compartir PDF', 'primario']);
  if (f.estado === 'subida' && f.rutaDropbox) acc.push(['abrir', 'external', 'Abrir en Dropbox']);
  if (necesitaSubida(f) && dbx.conectado()) acc.push(['reintentar', 'cloudUp', 'Subir ahora']);
  if (f.destino === 'movil') acc.push(['subir', 'cloudUp', 'Subir también a Dropbox']);
  acc.push(['borrar', 'trash', 'Eliminar de la app', 'peligro']);
  $('#det-acciones').innerHTML = acc.map(([k, ic, t, cls = '']) =>
    `<button type="button" class="accion ${cls}" data-acc="${k}">${icon(ic)}<span>${t}</span></button>`).join('');
}

$('#det-volver').addEventListener('click', () => { estado.detalle = null; mostrar('lista'); });
$('#det-acciones').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acc]');
  if (!b) return;
  const f = await db.obtener(estado.detalle);
  if (!f) return;
  switch (b.dataset.acc) {
    case 'compartir': {
      await compartirArchivo(await pdfDe(f), nombreArchivo(f));
      break;
    }
    case 'abrir': {
      window.open(dbx.enlaceWeb(f.rutaDropbox), '_blank');
      break;
    }
    case 'reintentar':
      await db.actualizar(f.id, { estado: 'pendiente' });
      await sincronizarYA();
      break;
    case 'subir':
      await db.actualizar(f.id, { destino: 'ambos', estado: 'pendiente' });
      if (!dbx.conectado()) toast('Se subirá cuando conectes Dropbox');
      await pintarDetalle(f.id, false);
      sincronizarYA();
      break;
    case 'borrar': {
      const ok = await confirmar({
        titulo: '¿Eliminar esta factura?',
        texto: f.estado === 'subida' ? 'Se borra de CamZcammer. La copia de Dropbox no se toca.' : 'Se borra del móvil y no se puede deshacer.',
        ok: 'Eliminar',
        peligro: true,
      });
      if (!ok) return;
      await db.borrar(f.id);
      estado.detalle = null;
      await cargar();
      mostrar('lista');
      toast('Eliminada');
      break;
    }
    default:
  }
});

$('#det-editar').addEventListener('click', async () => {
  const f = await db.obtener(estado.detalle);
  if (!f) return;
  abrirHoja(`
    <h2 class="hoja-titulo">Editar datos</h2>
    <form id="ed-form" class="form" autocomplete="off">
      <label class="campo"><span>Proveedor</span><input name="proveedor" value="${esc(f.proveedor)}" list="proveedores" autocapitalize="words"></label>
      <div class="fila-campos">
        <label class="campo"><span>Importe €</span><input name="importe" inputmode="decimal" value="${f.importe != null ? formatImporte(f.importe) : ''}"></label>
        <label class="campo"><span>Fecha</span><input name="fecha" type="date" value="${f.fecha}" required></label>
      </div>
      <label class="campo"><span>Referencia</span><input name="ref" value="${esc(f.ref)}"></label>
      ${f.estado === 'subida' ? '<p class="nota">Ya está en Dropbox: se renombrará (o moverá de carpeta) allí también.</p>' : ''}
      <div class="hoja-botones">
        <button class="btn-secundario" type="button" data-cerrar>Cancelar</button>
        <button class="btn-primario" type="submit">Guardar</button>
      </div>
    </form>`, (h) => {
    h.querySelector('[data-cerrar]').onclick = cerrarHoja;
    h.querySelector('#ed-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const txt = String(fd.get('importe')).trim();
      const importe = parseImporte(txt);
      if (txt && importe == null) { toast('El importe no se entiende', 'error'); return; }
      const nuevo = {
        proveedor: String(fd.get('proveedor')).trim(),
        importe,
        fecha: String(fd.get('fecha')) || f.fecha,
        ref: String(fd.get('ref')).trim(),
      };
      ocupado('Guardando…');
      try {
        if (f.estado === 'subida' && f.rutaDropbox) {
          const destino = rutaDropbox(ajustes().carpeta, { ...f, ...nuevo });
          if (destino.toLowerCase() !== f.rutaDropbox.toLowerCase()) {
            if (!dbx.conectado()) throw new Error('Conecta Dropbox para renombrar el archivo allí');
            nuevo.rutaDropbox = await dbx.mover(f.rutaDropbox, destino);
          }
        }
        await db.actualizar(f.id, nuevo);
        cerrarHoja();
        await cargar();
        await pintarDetalle(f.id, false);
        toast('Actualizada');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        ocupado('');
      }
    };
  });
});

// ================================================================= compartir y exportar

async function compartirArchivo(blob, nombre) {
  const file = new File([blob], nombre, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotAllowedError') {
        // El navegador perdió el "gesto" del usuario mientras se generaba el PDF.
        abrirHoja(`
          <h2 class="hoja-titulo">PDF listo</h2>
          <p class="hoja-texto">${esc(nombre)}</p>
          <div class="hoja-botones"><button class="btn-primario ancho" type="button" id="h-compartir">${icon('share')}Compartir</button></div>`,
        (h) => {
          h.querySelector('#h-compartir').onclick = () => {
            navigator.share({ files: [file] }).catch(() => {});
            cerrarHoja();
          };
        });
        return;
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

async function exportarTrimestre(lista) {
  const conPaginas = [...lista].filter((f) => f.paginas?.length).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado - b.creado);
  const soloNube = lista.length - conPaginas.length;
  const [y, q] = estado.trimestre.split('-T');
  abrirHoja(`
    <h2 class="hoja-titulo">Exportar T${q} ${y}</h2>
    <p class="hoja-texto">Un único PDF con las ${conPaginas.length} facturas que hay en el móvil, ordenadas por fecha.
      ${soloNube ? `<br><br>${soloNube} ${soloNube === 1 ? 'está' : 'están'} solo en Dropbox y no se incluye${soloNube === 1 ? '' : 'n'}: ya ${soloNube === 1 ? 'está' : 'están'} en su carpeta.` : ''}</p>
    <div class="hoja-botones">
      <button class="btn-secundario" type="button" data-cerrar>Cancelar</button>
      <button class="btn-primario" type="button" id="h-exportar" ${conPaginas.length ? '' : 'disabled'}>${icon('share')}Compartir PDF</button>
    </div>`, (h) => {
    h.querySelector('[data-cerrar]').onclick = cerrarHoja;
    h.querySelector('#h-exportar').onclick = async () => {
      const paginas = [];
      for (const f of conPaginas) {
        for (const p of f.paginas) paginas.push({ jpeg: new Uint8Array(await p.blob.arrayBuffer()), width: p.width, height: p.height });
      }
      const nombre = `Gastos T${q} ${y}.pdf`;
      const blob = new Blob([crearPdf(paginas, { title: nombre.slice(0, -4) })], { type: 'application/pdf' });
      cerrarHoja();
      await compartirArchivo(blob, nombre);
    };
  });
}

// ================================================================= ajustes

async function abrirAjustes() {
  const a = ajustes();
  const cuenta = dbx.cuentaGuardada();
  let uso = '';
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) uso = `${(e.usage / 1048576).toFixed(1)} MB usados`;
    const persist = await navigator.storage?.persisted?.();
    if (persist) uso += ' · protegido';
  } catch { /* opcional */ }
  const n = estado.facturas.length;

  abrirHoja(`
    <h2 class="hoja-titulo">Ajustes</h2>

    <div class="grupo">
      <div class="grupo-titulo">Dropbox</div>
      ${dbx.conectado() ? `
        <div class="dbx-ok">${icon('cloudCheck')}<div><b>Conectado</b><small>${esc(cuenta?.email || cuenta?.nombre || '')}</small></div>
          <button type="button" class="btn-texto peligro" id="aj-desconectar">Desconectar</button></div>`
      : `
        <button type="button" class="btn-primario ancho" id="aj-conectar" ${dbx.appKey() ? '' : 'disabled'}>${icon('cloud')}Conectar Dropbox</button>
        ${dbx.appKey() ? '' : '<p class="nota">Falta la App key (abajo, en Avanzado).</p>'}
        <details class="mini">
          <summary>¿Dropbox te ha dado un código?</summary>
          <div class="fila-codigo"><input id="aj-codigo" placeholder="Pega el código"><button type="button" class="btn-secundario" id="aj-usar">Usar</button></div>
        </details>`}
      <label class="campo"><span>Carpeta</span><input id="aj-carpeta" value="${esc(a.carpeta)}" autocapitalize="off" spellcheck="false"></label>
      <p class="nota">Dentro: «Trimestre año / Mes / Gastos», como ya las tienes.</p>
    </div>

    <div class="grupo">
      <div class="grupo-titulo">Por defecto</div>
      <div class="campo"><span>Guardar en</span><div class="segmentos destino" id="aj-destino"></div></div>
      <div class="campo"><span>Filtro</span><div class="segmentos filtros" id="aj-filtro"></div></div>
      <label class="interruptor"><span>Abrir directamente la cámara</span><input type="checkbox" id="aj-camara" ${a.empezarEnCamara ? 'checked' : ''}><i></i></label>
      <label class="interruptor"><span>Usar la cámara del iPhone<small>Máxima resolución y flash real</small></span><input type="checkbox" id="aj-nativa" ${a.camaraNativa ? 'checked' : ''}><i></i></label>
      <label class="interruptor"><span>Disparo automático<small>Hace la foto cuando la factura está quieta</small></span><input type="checkbox" id="aj-auto" ${a.autoDisparo ? 'checked' : ''}><i></i></label>
      <label class="interruptor"><span>Leer los datos de la factura<small>Proveedor, tipo, importe, fecha y nº, sin salir del móvil</small></span><input type="checkbox" id="aj-ocr" ${a.leerFacturas ? 'checked' : ''}><i></i></label>
      <label class="interruptor"><span>Revisar siempre el recorte</span><input type="checkbox" id="aj-recorte" ${a.confirmarRecorte ? 'checked' : ''}><i></i></label>
    </div>

    <div class="grupo">
      <div class="grupo-titulo">Este móvil</div>
      <div class="fila"><span>Facturas</span><b>${n}</b></div>
      ${uso ? `<div class="fila"><span>Espacio</span><b>${uso}</b></div>` : ''}
    </div>

    <details class="grupo mini">
      <summary>Avanzado</summary>
      <label class="campo"><span>App key de Dropbox</span><input id="aj-appkey" value="${esc(dbx.appKey())}" autocapitalize="off" spellcheck="false"></label>
      <div class="fila mono"><span>Redirect URI</span><b>${esc(dbx.redirectUri())}</b></div>
      <div class="fila"><span>Versión</span><b>${VERSION}</b></div>
    </details>
    <button type="button" class="btn-secundario ancho" data-cerrar>Cerrar</button>
  `, (h) => {
    h.querySelector('[data-cerrar]').onclick = cerrarHoja;
    segmentos(h.querySelector('#aj-destino'), DESTINOS, a.destino, (v) => guardarAjustes({ destino: v }));
    segmentos(h.querySelector('#aj-filtro'), FILTROS, a.filtro, (v) => guardarAjustes({ filtro: v }));
    h.querySelector('#aj-camara').onchange = (e) => guardarAjustes({ empezarEnCamara: e.target.checked });
    h.querySelector('#aj-ocr').onchange = (e) => guardarAjustes({ leerFacturas: e.target.checked });
    h.querySelector('#aj-nativa').onchange = (e) => guardarAjustes({ camaraNativa: e.target.checked });
    h.querySelector('#aj-auto').onchange = (e) => guardarAjustes({ autoDisparo: e.target.checked });
    h.querySelector('#aj-recorte').onchange = (e) => guardarAjustes({ confirmarRecorte: e.target.checked });
    h.querySelector('#aj-carpeta').onchange = (e) => {
      const v = e.target.value.trim() || '/FACTURAS';
      guardarAjustes({ carpeta: v.startsWith('/') ? v : `/${v}` });
    };
    h.querySelector('#aj-appkey').onchange = (e) => { dbx.setAppKey(e.target.value); cerrarHoja(); abrirAjustes(); };
    h.querySelector('#aj-conectar')?.addEventListener('click', () => dbx.iniciarConexion().catch((e) => toast(e.message, 'error')));
    h.querySelector('#aj-usar')?.addEventListener('click', async () => {
      const code = h.querySelector('#aj-codigo').value.trim();
      if (!code) return;
      ocupado('Conectando…');
      try {
        await dbx.canjearCodigo(code);
        cerrarHoja();
        toast('Dropbox conectado');
        await cargar();
        sincronizarYA();
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        ocupado('');
      }
    });
    h.querySelector('#aj-desconectar')?.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: '¿Desconectar Dropbox?', texto: 'Las facturas pendientes esperarán en el móvil.', ok: 'Desconectar', peligro: true });
      if (!ok) return;
      await dbx.desconectar();
      await cargar();
      toast('Dropbox desconectado');
    });
  });
}

function mostrarCodigo(codigo) {
  abrirHoja(`
    <h2 class="hoja-titulo">Un paso más</h2>
    <p class="hoja-texto">Dropbox ha vuelto aquí en vez de a la app. Copia este código, abre CamZcammer desde la pantalla de inicio y pégalo en <b>Ajustes → Dropbox</b>.</p>
    <div class="codigo">${esc(codigo)}</div>
    <div class="hoja-botones"><button class="btn-primario ancho" type="button" id="h-copiar">Copiar código</button></div>`, (h) => {
    h.querySelector('#h-copiar').onclick = async () => {
      try { await navigator.clipboard.writeText(codigo); toast('Copiado'); } catch { toast('Mantén pulsado el código para copiarlo', 'error'); }
    };
  });
}

// ================================================================= arranque

function iconosFijos() {
  $('#btn-ajustes').innerHTML = icon('settings');
  $('#t-prev').innerHTML = icon('left');
  $('#t-next').innerHTML = icon('right');
  $('#btn-escanear').innerHTML = `${icon('camera')}<span>Escanear</span>`;
  $('#btn-galeria').innerHTML = icon('image');
  $('#cam-cerrar').innerHTML = icon('x');
  $('#cam-galeria').innerHTML = icon('image');
  $('#rec-detectar').innerHTML = icon('wand');
  $('#rev-descartar').innerHTML = icon('x');
  $('#det-volver').innerHTML = icon('back');
  $('#det-editar').innerHTML = icon('edit');
}

function eventosFijos() {
  $('#btn-ajustes').onclick = abrirAjustes;
  $('#chip-sync').onclick = () => (dbx.conectado() && estado.facturas.some(necesitaSubida) ? sincronizarYA() : abrirAjustes());
  $('#t-prev').onclick = () => moverTrimestre(-1);
  $('#t-next').onclick = () => moverTrimestre(1);
  $('#btn-escanear').onclick = abrirCamara;
  $('#btn-galeria').onclick = () => {
    if (!estado.borrador) estado.borrador = { paginas: [], filtro: ajustes().filtro };
    elegirArchivo(false);
  };
  $('#cam-cerrar').onclick = () => {
    if (estado.borrador?.paginas.length) { abrirRevisar(); return; }
    descartarBorrador();
    mostrar('lista');
  };
  $('#cam-flash').onclick = async () => {
    if (camara.tieneLinterna && await camara.setLinterna(!camara.linterna)) { pintarFlash(); return; }
    // Safari no deja encender la linterna desde la web: la cámara del iPhone sí tiene flash.
    toast('Abriendo la cámara del iPhone, que tiene flash');
    elegirArchivo(true);
  };
  $('#cam-auto').onclick = () => {
    const on = !ajustes().autoDisparo;
    guardarAjustes({ autoDisparo: on });
    pintarAuto();
    toast(on ? 'Disparo automático: mantén la factura quieta' : 'Disparo automático desactivado');
  };
  $('#cam-galeria').onclick = () => elegirArchivo(false);
  $('#cam-disparar').onclick = disparar;
  $('#cam-listo').onclick = abrirRevisar;

  window.addEventListener('online', sincronizarYA);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    sincronizarYA();
    if (estado.vista === 'camara' && !camara.stream) abrirCamara();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && estado.facturas.some(necesitaSubida)) sincronizarYA();
  }, 60_000);
}

async function iniciar() {
  iconosFijos();
  eventosFijos();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  let retorno = null;
  try { retorno = await dbx.manejarRetorno(); } catch (e) { retorno = { error: e.message }; }
  await cargar();
  mostrar('lista');

  detector = new Detector();

  if (retorno?.ok) toast('Dropbox conectado');
  else if (retorno?.codigo) mostrarCodigo(retorno.codigo);
  else if (retorno?.error) toast(`Dropbox: ${retorno.error}`, 'error');
  else if (ajustes().empezarEnCamara && !ajustes().camaraNativa) abrirCamara();

  if (dbx.conectado() && !dbx.cuentaGuardada()) dbx.cuenta().catch(() => {});
  // El lector de texto se descarga en segundo plano para que esté listo al escanear.
  if (ajustes().leerFacturas) setTimeout(precargar, 2500);
  sincronizarYA();
}

iniciar();

// Acceso para pruebas automáticas.
window.__cz = { estado, abrirCamara, abrirRevisar, nuevaFoto, sincronizarYA, get detector() { return detector; }, get rec() { return rec; }, reducir };
