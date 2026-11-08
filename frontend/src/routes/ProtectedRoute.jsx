import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

export function ProtectedRoute() {
  const { isAuthenticated, isCheckingSession } = useAuth()

  if (isCheckingSession) {
    return <p>Verificando sesión...</p>
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}