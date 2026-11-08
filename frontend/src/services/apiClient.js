const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\/+$/, '')

const TOKEN_KEY = 'audio2score.accessToken'
let unauthorizedHandler = null

export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN_ERROR', message, details = [] }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const tokenStorage = {
  get() {
    return sessionStorage.getItem(TOKEN_KEY)
  },

  save(token) {
    sessionStorage.setItem(TOKEN_KEY, token)
  },

  clear() {
    sessionStorage.removeItem(TOKEN_KEY)
  },
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

function buildUrl(path) {
  if (!API_BASE_URL) {
    throw new ApiError({
      code: 'CONFIGURATION_ERROR',
      message: 'La aplicación no tiene configurada la URL del servicio.',
    })
  }

  return `${API_BASE_URL}${path}`
}

async function readResponseBody(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function defaultHttpMessage(status) {
  const messages = {
    400: 'La solicitud contiene información inválida.',
    401: 'Tu sesión no es válida o ha expirado.',
    403: 'No tienes permiso para realizar esta acción.',
    404: 'El recurso solicitado no existe.',
    409: 'La operación entra en conflicto con el estado actual.',
    413: 'El archivo excede el tamaño permitido.',
    415: 'El formato del archivo no está permitido.',
    422: 'Hay campos que requieren corrección.',
    500: 'El servicio encontró un error interno.',
    503: 'El servicio no está disponible temporalmente.',
  }

  return messages[status] ?? 'No fue posible completar la solicitud.'
}

export function getUserMessage(error) {
  if (error instanceof ApiError) {
    return error.message
  }

  return 'Ocurrió un error inesperado. Intenta nuevamente.'
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    signal,
  } = options

  const requestHeaders = new Headers(headers)

  if (auth) {
    const token = tokenStorage.get()

    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`)
    }
  }

  let requestBody = body

  if (body && !(body instanceof FormData)) {
    requestHeaders.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }

  let response

  try {
    response = await fetch(buildUrl(path), {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal,
    })
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'No fue posible conectar con el servicio. Verifica tu conexión e inténtalo nuevamente.',
    })
  }

  const data = await readResponseBody(response)

  if (!response.ok) {
    const error = new ApiError({
      status: response.status,
      code: data?.code ?? 'HTTP_ERROR',
      message: data?.message ?? defaultHttpMessage(response.status),
      details: data?.details ?? [],
    })

    if (response.status === 401 && auth) {
      tokenStorage.clear()
      unauthorizedHandler?.()
    }

    throw error
  }

  return data
}