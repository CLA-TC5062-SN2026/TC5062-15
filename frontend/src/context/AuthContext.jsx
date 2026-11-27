import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SESSION_EXPIRED_EVENT } from "../services/apiClient.js";
import { authService } from "../services/authService.js";
import { clearAccessToken, getAccessToken } from "../services/tokenStore.js";

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isRestoring, setIsRestoring] = useState(() => Boolean(getAccessToken()));
  const clearSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setIsRestoring(false);
  }, []);

  useEffect(() => {
    let active = true;
    if (!getAccessToken()) {
      setIsRestoring(false);
      return () => { active = false; };
    }

    authService.getCurrentUser()
      .then((currentUser) => {
        if (active) setUser(currentUser);
      })
      .catch(() => {
        clearAccessToken();
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => clearSession();
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, isAuthenticated: Boolean(user), isRestoring, setUser, clearSession }),
    [user, isRestoring, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth debe utilizarse dentro de AuthProvider.");
  }
  return context;
}
