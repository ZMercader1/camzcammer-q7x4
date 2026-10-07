// Preferencias pequeñas en localStorage.

const K = 'cz.ajustes';
const DEFECTO = {
  carpeta: '/FACTURAS',
  destino: 'ambos', // 'ambos' | 'dropbox' | 'movil'
  filtro: 'documento',
  empezarEnCamara: true,
  confirmarRecorte: true,
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
