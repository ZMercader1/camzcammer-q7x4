// Procesado de imagen en JS puro sobre objetos tipo ImageData ({ data, width, height }).
// Enderezado por perspectiva y filtros de documento. No depende del DOM, así que se testea en Node.

const nuevo = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

// ---------------------------------------------------------------- geometría

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Ordena 4 puntos como [arriba-izq, arriba-der, abajo-der, abajo-izq]. */
export function ordenarEsquinas(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const ang = (p) => Math.atan2(p.y - cy, p.x - cx);
  // Orden horario empezando por el que está arriba-izquierda.
  const sorted = [...pts].sort((a, b) => ang(a) - ang(b));
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => { if (p.x + p.y < best) { best = p.x + p.y; start = i; } });
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
}

/** Tamaño de salida natural para un cuadrilátero [tl, tr, br, bl], limitado a `max` px. */
export function tamanoSalida(q, max = 2200) {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Homografía 3x3 (array de 9, h33 = 1) que lleva src[i] -> dst[i]. */
export function homografia(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Eliminación gaussiana con pivoteo parcial sobre la matriz aumentada 8x9.
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) throw new Error('Esquinas degeneradas');
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

export function aplicarH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

/**
 * Mete el cuadrilátero hacia dentro una fracción `m` de su tamaño (en su propia perspectiva).
 * Así el borde de la mesa que roza las esquinas no aparece como una raya negra en la página.
 */
export function encoger(q, m) {
  const H = homografia([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], q);
  return [[m, m], [1 - m, m], [1 - m, 1 - m], [m, 1 - m]].map(([u, v]) => aplicarH(H, u, v));
}

/** Endereza el cuadrilátero `q` de `src` en una imagen rectangular de tamaño `out`. */
export function enderezar(src, q, out = tamanoSalida(q)) {
  const { width: W, height: H } = out;
  const rect = [{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 }];
  const M = homografia(rect, q); // destino -> origen (mapeo inverso)
  const dst = nuevo(W, H);
  const s = src.data;
  const d = dst.data;
  const sw = src.width;
  const maxX = src.width - 1;
  const maxY = src.height - 1;
  let o = 0;
  for (let y = 0; y < H; y++) {
    // Avance incremental del numerador/denominador a lo largo de la fila.
    let nx = M[1] * y + M[2];
    let ny = M[4] * y + M[5];
    let nw = M[7] * y + M[8];
    for (let x = 0; x < W; x++, o += 4, nx += M[0], ny += M[3], nw += M[6]) {
      let fx = nx / nw;
      let fy = ny / nw;
      if (fx < 0) fx = 0; else if (fx > maxX) fx = maxX;
      if (fy < 0) fy = 0; else if (fy > maxY) fy = maxY;
      const x0 = fx | 0;
      const y0 = fy | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax;
        const bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
        d[o + c] = top + (bot - top) * ay;
      }
      d[o + 3] = 255;
    }
  }
  return dst;
}

/** Gira 90º * vueltas en sentido horario. */
export function rotar(img, vueltas) {
  const v = ((vueltas % 4) + 4) % 4;
  if (v === 0) return img;
  const { width: w, height: h, data: s } = img;
  const out = v === 2 ? nuevo(w, h) : nuevo(h, w);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (v === 1) { nx = h - 1 - y; ny = x; } else if (v === 2) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; }
      const si = (y * w + x) * 4;
      const di = (ny * out.width + nx) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- filtros

export const FILTROS = {
  documento: 'B/N nítido',
  gris: 'Gris',
  color: 'Color',
  original: 'Original',
};

function luminancia(img) {
  const n = img.width * img.height;
  const g = new Uint8ClampedArray(n);
  const s = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (s[j] * 77 + s[j + 1] * 150 + s[j + 2] * 29) >> 8;
  return g;
}

/** Suma por ventana cuadrada con imagen integral. Devuelve la media de cada píxel. */
function mediaLocal(g, w, h, radio) {
  const iw = w + 1;
  const integ = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) {
      fila += g[y * w + x];
      integ[(y + 1) * iw + x + 1] = integ[y * iw + x + 1] + fila;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radio);
    const y1 = Math.min(h, y + radio + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radio);
      const x1 = Math.min(w, x + radio + 1);
      const sum = integ[y1 * iw + x1] - integ[y0 * iw + x1] - integ[y1 * iw + x0] + integ[y0 * iw + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Estima el "papel" (iluminación de fondo) de un canal: se reduce la imagen, se borran
 * los trazos oscuros con un filtro de máximo y se suaviza. El resultado, a resolución
 * completa, es lo que habría si la hoja estuviera en blanco.
 */
function fondo(canal, w, h) {
  const f = Math.max(1, Math.round(Math.max(w, h) / 160));
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  let small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      // Máximo del bloque: el papel es lo más claro.
      let m = 0;
      const yy1 = Math.min(h, (y + 1) * f);
      const xx1 = Math.min(w, (x + 1) * f);
      for (let yy = y * f; yy < yy1; yy++) for (let xx = x * f; xx < xx1; xx++) {
        const v = canal[yy * w + xx];
        if (v > m) m = v;
      }
      small[y * sw + x] = m;
    }
  }
  // Dilatación (máximo 3x3) para tapar el texto grueso.
  for (let it = 0; it < 3; it++) {
    const next = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(sh - 1, Math.max(0, y + dy));
        const xx = Math.min(sw - 1, Math.max(0, x + dx));
        const v = small[yy * sw + xx];
        if (v > m) m = v;
      }
      next[y * sw + x] = m;
    }
    small = next;
  }
  const blur = mediaLocal(small, sw, sh, 4);
  // Ampliación bilineal a tamaño completo.
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = fy | 0;
    const y1 = Math.min(sh - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = fx | 0;
      const x1 = Math.min(sw - 1, x0 + 1);
      const ax = fx - x0;
      const top = blur[y0 * sw + x0] + (blur[y0 * sw + x1] - blur[y0 * sw + x0]) * ax;
      const bot = blur[y1 * sw + x0] + (blur[y1 * sw + x1] - blur[y1 * sw + x0]) * ax;
      out[y * w + x] = Math.max(1, top + (bot - top) * ay);
    }
  }
  return out;
}

