// Cámara, detección en segundo plano y paso de foto a página final.

import { enderezar, rotar, filtrar, tamanoSalida, ordenarEsquinas, encoger } from './image.js';

const MAX_ORIGINAL = 3000; // lado mayor de la foto con la que se trabaja
const MAX_PAGINA = 2200; // lado mayor de la página final (~190 ppp en A4)
const MAX_DETECCION = 480;

// ---------------------------------------------------------------- utilidades de canvas

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Dibuja una fuente (vídeo, imagen, canvas) reducida para que su lado mayor sea <= max. */
export function reducir(fuente, fw, fh, max) {
  const s = Math.min(1, max / Math.max(fw, fh));
  const c = canvas(Math.round(fw * s), Math.round(fh * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente, 0, 0, c.width, c.height);
  return c;
}

const imageData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);

function aCanvas(img) {
  const c = canvas(img.width, img.height);
  const id = img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height);
  c.getContext('2d').putImageData(id, 0, 0);
  return c;
}

export const aBlob = (c, calidad = 0.85) =>
  new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), 'image/jpeg', calidad));

/** Carga una foto de archivo respetando la orientación EXIF (el <img> la aplica solo). */
export async function cargarArchivo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return reducir(img, img.naturalWidth, img.naturalHeight, MAX_ORIGINAL);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- detector (worker)

export class Detector {
  constructor() {
    this.listo = false;
    this.fallo = null;
    this.pendientes = new Map();
    this.siguiente = 1;
    this.worker = new Worker('js/detect-worker.js');
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'ready') { this.listo = true; this.onListo?.(); return; }
      if (data.type === 'error') { this.fallo = data.message; return; }
      const p = this.pendientes.get(data.id);
      if (!p) return;
      this.pendientes.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
    };
    this.worker.onerror = (e) => { this.fallo = e.message || 'worker'; };
  }

  /** Detecta sobre una fuente de cualquier tamaño y devuelve las esquinas en sus coordenadas. */
  async detectar(fuente, fw, fh, max = MAX_DETECCION) {
    const small = reducir(fuente, fw, fh, max);
    const escala = fw / small.width;
    const id = this.siguiente++;
    const img = imageData(small);
    const res = await new Promise((resolve, reject) => {
      this.pendientes.set(id, { resolve, reject });
      this.worker.postMessage({ id, image: img }, [img.data.buffer]);
    });
    if (!res) return null;
    return {
      cobertura: res.cobertura,
      puntos: ordenarEsquinas(res.puntos.map((p) => ({ x: p.x * escala, y: p.y * escala }))),
    };
  }
}

export const marcoCompleto = (w, h, margen = 0) => [
  { x: w * margen, y: h * margen },
  { x: w * (1 - margen), y: h * margen },
  { x: w * (1 - margen), y: h * (1 - margen) },
  { x: w * margen, y: h * (1 - margen) },
];

// ---------------------------------------------------------------- cámara

export class Camara {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.linterna = false;
  }

  async iniciar() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no da acceso a la cámara');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    // Enfoque continuo donde se pueda; no todos los navegadores lo exponen.
    try {
      const caps = this.track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* opcional */ }
  }

  get tieneLinterna() {
    try { return !!this.track?.getCapabilities?.().torch; } catch { return false; }
  }

  async setLinterna(on) {
    if (!this.track) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      this.linterna = on;
      return true;
    } catch {
      return false;
    }
  }

  detener() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.linterna = false;
    this.video.srcObject = null;
  }

  /** Foto a máxima resolución del vídeo. */
  capturar() {
    const v = this.video;
    return reducir(v, v.videoWidth, v.videoHeight, MAX_ORIGINAL);
  }
}

// ---------------------------------------------------------------- páginas

/**
 * Página en edición: { original: canvas, quad: [4 puntos], rotacion: 0..3,
 *   enderezada?: ImageData (caché sin filtro), salida?: { blob, width, height, url } }
 */
export function nuevaPagina(original, quad) {
  return { original, quad, rotacion: 0 };
}

/** Endereza (con caché), gira y filtra. Devuelve la página final en JPEG. */
export async function renderizar(p, filtro) {
  if (!p.enderezada) {
    const quad = encoger(p.quad, 0.012);
    p.enderezada = enderezar(imageData(p.original), quad, tamanoSalida(quad, MAX_PAGINA));
  }
  const img = filtrar(rotar(p.enderezada, p.rotacion), filtro);
  const c = aCanvas(img);
  const blob = await aBlob(c, filtro === 'documento' ? 0.8 : 0.85);
  if (p.salida?.url) URL.revokeObjectURL(p.salida.url);
  p.salida = { blob, width: c.width, height: c.height, url: URL.createObjectURL(blob), filtro };
  return p.salida;
}

/** Página preparada para leer texto: gris limpio, margen blanco y tamaño moderado. */
export function imagenOcr(p) {
  if (!p.enderezada) {
    const quad = encoger(p.quad, 0.012);
    p.enderezada = enderezar(imageData(p.original), quad, tamanoSalida(quad, MAX_PAGINA));
  }
  const img = aCanvas(filtrar(rotar(p.enderezada, p.rotacion), 'gris'));
  const s = Math.min(1, 1600 / img.width);
  const margen = 30;
  const c = canvas(Math.round(img.width * s) + margen * 2, Math.round(img.height * s) + margen * 2);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, margen, margen, c.width - margen * 2, c.height - margen * 2);
  return c;
}

export async function miniatura(blob, max = 240) {
  const bmp = await createImageBitmap(blob);
  const c = reducir(bmp, bmp.width, bmp.height, max);
  bmp.close?.();
  return aBlob(c, 0.75);
}
