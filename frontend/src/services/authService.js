import { apiRequest, tokenStorage } from './apiClient'

export const authService = {
  register(credentials) {
    return apiRequest('/auth/register', {
      method: 'POST',
      body: credentials,
      auth: false,
    })
  },

  async login(credentials) {
    const session = await apiRequest('/auth/login', {
      method: 'POST',
      body: credentials,
      auth: false,
    })

    tokenStorage.save(session.accessToken)
    return session
  },

  getCurrentUser() {
    return apiRequest('/auth/me')
  },

  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } finally {
      tokenStorage.clear()
    }
  },
}