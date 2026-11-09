import { clearAccessToken, getAccessToken } from "./tokenStore.js";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = (
  configuredApiUrl || "/v1"
).replace(/\/+$/, "");

const STATUS_MESSAGES = {
  400: "La solicitud contiene datos que no son válidos. Revisa la información e inténtalo de nuevo.",
  401: "Tu sesión venció o no es válida. Inicia sesión de nuevo.",
  403: "No tienes permiso para realizar esta acción.",
  404: "No encontramos el recurso solicitado.",
  409: "La información cambió o la acción no está disponible en el estado actual. Actualiza la vista e inténtalo de nuevo.",
  413: "El archivo excede el tamaño máximo permitido de 100 MB.",
  415: "El formato del archivo no es compatible. Selecciona un archivo MP3 o WAV.",
  422: "La información no cumple las reglas requeridas. Revisa los campos e inténtalo de nuevo.",
  429: "Se recibieron demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
};

export class ApiError extends Error {
  constructor(
    message,
    { status = null, code = "API_ERROR", kind = "http", requestId, details, cause } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
    this.requestId = requestId;
    this.details = details;
    this.cause = cause;
  }
}

export function getApiErrorMessage(error) {
  if (error instanceof ApiError) return error.message;
  return "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

export function withQuery(path, query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
    } else {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function isFormData(body) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function isNativeBody(body) {
  return (
    typeof body === "string" ||
    isFormData(body) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== "undefined" &&
      (body instanceof ArrayBuffer || ArrayBuffer.isView(body)))
  );
}

function prepareBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  if (isNativeBody(body)) return body;

  if (typeof body === "object") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return JSON.stringify(body);
  }

  return body;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function createHttpError(response, payload) {
  const serverMessage =
    payload && typeof payload === "object"
      ? payload.message || payload.detail
      : typeof payload === "string"
        ? payload
        : null;
  const fallbackMessage =
    STATUS_MESSAGES[response.status] ||
    (response.status >= 500
      ? "El servicio no está disponible en este momento. Inténtalo más tarde."
      : `No se pudo completar la solicitud (HTTP ${response.status}).`);

  return new ApiError(
    typeof serverMessage === "string" && serverMessage.trim()
      ? serverMessage.trim()
      : fallbackMessage,
    {
      status: response.status,
      code:
        payload && typeof payload === "object" && typeof payload.code === "string"
          ? payload.code
          : `HTTP_${response.status}`,
      kind: "http",
      requestId:
        payload && typeof payload === "object" ? payload.requestId : undefined,
      details:
        payload && typeof payload === "object"
          ? payload.details || payload.errors
          : undefined,
    },
  );
}

export async function apiRequest(
  path,
  {
    method = "GET",
    body,
    headers: initialHeaders,
    auth = true,
    responseType = "json",
    signal,
  } = {},
) {
  const headers = new Headers(initialHeaders);
  if (!headers.has("Accept")) {
    headers.set("Accept", responseType === "blob" ? "*/*" : "application/json");
  }

  if (auth) {
    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const requestBody = prepareBody(body, headers);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
      method,
      body: requestBody,
      headers,
      signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") {
      throw new ApiError("La solicitud se canceló.", {
        code: "REQUEST_ABORTED",
        kind: "aborted",
        cause,
      });
    }

    throw new ApiError(
      "No fue posible conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
      { code: "NETWORK_ERROR", kind: "network", cause },
    );
  }

  if (!response.ok) {
    const payload = await readResponseBody(response);
    if (response.status === 401) clearAccessToken();
    throw createHttpError(response, payload);
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  if (responseType === "text") return response.text();
  return readResponseBody(response);
}
