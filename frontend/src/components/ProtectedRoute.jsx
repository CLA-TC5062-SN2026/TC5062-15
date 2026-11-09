import { useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProtectedRoute({ children, navigate }) {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;
  return children;
}
