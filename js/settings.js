// Preferencias pequeñas en localStorage.

import { CARPETA_BASE } from './config.js';

const K = 'cz.ajustes';
const DEFECTO = {
  carpeta: CARPETA_BASE,
  destino: 'ambos', // 'ambos' | 'dropbox' | 'movil'
  filtro: 'documento',
  intensidad: 0.8, // 0 = suave, 1 = intenso
  empezarEnCamara: true,
  confirmarRecorte: true,
  camaraNativa: false, // abrir la cámara del iPhone (12 MP, flash real) en vez de la de la web
  autoDisparo: false, // hacer la foto sola cuando la factura está quieta
  leerFacturas: true, // OCR en el móvil para rellenar proveedor, importe, fecha y nº
};

export function ajustes() {
  try {
    const a = { ...DEFECTO, ...JSON.parse(localStorage.getItem(K) || '{}') };
    // Migración: quien guardó el valor por defecto antiguo pasa al de la configuración actual.
    if (a.carpeta === '/FACTURAS' && CARPETA_BASE !== '/FACTURAS') a.carpeta = CARPETA_BASE;
    return a;
  } catch { return { ...DEFECTO }; }
}

export function guardarAjustes(cambios) {
  const a = { ...ajustes(), ...cambios };
  localStorage.setItem(K, JSON.stringify(a));
  return a;
}

export const DESTINOS = {
  ambos: { corto: 'Móvil + Dropbox', icono: 'both' },
  dropbox: { corto: 'Solo Dropbox', icono: 'cloud' },
  movil: { corto: 'Solo móvil', icono: 'phone' },
};
