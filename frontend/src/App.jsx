import { useCallback, useEffect, useState } from "react";
import styles from "./App.module.css";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ProjectsPage from "./pages/ProjectsPage.jsx";
import ProjectDetailPage from "./pages/ProjectDetailPage.jsx";
import TranscriptionPage from "./pages/TranscriptionPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import { authService } from "./services/authService.js";

function AppRoutes() {
  const { isAuthenticated, isRestoring, setUser, clearSession } = useAuth();
  const [pathname, setPathname] = useState(() => window.location.pathname);

  const navigate = useCallback((path, { replace = false } = {}) => {
    if (replace) {
      window.history.replaceState({}, "", path);
    } else {
      window.history.pushState({}, "", path);
    }
    setPathname(path);
  }, []);

  const handleLogout = useCallback(async () => {
    const logoutRequest = authService.logout();
    clearSession();
    navigate("/login", { replace: true });
    await logoutRequest.catch(() => null);
  }, [clearSession, navigate]);

  useEffect(() => {
    const syncPathname = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", syncPathname);
    return () => window.removeEventListener("popstate", syncPathname);
  }, []);

  useEffect(() => {
    if (pathname === "/" && !isRestoring) {
      navigate(isAuthenticated ? "/dashboard" : "/login", { replace: true });
    } else if (pathname === "/login" && !isRestoring && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, isRestoring, navigate, pathname]);

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

  if (pathname === "/register") {
    return <RegisterPage navigate={navigate} />;
  }

  if (pathname === "/dashboard" || pathname === "/") {
    return (
      <ProtectedRoute navigate={navigate}>
        <DashboardPage navigate={navigate} onLogout={handleLogout} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/projects") {
    return (
      <ProtectedRoute navigate={navigate}>
        <ProjectsPage navigate={navigate} onLogout={handleLogout} />
      </ProtectedRoute>
    );
  }

  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/transcription)?$/);
  if (projectMatch) {
    let projectId = projectMatch[1];
    try {
      projectId = decodeURIComponent(projectId);
    } catch {
      projectId = projectMatch[1];
    }
    const isTranscriptionRoute = pathname.endsWith("/transcription");
    return (
      <ProtectedRoute navigate={navigate}>
        {isTranscriptionRoute ? (
          <TranscriptionPage projectId={projectId} navigate={navigate} onLogout={handleLogout} />
        ) : (
          <ProjectDetailPage projectId={projectId} navigate={navigate} onLogout={handleLogout} />
        )}
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