/** Valores de corte en los percentiles bajo/alto de un histograma de 0..255. */
function percentiles(valores, bajo, alto) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < valores.length; i++) hist[valores[i]]++;
  const n = valores.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * bajo) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * (1 - alto)) { hi = v; break; } }
  return { lo, hi: Math.max(hi, lo + 1) };
}

/** Normaliza la iluminación: cada píxel / fondo. El papel queda en 255. */
function normalizar(g, w, h) {
  const bg = fondo(g, w, h);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (g[i] / bg[i]) * 255;
  return out;
}

/** Mezcla `base` hacia `top` en proporción k (0 = base, 1 = top), sobre `top`. */
function mezclar(base, top, k) {
  if (k >= 1) return top;
  const b = base.data;
  const t = top.data;
  for (let i = 0; i < t.length; i += 4) {
    t[i] = b[i] + (t[i] - b[i]) * k;
    t[i + 1] = b[i + 1] + (t[i + 1] - b[i + 1]) * k;
    t[i + 2] = b[i + 2] + (t[i + 2] - b[i + 2]) * k;
  }
  return top;
}

/**
 * Aplica un filtro y devuelve una imagen nueva. `intensidad` (0..1) suaviza el efecto:
 *   documento: de gris realzado (0) a blanco y negro puro (1)
 *   gris:      de gris sin tocar (0) a gris realzado (1)
 *   color:     de la foto (0) a color realzado (1)
 */
export function filtrar(img, filtro, intensidad = 1) {
  const k = Math.max(0, Math.min(1, intensidad));
  if (filtro === 'original') return img;
  if (filtro === 'color') return mezclar(img, filtrarPuro(img, 'color'), k);
  if (filtro === 'gris') {
    const base = nuevo(img.width, img.height);
    const g = luminancia(img);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      base.data[j] = base.data[j + 1] = base.data[j + 2] = g[i];
      base.data[j + 3] = 255;
    }
    return mezclar(base, filtrarPuro(img, 'gris'), k);
  }
  if (k >= 1) return filtrarPuro(img, 'documento');
  return mezclar(filtrarPuro(img, 'gris'), filtrarPuro(img, 'documento'), k);
}

function filtrarPuro(img, filtro) {
  const { width: w, height: h } = img;
  const n = w * h;
  const out = nuevo(w, h);
  const d = out.data;

  if (filtro === 'color') {
    // Corrige sombras canal a canal y sube el contraste sin perder el color.
    const s = img.data;
    for (let c = 0; c < 3; c++) {
      const canal = new Uint8ClampedArray(n);
      for (let i = 0; i < n; i++) canal[i] = s[i * 4 + c];
      const norm = normalizar(canal, w, h);
      const { lo } = percentiles(norm, 0.01, 1);
      const k = 255 / (245 - Math.min(lo, 180));
      for (let i = 0; i < n; i++) d[i * 4 + c] = (norm[i] - lo) * k;
    }
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    return out;
  }

  const norm = normalizar(luminancia(img), w, h);

  if (filtro === 'gris') {
    const { lo } = percentiles(norm, 0.005, 1);
    const k = 255 / (235 - Math.min(lo, 170));
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = (norm[i] - lo) * k;
      d[j] = d[j + 1] = d[j + 2] = v;
      d[j + 3] = 255;
    }
    return out;
  }

  // 'documento': blanco y negro con umbral adaptativo. Un píxel es tinta si es claramente
  // más oscuro que su entorno, o muy oscuro en términos absolutos (rellenos y logos).
  const radio = Math.max(7, Math.round(Math.max(w, h) / 70));
  const media = mediaLocal(norm, w, h, radio);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = norm[i];
    // Peso de tinta 0..1 con transición suave para que el texto no quede dentado.
    let t = (media[i] - v - 8) / 10;
    if (v < 110) t = 1;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const val = 255 - t * 235;
    d[j] = d[j + 1] = d[j + 2] = val;
    d[j + 3] = 255;
  }
  return out;
}
