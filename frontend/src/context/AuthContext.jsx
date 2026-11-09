import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const clearSession = useCallback(() => setUser(null), []);
  const value = useMemo(
    () => ({ user, isAuthenticated: Boolean(user), setUser, clearSession }),
    [user, clearSession],
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
