import { useCallback, useEffect, useState } from "react";
import styles from "./App.module.css";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ProjectsPage from "./pages/ProjectsPage.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

function AppRoutes() {
  const { isAuthenticated, setUser } = useAuth();
  const [pathname, setPathname] = useState(() => window.location.pathname);

  const navigate = useCallback((path, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState({}, "", path);
    } else {
      window.history.pushState({}, "", path);
    }
    setPathname(path);
  }, []);

  useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", syncPathname);
    return () => window.removeEventListener("popstate", syncPathname);
  }, []);

  useEffect(() => {
    if (pathname === "/") {
      navigate(isAuthenticated ? "/dashboard" : "/login", { replace: true });
    }
  }, [isAuthenticated, navigate, pathname]);

  if (pathname === "/login") {
    return (
      <LoginPage
        navigate={navigate}
        onLoginSuccess={(session) => {
          setUser(session.user);
          navigate("/dashboard", { replace: true });
        }}
      />
    );
  }

  if (pathname === "/dashboard" || pathname === "/") {
    return (
      <ProtectedRoute navigate={navigate}>
        <DashboardPage navigate={navigate} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/projects") {
    return (
      <ProtectedRoute navigate={navigate}>
        <ProjectsPage navigate={navigate} />
      </ProtectedRoute>
    );
  }

  return (
    <main className={styles.notFound}>
      <h1>Página no encontrada</h1>
      <button type="button" onClick={() => navigate("/login", { replace: true })}>
        Ir al inicio de sesión
      </button>
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className={styles.shell}>
        <AppRoutes />
      </div>
    </AuthProvider>
  );
}
