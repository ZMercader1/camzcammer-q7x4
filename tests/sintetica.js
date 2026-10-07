// Genera una "foto" sintética: mesa oscura con ruido, una hoja girada en perspectiva,
// con líneas de texto y una sombra de iluminación de izquierda a derecha.

export const HOJA = [{ x: 140, y: 90 }, { x: 600, y: 140 }, { x: 560, y: 760 }, { x: 90, y: 700 }];

function dentro(q, x, y) {
  // Convexo y en orden horario (en coordenadas de pantalla): todos los productos cruzados >= 0.
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

export function fotoSintetica(w = 720, h = 860, hoja = HOJA) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // Coordenadas "de papel" aproximadas para pintar texto en filas.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const luz = 0.65 + 0.35 * (x / w);
      let v;
      let r;
      let g;
      let b;
      if (dentro(hoja, x, y)) {
        // Fila de texto: franjas horizontales oscuras cada 28 px dentro de la hoja.
        const fila = (y - 120) % 28;
        const enTexto = y > 160 && y < 650 && fila >= 0 && fila < 7 && x > 170 && x < 520 && (x % 23) < 17;
        v = enTexto ? 40 : 235;
        r = g = b = v * luz;
      } else {
        v = 60 + rnd() * 25;
        r = v * 0.9; g = v * 0.75; b = v * 0.6;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}
