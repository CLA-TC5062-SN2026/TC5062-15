import { useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProtectedRoute({ children, navigate }) {
  const { isAuthenticated, isRestoring } = useAuth();

  useEffect(() => {
    if (!isRestoring && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, isRestoring, navigate]);

  if (isRestoring) {
    return <main role="status" aria-live="polite" style={{ padding: "2rem", color: "#34425e" }}>Restaurando la sesión…</main>;
  }
  if (!isAuthenticated) return null;
  return children;
}
