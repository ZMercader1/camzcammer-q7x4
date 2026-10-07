// Detección del documento con OpenCV. Script clásico: lo carga el worker con importScripts
// y los tests con require, por eso no usa import/export.
//
// Se generan candidatos (cuadriláteros convexos grandes) por dos vías, bordes y brillo, y se
// descartan los que no parecen una hoja: ángulos imposibles, lados desproporcionados o un
// interior que no es más claro que su entorno. En calles, marquesinas o pantallas aparecen
// muchos cuadriláteros; sin estos filtros el recuadro salta de uno a otro.

/* eslint-disable no-var */
var detectarDocumento = (function () {
  function angulo(a, b, c) {
    // Ángulo en b, en grados.
    var v1x = a.x - b.x; var v1y = a.y - b.y;
    var v2x = c.x - b.x; var v2y = c.y - b.y;
    var cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  }

  function ordenar(pts) {
    var cx = 0; var cy = 0;
    pts.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
    return pts.slice().sort(function (a, b) {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
  }

  /** Forma plausible de un papel visto con algo de perspectiva. */
  function formaValida(pts, w, h) {
    var q = ordenar(pts);
    var lados = [];
    for (var i = 0; i < 4; i++) {
      var a = q[(i + 3) % 4]; var b = q[i]; var c = q[(i + 1) % 4];
      var ang = angulo(a, b, c);
      if (ang < 55 || ang > 125) return false;
      lados.push(Math.hypot(c.x - b.x, c.y - b.y));
    }
    // Lados opuestos parecidos (la perspectiva no los deforma tanto).
    var r1 = Math.min(lados[0], lados[2]) / Math.max(lados[0], lados[2]);
    var r2 = Math.min(lados[1], lados[3]) / Math.max(lados[1], lados[3]);
    if (r1 < 0.5 || r2 < 0.5) return false;
    // Ni una tira finísima ni algo más alargado que un ticket largo.
    var ancho = (lados[0] + lados[2]) / 2;
    var alto = (lados[1] + lados[3]) / 2;
    var prop = Math.max(ancho, alto) / Math.min(ancho, alto);
    if (prop > 4.5) return false;
    if (Math.min(ancho, alto) < Math.min(w, h) * 0.2) return false;
    return true;
  }

  return function (cv, img) {
    var w = img.width;
    var h = img.height;
    var area = w * h;
    var mats = [];
    var M = function (m) { mats.push(m); return m; };
    var candidatos = [];

    try {
      var src = M(cv.matFromImageData(img));
      var gray = M(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      var k3 = M(cv.Mat.ones(3, 3, cv.CV_8U));
      var k7 = M(cv.Mat.ones(7, 7, cv.CV_8U));

      var considerar = function (bin, origen) {
        var contours = new cv.MatVector();
        var hier = new cv.Mat();
        cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        for (var i = 0; i < contours.size(); i++) {
          var c = contours.get(i);
          var ca = cv.contourArea(c);
          if (ca < area * 0.12) { c.delete(); continue; }
          var hull = new cv.Mat();
          cv.convexHull(c, hull);
          var peri = cv.arcLength(hull, true);
          var eps = [0.015, 0.025, 0.04];
          for (var e = 0; e < eps.length; e++) {
            var ap = new cv.Mat();
            cv.approxPolyDP(hull, ap, eps[e] * peri, true);
            if (ap.rows === 4) {
              var qa = cv.contourArea(ap);
              var d = ap.data32S;
              var pts = [0, 1, 2, 3].map(function (j) { return { x: d[j * 2], y: d[j * 2 + 1] }; });
              // El contorno real debe llenar el cuadrilátero (si no, es una forma rara recortada).
              var lleno = ca / qa;
              if (qa < area * 0.97 && lleno > 0.85 && formaValida(pts, w, h)) {
                candidatos.push({ area: qa, puntos: pts, origen: origen });
              }
              ap.delete();
              break;
            }
            ap.delete();
          }
          hull.delete();
          c.delete();
        }
        contours.delete();
        hier.delete();
      };

      // 1) Bordes, con umbrales adaptados al contraste de la escena.
      var media = cv.mean(gray)[0];
      var edges = M(new cv.Mat());
      cv.Canny(gray, edges, Math.max(20, media * 0.4), Math.max(60, media * 1.0));
      cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 1);
      considerar(edges, 'bordes');

      // 2) Brillo: la hoja suele ser lo más claro. Sirve cuando los bordes están cortados.
      var th = M(new cv.Mat());
      cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(th, th, cv.MORPH_CLOSE, k7);
      considerar(th, 'brillo');

      // Puntuación: tamaño + papel más claro que lo que lo rodea.
      var mejor = null;
      candidatos.forEach(function (cand) {
        var mask = new cv.Mat.zeros(h, w, cv.CV_8U);
        var pts = cv.matFromArray(4, 1, cv.CV_32SC2, [].concat.apply([], ordenar(cand.puntos).map(function (p) { return [p.x, p.y]; })));
        var mv = new cv.MatVector();
        mv.push_back(pts);
        cv.fillPoly(mask, mv, new cv.Scalar(255));
        var dentro = cv.mean(gray, mask)[0];
        cv.bitwise_not(mask, mask);
        var fuera = cv.mean(gray, mask)[0];
        mask.delete(); pts.delete(); mv.delete();
        cand.contraste = dentro - fuera;
        // Una hoja de papel es clara y más clara que su entorno.
        if (dentro < 70 || cand.contraste < 8) return;
        cand.puntuacion = cand.area / area + Math.min(cand.contraste, 80) / 160;
        if (!mejor || cand.puntuacion > mejor.puntuacion) mejor = cand;
      });

      if (!mejor) return null;
      return { puntos: mejor.puntos, cobertura: mejor.area / area, contraste: mejor.contraste };
    } finally {
      mats.forEach(function (m) { m.delete(); });
    }
  };
})();

if (typeof module !== 'undefined') module.exports = { detectarDocumento: detectarDocumento };
