// Preferencias pequeñas en localStorage.

const K = 'cz.ajustes';
const DEFECTO = {
  carpeta: '/FACTURAS',
  destino: 'ambos', // 'ambos' | 'dropbox' | 'movil'
  filtro: 'documento',
  empezarEnCamara: true,
  confirmarRecorte: true,
  camaraNativa: false, // abrir la cámara del iPhone (12 MP, flash real) en vez de la de la web
  autoDisparo: false, // hacer la foto sola cuando la factura está quieta
};

export function ajustes() {
  try { return { ...DEFECTO, ...JSON.parse(localStorage.getItem(K) || '{}') }; } catch { return { ...DEFECTO }; }
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
