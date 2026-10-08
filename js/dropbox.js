// Dropbox desde el navegador: OAuth 2 con PKCE (sin secreto) y subida directa de archivos.
// El token solo vive en este dispositivo: la web publicada no guarda nada tuyo.

import { DROPBOX_APP_KEY } from './config.js';
import { jsonAscii } from './naming.js';

const K_TOKENS = 'cz.dbx';
const K_PKCE = 'cz.pkce';
const K_APPKEY = 'cz.appkey';

const leer = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const escribir = (k, v) => (v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)));

export const appKey = () => (leer(K_APPKEY) || DROPBOX_APP_KEY || '').trim();
export const setAppKey = (k) => escribir(K_APPKEY, (k || '').trim() || null);
export const conectado = () => !!leer(K_TOKENS)?.refresh_token;
export const cuentaGuardada = () => leer(K_TOKENS)?.cuenta || null;
export const redirectUri = () => new URL('./', location.href).href;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function iniciarConexion() {
  if (!appKey()) throw new Error('Falta la App key de Dropbox (Ajustes → Avanzado)');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  escribir(K_PKCE, { verifier, creado: Date.now() });
  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: appKey(),
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    // Solo escribir: la app no puede leer ni descargar nada de tu Dropbox.
    scope: 'files.content.write',
    redirect_uri: redirectUri(),
  });
  location.href = url.href;
}

/**
 * Al volver de Dropbox la URL trae ?code=. Si este contexto tiene el verificador, canjea el
 * código. Si no (en iPhone el retorno puede abrirse en Safari en vez de en la app instalada),
 * devuelve el código para que el usuario lo pegue en la app.
 */
export async function manejarRetorno() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error_description') || params.get('error');
  if (!code && !error) return null;
  history.replaceState(null, '', redirectUri());
  if (error) return { error };
  if (!leer(K_PKCE)) return { codigo: code };
  await canjearCodigo(code);
  return { ok: true };
}

export async function canjearCodigo(code) {
  const pkce = leer(K_PKCE);
  if (!pkce) throw new Error('Pulsa "Conectar Dropbox" de nuevo desde esta app');
  const tokens = await pedirToken({
    code: code.trim(),
    grant_type: 'authorization_code',
    client_id: appKey(),
    code_verifier: pkce.verifier,
    redirect_uri: redirectUri(),
  });
  escribir(K_PKCE, null);
  escribir(K_TOKENS, tokens);
}

async function pedirToken(campos) {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Dropbox ${res.status}`);
  const prev = leer(K_TOKENS) || {};
  return {
    ...prev,
    access_token: json.access_token,
    refresh_token: json.refresh_token || prev.refresh_token,
    expira: Date.now() + (json.expires_in || 14400) * 1000,
  };
}

async function token(forzar = false) {
  const t = leer(K_TOKENS);
  if (!t?.refresh_token) throw new SinConexion();
  if (!forzar && t.access_token && t.expira - Date.now() > 60_000) return t.access_token;
  try {
    const nuevo = await pedirToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: appKey() });
    escribir(K_TOKENS, nuevo);
    return nuevo.access_token;
  } catch (e) {
    // invalid_grant: el usuario revocó el acceso. Hay que volver a conectar.
    if (/invalid_grant|revoked|expired/i.test(e.message)) { escribir(K_TOKENS, null); throw new SinConexion(); }
    throw e;
  }
}

export class SinConexion extends Error {
  constructor() { super('Dropbox no está conectado'); this.name = 'SinConexion'; }
}

async function llamar(url, init) {
  for (let intento = 0; intento < 2; intento++) {
    const t = await token(intento > 0);
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
    if (res.status === 401 && intento === 0) continue;
    if (res.status === 429) {
      const espera = +(res.headers.get('Retry-After') || 2);
      await new Promise((r) => setTimeout(r, espera * 1000));
      continue;
    }
    const texto = await res.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
    if (!res.ok) throw new Error(json?.error_summary || texto || `Dropbox ${res.status}`);
    return json;
  }
  throw new Error('Dropbox no acepta la sesión');
}

const rpc = (endpoint, body) => llamar(`https://api.dropboxapi.com/2/${endpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? null),
});

/** Sube un archivo. Dropbox crea las carpetas que falten y renombra si ya existe. */
export async function subir(blob, ruta) {
  return llamar('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': jsonAscii({ path: ruta, mode: 'add', autorename: true, mute: true }),
    },
    body: blob,
  });
}

export async function cuenta() {
  const c = await rpc('users/get_current_account');
  const datos = { email: c.email, nombre: c.name?.display_name };
  const t = leer(K_TOKENS);
  if (t) escribir(K_TOKENS, { ...t, cuenta: datos });
  return datos;
}

/** Renombra o mueve un archivo ya subido. Devuelve la ruta final. */
export async function mover(desde, hasta) {
  const r = await rpc('files/move_v2', { from_path: desde, to_path: hasta, autorename: true });
  return r.metadata.path_display;
}

/** Enlace a la web de Dropbox con el archivo abierto. No usa la API (no hace falta permiso de lectura). */
export function enlaceWeb(ruta) {
  const i = ruta.lastIndexOf('/');
  return `https://www.dropbox.com/home${encodeURI(ruta.slice(0, i))}?preview=${encodeURIComponent(ruta.slice(i + 1))}`;
}

export async function desconectar() {
  try { await rpc('auth/token/revoke'); } catch { /* se borra igualmente en local */ }
  escribir(K_TOKENS, null);
}
