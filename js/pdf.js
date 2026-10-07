// Escritor de PDF mínimo: una página por imagen JPEG, sin dependencias.
// El JPEG se incrusta tal cual (DCTDecode), así que no se pierde calidad ni hay recompresión.

const A4 = { w: 595.28, h: 841.89 };
const enc = new TextEncoder();

/**
 * @param {{ jpeg: Uint8Array, width: number, height: number }[]} paginas
 * @param {{ title?: string }} [meta]
 * @returns {Uint8Array}
 */
export function crearPdf(paginas, meta = {}) {
  if (!paginas.length) throw new Error('El PDF necesita al menos una página');

  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
    for (const part of [].concat(body)) push(part);
    push('\nendobj\n');
  };

  // Objetos: 1 catálogo, 2 árbol de páginas, 3 info; luego 3 por página.
  const n = paginas.length;
  const pageIds = paginas.map((_, i) => 4 + i * 3);
  const total = 3 + n * 3;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`);
  obj(3, `<< /Producer (CamZcammer) /Title ${pdfString(meta.title || 'Factura')} >>`);

  paginas.forEach((p, i) => {
    const [pageId, contentId, imgId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    // La página tiene la proporción de la imagen y cabe en un A4.
    const escala = Math.min(A4.w / p.width, A4.h / p.height);
    const w = +(p.width * escala).toFixed(2);
    const h = +(p.height * escala).toFixed(2);
    obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(contentId, [`<< /Length ${stream.length} >>\nstream\n`, stream, '\nendstream']);
    obj(imgId, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });

  const xref = pos;
  let tabla = `xref\n0 ${total + 1}\n0000000000 65535 f\r\n`;
  for (let i = 1; i <= total; i++) tabla += `${String(offsets[i]).padStart(10, '0')} 00000 n\r\n`;
  push(tabla);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Cadena PDF en UTF-16BE para que tildes y eñes salgan bien en el título. */
function pdfString(texto) {
  let hex = 'FEFF';
  for (const ch of texto) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) continue;
    hex += code.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}
