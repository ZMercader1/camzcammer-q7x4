// Detección del documento con OpenCV. Script clásico: lo carga el worker con importScripts
// y los tests con require, por eso no usa import/export.
//
// 1) Candidatos: cuadriláteros formados con las líneas rectas más fuertes de la imagen
//    (Hough), más los contornos con forma de hoja (por brillo y por bordes).
// 2) Cada candidato se puntúa por "soporte de borde": qué parte de cada uno de sus 4 lados
//    coincide con un borde real de la foto. Un papel tiene borde en todo su contorno; una
//    forma casual de la calle no. Así sirve igual para papel claro que para un cartel oscuro.
// 3) Se descartan formas imposibles (ángulos, proporciones) y las que tocan dos bordes de la
//    foto (postes, paredes, el propio marco).

/* eslint-disable no-var */
var detectarDocumento = (function () {
  function angulo(a, b, c) {
    var v1x = a.x - b.x; var v1y = a.y - b.y;
    var v2x = c.x - b.x; var v2y = c.y - b.y;
    var cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  }

  function ordenar(pts) {
    var cx = 0; var cy = 0;
    pts.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
    var s = pts.slice().sort(function (a, b) {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
    var k = 0; var best = Infinity;
    s.forEach(function (p, i) { if (p.x + p.y < best) { best = p.x + p.y; k = i; } });
    return [0, 1, 2, 3].map(function (i) { return s[(k + i) % 4]; });
  }

  function areaQuad(q) {
    var a = 0;
    for (var i = 0; i < 4; i++) { var p = q[i]; var n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; }
    return Math.abs(a) / 2;
  }

  /** Forma plausible de un papel visto con algo de perspectiva, entero dentro de la foto. */
  function formaValida(q, w, h) {
    var lados = [];
    for (var i = 0; i < 4; i++) {
      var ang = angulo(q[(i + 3) % 4], q[i], q[(i + 1) % 4]);
      if (!(ang >= 55 && ang <= 125)) return false;
      lados.push(Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y));
    }
    var r1 = Math.min(lados[0], lados[2]) / Math.max(lados[0], lados[2]);
    var r2 = Math.min(lados[1], lados[3]) / Math.max(lados[1], lados[3]);
    if (r1 < 0.55 || r2 < 0.55) return false;
    var ancho = (lados[0] + lados[2]) / 2;
    var alto = (lados[1] + lados[3]) / 2;
    if (Math.max(ancho, alto) / Math.min(ancho, alto) > 4.5) return false;
    if (Math.min(ancho, alto) < Math.min(w, h) * 0.1) return false;
    var m = Math.max(w, h) * 0.015;
    var fuera = 0;
    for (var j = 0; j < 4; j++) {
      var p = q[j];
      if (p.x < -m || p.y < -m || p.x > w - 1 + m || p.y > h - 1 + m) return false;
      if (p.x < m || p.y < m || p.x > w - 1 - m || p.y > h - 1 - m) fuera++;
    }
    return fuera < 2;
  }

  /** Fracción de cada lado que cae sobre un borde (mapa de bordes ya engrosado). */
  function soporte(q, mapa, w) {
    var lados = [];
    for (var i = 0; i < 4; i++) {
      var a = q[i]; var b = q[(i + 1) % 4];
      var n = Math.max(12, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      var hits = 0;
      for (var k = 1; k < n; k++) {
        var x = Math.round(a.x + (b.x - a.x) * k / n);
        var y = Math.round(a.y + (b.y - a.y) * k / n);
        if (mapa[y * w + x]) hits++;
      }
      lados.push(hits / (n - 1));
    }
    return lados;
  }

  /** Recta a·x + b·y = c a partir de un segmento. */
  function recta(x1, y1, x2, y2) {
    var a = y2 - y1; var b = x1 - x2;
    var n = Math.hypot(a, b) || 1;
    a /= n; b /= n;
    return { a: a, b: b, c: a * x1 + b * y1, len: Math.hypot(x2 - x1, y2 - y1), ang: Math.atan2(y2 - y1, x2 - x1) };
  }

  function corte(l1, l2) {
    var det = l1.a * l2.b - l2.a * l1.b;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (l1.c * l2.b - l2.c * l1.b) / det, y: (l1.a * l2.c - l2.a * l1.c) / det };
  }

  return function (cv, img) {
    var w = img.width;
    var h = img.height;
    var area = w * h;
    var mats = [];
    var M = function (m) { mats.push(m); return m; };
    var candidatos = [];
    var añadir = function (pts, origen) {
      var q = ordenar(pts);
      if (formaValida(q, w, h)) candidatos.push({ q: q, origen: origen });
    };

    try {
      var src = M(cv.matFromImageData(img));
      var gray = M(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

      // Bordes con umbral adaptado a la escena (de noche hay poco contraste).
      var hist = new Array(256).fill(0);
      var gd = gray.data;
      for (var i = 0; i < gd.length; i++) hist[gd[i]]++;
      var acc = 0; var mediana = 0;
      for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= gd.length / 2) { mediana = v; break; } }
      var edges = M(new cv.Mat());
      cv.Canny(gray, edges, Math.max(12, mediana * 0.4), Math.max(36, mediana * 1.1));
      var k3 = M(cv.Mat.ones(3, 3, cv.CV_8U));
      var grueso = M(new cv.Mat());
      cv.dilate(edges, grueso, k3, new cv.Point(-1, -1), 1);
      var mapa = grueso.data;

      // 1) Líneas rectas fuertes -> cuadriláteros.
      var lines = M(new cv.Mat());
      var minLen = Math.min(w, h) * 0.08;
      cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 15, minLen, 12);
      var rectas = [];
      // opencv.js devuelve las líneas como 1 x N (no N x 1): se recorre el buffer entero.
      var nLineas = lines.data32S.length / 4;
      for (var li = 0; li < nLineas; li++) {
        var d = lines.data32S.subarray(li * 4, li * 4 + 4);
        var r = recta(d[0], d[1], d[2], d[3]);
        // Fusiona con una recta casi igual ya vista.
        var igual = rectas.find(function (o) {
          var dAng = Math.abs(Math.atan2(Math.sin(o.ang - r.ang), Math.cos(o.ang - r.ang)));
          dAng = Math.min(dAng, Math.PI - dAng);
          var px = (d[0] + d[2]) / 2; var py = (d[1] + d[3]) / 2;
          return dAng < 0.05 && Math.abs(o.a * px + o.b * py - o.c) < 5;
        });
        if (igual) igual.len += r.len; else rectas.push(r);
      }
      var horiz = []; var vert = [];
      rectas.forEach(function (r) {
        var a = Math.abs(Math.atan2(Math.sin(r.ang), Math.cos(r.ang)));
        a = Math.min(a, Math.PI - a); // 0 = horizontal, PI/2 = vertical
        if (a < 0.6) horiz.push(r); else if (a > 0.97) vert.push(r);
      });
      var top = function (arr) { return arr.sort(function (x, y) { return y.len - x.len; }).slice(0, 16); };
      horiz = top(horiz); vert = top(vert);
      for (var h1 = 0; h1 < horiz.length; h1++) for (var h2 = h1 + 1; h2 < horiz.length; h2++) {
        for (var v1 = 0; v1 < vert.length; v1++) for (var v2 = v1 + 1; v2 < vert.length; v2++) {
          var a1 = corte(horiz[h1], vert[v1]); var a2 = corte(horiz[h1], vert[v2]);
          var a3 = corte(horiz[h2], vert[v2]); var a4 = corte(horiz[h2], vert[v1]);
          if (a1 && a2 && a3 && a4) añadir([a1, a2, a3, a4], 'lineas');
        }
      }

      // 2) Contornos: por brillo (Otsu) y por bordes.
      var considerar = function (bin, modo, origen) {
        var contours = new cv.MatVector();
        var hier = new cv.Mat();
        cv.findContours(bin, contours, hier, modo, cv.CHAIN_APPROX_SIMPLE);
        for (var ci = 0; ci < contours.size(); ci++) {
          var c = contours.get(ci);
          if (cv.contourArea(c) >= area * 0.02) {
            var hull = new cv.Mat();
            cv.convexHull(c, hull);
            var peri = cv.arcLength(hull, true);
            var eps = [0.02, 0.035, 0.05];
            for (var e = 0; e < eps.length; e++) {
              var ap = new cv.Mat();
              cv.approxPolyDP(hull, ap, eps[e] * peri, true);
              var ok = ap.rows === 4;
              if (ok) {
                var dd = ap.data32S;
                añadir([0, 1, 2, 3].map(function (j) { return { x: dd[j * 2], y: dd[j * 2 + 1] }; }), origen);
              }
              ap.delete();
              if (ok) break;
            }
            hull.delete();
          }
          c.delete();
        }
        contours.delete();
        hier.delete();
      };
      considerar(grueso, cv.RETR_LIST, 'contorno');
      var th = M(new cv.Mat());
      cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(th, th, cv.MORPH_CLOSE, M(cv.Mat.ones(7, 7, cv.CV_8U)));
      considerar(th, cv.RETR_EXTERNAL, 'brillo');

      // Puntuación: soporte de borde en los 4 lados y tamaño. Se prefiere lo que está en el
      // centro, que es donde se apunta al escanear (sin esto gana cualquier rectángulo del
      // fondo: una ventana, una furgoneta...).
      var centro = { x: w / 2, y: h / 2 };
      var contieneCentro = function (q) {
        var signo = 0;
        for (var i = 0; i < 4; i++) {
          var a = q[i]; var b = q[(i + 1) % 4];
          var cr = (b.x - a.x) * (centro.y - a.y) - (b.y - a.y) * (centro.x - a.x);
          if (cr !== 0) { if (signo && Math.sign(cr) !== signo) return false; signo = Math.sign(cr); }
        }
        return true;
      };
      var mejor = null;
      candidatos.forEach(function (c) {
        var s = soporte(c.q, mapa, w);
        var min = Math.min.apply(null, s);
        var med = (s[0] + s[1] + s[2] + s[3]) / 4;
        if (min < 0.5 || med < 0.7) return;
        var frac = areaQuad(c.q) / area;
        c.soporte = med;
        c.puntuacion = (contieneCentro(c.q) ? 1 : 0.35) * Math.sqrt(frac) * Math.pow(med, 3) * min;
        if (!mejor || c.puntuacion > mejor.puntuacion) mejor = c;
      });

      if (!mejor) return null;
      return {
        puntos: mejor.q.map(function (p) { return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }; }),
        cobertura: areaQuad(mejor.q) / area,
        soporte: mejor.soporte,
        origen: mejor.origen,
      };
    } finally {
      mats.forEach(function (m) { m.delete(); });
    }
  };
})();

if (typeof module !== 'undefined') module.exports = { detectarDocumento: detectarDocumento };
