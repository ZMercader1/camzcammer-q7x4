# CamZcammer

Escáner de facturas para el iPhone, hecho como web instalable (PWA). Se abre desde la
pantalla de inicio, escanea con la cámara, endereza y limpia la foto, genera un PDF y lo
guarda en el móvil, en Dropbox o en ambos, siguiendo la estructura de `FACTURAS`:

```
/FACTURAS/Octubre Noviembre Diciembre 2026/Octubre/Gastos/Proveedor 2026-10-08 (54,07).pdf
```

- Sin servidor: todo ocurre en el móvil. La conexión con Dropbox (OAuth PKCE) vive solo en el dispositivo.
- Detección de bordes con OpenCV.js en un Web Worker (`vendor/opencv.js`, `js/detector.js`).
- Enderezado, filtros y PDF en JS puro (`js/image.js`, `js/pdf.js`), testeados en Node.

## Desarrollo

```
node --test tests/core.test.js tests/extraer.test.js
```

Cualquier cambio publicado necesita subir `VERSION` en `sw.js` para que los móviles se actualicen.
