import { useCallback, useEffect, useMemo, useState } from 'react'
import { authService } from '../services/authService'
import { setUnauthorizedHandler, tokenStorage } from '../services/apiClient'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isCheckingSession, setIsCheckingSession] = useState(() =>
    Boolean(tokenStorage.get()),
  )

  const clearSession = useCallback(() => {
    tokenStorage.clear()
    setUser(null)
    setIsCheckingSession(false)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(clearSession)

    if (!tokenStorage.get()) {
      return () => setUnauthorizedHandler(null)
    }

    let isActive = true

    authService
      .getCurrentUser()
      .then((currentUser) => {
        if (isActive) {
          setUser(currentUser)
        }
      })
      .catch(() => {
        if (isActive) {
          clearSession()
        }
      })
      .finally(() => {
        if (isActive) {
          setIsCheckingSession(false)
        }
      })

    return () => {
      isActive = false
      setUnauthorizedHandler(null)
    }
  }, [clearSession])

  const login = useCallback(async (credentials) => {
    const session = await authService.login(credentials)
    setUser(session.user)
    return session
  }, [])

  const logout = useCallback(async () => {
    try {
      await authService.logout()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isCheckingSession,
      login,
      logout,
    }),
    [isCheckingSession, login, logout, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}