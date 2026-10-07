// Detección del documento con OpenCV. Script clásico: lo carga el worker con importScripts
// y los tests con require, por eso no usa import/export.

/* eslint-disable no-var */
var detectarDocumento = function (cv, img) {
  var area = img.width * img.height;
  var mats = [];
  var M = function (m) { mats.push(m); return m; };
  var mejor = null;

  try {
    var src = M(cv.matFromImageData(img));
    var gray = M(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    var k3 = M(cv.Mat.ones(3, 3, cv.CV_8U));
    var k7 = M(cv.Mat.ones(7, 7, cv.CV_8U));

    var considerar = function (bin) {
      var contours = new cv.MatVector();
      var hier = new cv.Mat();
      cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (var i = 0; i < contours.size(); i++) {
        var c = contours.get(i);
        if (cv.contourArea(c) < area * 0.1) { c.delete(); continue; }
        var hull = new cv.Mat();
        cv.convexHull(c, hull);
        var peri = cv.arcLength(hull, true);
        var eps = [0.015, 0.025, 0.04, 0.06];
        for (var e = 0; e < eps.length; e++) {
          var ap = new cv.Mat();
          cv.approxPolyDP(hull, ap, eps[e] * peri, true);
          if (ap.rows === 4) {
            var qa = cv.contourArea(ap);
            // Descarta el marco de la propia foto.
            if (qa < area * 0.97 && (!mejor || qa > mejor.area)) {
              var d = ap.data32S;
              mejor = {
                area: qa,
                puntos: [0, 1, 2, 3].map(function (j) { return { x: d[j * 2], y: d[j * 2 + 1] }; }),
              };
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

    // 1) Bordes: el contorno de la hoja contra el fondo.
    var edges = M(new cv.Mat());
    cv.Canny(gray, edges, 30, 90);
    cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 2);
    considerar(edges);

    // 2) Brillo: la hoja suele ser lo más claro. Sirve cuando los bordes están cortados.
    var th = M(new cv.Mat());
    cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(th, th, cv.MORPH_CLOSE, k7);
    considerar(th);
  } finally {
    mats.forEach(function (m) { m.delete(); });
  }

  if (!mejor) return null;
  return { puntos: mejor.puntos, cobertura: mejor.area / area };
};

if (typeof module !== 'undefined') module.exports = { detectarDocumento: detectarDocumento };
