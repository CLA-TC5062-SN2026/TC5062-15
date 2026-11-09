import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Navbar from "../components/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { ApiError, getApiErrorMessage } from "../services/apiClient.js";
import { projectsService } from "../services/projectsService.js";
import styles from "./ProjectsPage.module.css";

const navigationItems = [
  { href: "/dashboard", label: "Resumen", icon: "⌂" },
  { href: "/projects", label: "Proyectos", icon: "▧" },
  { href: "#transcripcion", label: "Transcripciones", icon: "♫" },
];

const statusLabels = {
  pendiente: "Pendiente",
  procesando: "Procesando",
  completado: "Completado",
  fallido: "Fallido",
};

function formatDate(value) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

export default function ProjectsPage({ navigate }) {
  const { user, isAuthenticated } = useAuth();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const loadProjects = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const startedAt = performance.now();
    setIsLoading(true);
    setError("");

    try {
      const response = await projectsService.list();
      if (currentRequest !== requestId.current) return;
      if (!Array.isArray(response?.items)) {
        throw new ApiError("El servidor devolvió una respuesta de proyectos inesperada.", {
          code: "INVALID_PROJECTS_RESPONSE",
          kind: "protocol",
        });
      }
      setProjects(response.items);
    } catch (loadError) {
      if (currentRequest === requestId.current) {
        setError(getApiErrorMessage(loadError));
      }
    } finally {
      // Evita que el indicador de carga desaparezca antes de que pueda percibirse.
      const remaining = Math.max(0, 600 - (performance.now() - startedAt));
      window.setTimeout(() => {
        if (currentRequest === requestId.current) setIsLoading(false);
      }, remaining);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    return () => {
      requestId.current += 1;
    };
  }, [loadProjects]);

  const displayName = user?.name || user?.email || "Usuario";

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/dashboard" aria-label="Audio2Score inicio" onClick={(event) => {
          event.preventDefault();
          navigate("/dashboard");
        }}>
          <span className={styles.brandIcon}>A2</span>
          <span><strong>Audio2Score</strong><small>Music workspace</small></span>
        </a>

        <p className={styles.sidebarCaption}>ESPACIO DE TRABAJO</p>
        <Navbar
          items={navigationItems}
          activeHref="/projects"
          onNavigate={navigate}
          isAuthenticated={isAuthenticated}
          userName={displayName}
          showAccountAction={false}
        />
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>Workspace <span>/</span> <strong>Proyectos</strong></div>
          <span className={styles.environment}><i /> Datos de tu cuenta</span>
        </header>

        <div className={styles.content}>
          <section className={styles.heading} aria-labelledby="projects-title">
            <div>
              <p className={styles.eyebrow}>AUDIO2SCORE <span>·</span> ESPACIO DE TRABAJO</p>
              <h1 id="projects-title">Tus proyectos</h1>
              <p>Consulta los proyectos asociados a tu cuenta.</p>
            </div>
            <Button variant="secondary" onClick={loadProjects} disabled={isLoading}>
              Actualizar
            </Button>
          </section>

          {isLoading && (
            <section className={styles.loading} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <div>
                <strong>Cargando tus proyectos…</strong>
                <span>Consultando el servicio de Audio2Score.</span>
              </div>
            </section>
          )}

          {!isLoading && error && (
            <section className={styles.error} role="alert" aria-labelledby="projects-error-title">
              <div>
                <strong id="projects-error-title">No se pudieron cargar los proyectos</strong>
                <p>{error}</p>
              </div>
              <Button variant="secondary" onClick={loadProjects}>Reintentar</Button>
            </section>
          )}

          {!isLoading && !error && (
            <section className={styles.results} aria-live="polite" aria-busy="false">
              <div className={styles.resultsHeader}>
                <div>
                  <p className={styles.sectionEyebrow}>RESULTADO DEL SERVIDOR</p>
                  <h2>{projects.length === 1 ? "1 proyecto" : `${projects.length} proyectos`}</h2>
                </div>
                <span className={styles.source}><i /> API conectada</span>
              </div>

              {projects.length === 0 ? (
                <Card className={styles.emptyState}>
                  <span className={styles.emptyIcon} aria-hidden="true">♫</span>
                  <h3>Aún no tienes proyectos</h3>
                  <p>La API respondió correctamente, pero todavía no hay proyectos asociados a esta cuenta.</p>
                  <Button variant="secondary" onClick={() => navigate("/dashboard")}>
                    Volver al resumen
                  </Button>
                </Card>
              ) : (
                <div className={styles.projectGrid}>
                  {projects.map((project) => {
                    const status = statusLabels[project.status] || project.status || "Sin estado";
                    return (
                      <Card key={project.id} className={styles.projectCard}>
                        <div className={styles.projectTop}>
                          <span className={styles.projectIcon} aria-hidden="true">♫</span>
                          <span className={`${styles.status} ${styles[project.status] || ""}`}>
                            {status}
                          </span>
                        </div>
                        <h3>{project.name || "Proyecto sin nombre"}</h3>
                        <p>Creado el {formatDate(project.createdAt)}</p>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <footer className={styles.footer}>
            <span>Audio2Score · Proyectos</span>
            <span>Información consultada desde el backend</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
