// El token se conserva solo en esta pestaña mediante memoria y sessionStorage.
let accessToken = null;

const storageKey = "audio2score.accessToken";

function getSessionToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function setAccessToken(token) {
  accessToken = typeof token === "string" && token.trim() ? token : null;
  if (typeof window === "undefined") return;
  try {
    if (accessToken) window.sessionStorage.setItem(storageKey, accessToken);
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    // La sesión sigue activa en memoria cuando el navegador bloquea sessionStorage.
  }
}

export function getAccessToken() {
  return accessToken || getSessionToken();
}

export function clearAccessToken() {
  accessToken = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // No hay almacenamiento persistente disponible; el token en memoria ya se limpió.
  }
}
