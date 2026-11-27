import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Navbar from "../components/Navbar.jsx";
import ProjectForm from "../components/ProjectForm.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { ApiError, getApiErrorMessage } from "../services/apiClient.js";
import { projectsService } from "../services/projectsService.js";
import styles from "./ProjectsPage.module.css";

const navigationItems = [
  { href: "/dashboard", label: "Resumen", icon: "⌂" },
  { href: "/projects", label: "Proyectos", icon: "▧" },
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

export default function ProjectsPage({ navigate, onLogout }) {
  const { user, isAuthenticated } = useAuth();
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const requestId = useRef(0);

  const loadProjects = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const startedAt = performance.now();
    setIsLoading(true);
    setError("");

    try {
      const response = await projectsService.list({ includeArchived: showArchived });
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
  }, [showArchived]);

  useEffect(() => {
    loadProjects();
    return () => {
      requestId.current += 1;
    };
  }, [loadProjects]);

  const displayName = user?.name || user?.email || "Usuario";

  const startEditing = (project) => {
    setActionError("");
    setActionNotice("");
    setIsCreatingProject(false);
    setEditingProjectId(project.id);
  };

  const cancelEditing = () => {
    setEditingProjectId(null);
    setActionError("");
  };

  const handleProjectCreated = (project) => {
    setActionError("");
    setProjects((current) => [project, ...current]);
    setIsCreatingProject(false);
    setActionNotice("El proyecto se creó.");
  };

  const handleProjectUpdated = (project) => {
    setActionError("");
    setProjects((current) => current
      .map((item) => (item.id === project.id ? { ...item, ...project } : item))
      .filter((item) => showArchived || !item.archivedAt));
    setEditingProjectId(null);
    setActionNotice("Los cambios del proyecto se guardaron.");
  };

  const toggleProjectArchive = async (project) => {
    if (pendingAction) return;
    const isArchived = Boolean(project.archivedAt);
    setActionError("");
    setActionNotice("");
    setPendingAction({ projectId: project.id, type: isArchived ? "restore" : "archive" });
    try {
      const updated = await projectsService.update(project.id, { archived: !isArchived });
      setProjects((current) => current
        .map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
        .filter((item) => showArchived || !item.archivedAt));
      setActionNotice(isArchived ? "El proyecto se restauró." : "El proyecto se archivó.");
    } catch (archiveError) {
      setActionError(getApiErrorMessage(archiveError));
    } finally {
      setPendingAction(null);
    }
  };

  const deleteProject = async (project) => {
    const confirmed = window.confirm(
      `¿Eliminar “${project.name || "Proyecto sin nombre"}”? Esta acción no se puede deshacer.`,
    );
    if (!confirmed || pendingAction) return;

    setActionError("");
    setActionNotice("");
    setPendingAction({ projectId: project.id, type: "delete" });
    try {
      await projectsService.remove(project.id);
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (editingProjectId === project.id) cancelEditing();
      setActionNotice("El proyecto se eliminó.");
    } catch (deleteError) {
      setActionError(getApiErrorMessage(deleteError));
    } finally {
      setPendingAction(null);
    }
  };

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
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          userName={displayName}
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
            <div className={styles.headingActions}>
              <Button
                onClick={() => {
                  setActionError("");
                  setActionNotice("");
                  setEditingProjectId(null);
                  setIsCreatingProject((current) => !current);
                }}
                disabled={isLoading || Boolean(pendingAction) || Boolean(editingProjectId)}
              >
                {isCreatingProject ? "Cerrar formulario" : "Nuevo proyecto"}
              </Button>
              <Button
                variant="secondary"
                onClick={loadProjects}
                disabled={isLoading || isCreatingProject || Boolean(editingProjectId)}
              >
                Actualizar
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowArchived((current) => !current)}
                disabled={isLoading || isCreatingProject || Boolean(editingProjectId) || Boolean(pendingAction)}
                aria-pressed={showArchived}
              >
                {showArchived ? "Ocultar archivados" : "Incluir archivados"}
              </Button>
            </div>
          </section>

          {isCreatingProject && (
            <Card className={styles.createFormCard}>
              <ProjectForm
                onSuccess={handleProjectCreated}
                onCancel={() => setIsCreatingProject(false)}
              />
            </Card>
          )}

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
                  {showArchived && <p className={styles.archiveScope}>Se muestran proyectos activos y archivados.</p>}
                </div>
                <span className={styles.source}><i /> API conectada</span>
              </div>

              {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
              {actionNotice && <p className={styles.actionNotice} role="status">{actionNotice}</p>}

              {projects.length === 0 ? (
                <Card className={styles.emptyState}>
                  <span className={styles.emptyIcon} aria-hidden="true">♫</span>
                  <h3>Aún no tienes proyectos</h3>
                  <p>La API respondió correctamente, pero todavía no hay proyectos asociados a esta cuenta.</p>
                  <Button onClick={() => setIsCreatingProject(true)}>
                    Crear proyecto
                  </Button>
                  <Button variant="secondary" onClick={() => navigate("/dashboard")}>
                    Volver al resumen
                  </Button>
                </Card>
              ) : (
                <div className={styles.projectGrid}>
                  {projects.map((project) => {
                    const status = project.archivedAt ? "Archivado" : statusLabels[project.status] || project.status || "Sin estado";
                    return (
                      <Card key={project.id} className={styles.projectCard}>
                        <div className={styles.projectTop}>
                          <span className={styles.projectIcon} aria-hidden="true">♫</span>
                          <span className={`${styles.status} ${styles[project.status] || ""}`} aria-label={`Estado: ${status}`}>
                            {status}
                          </span>
                        </div>
                        {editingProjectId === project.id ? (
                          <ProjectForm
                            project={project}
                            onSuccess={handleProjectUpdated}
                            onCancel={cancelEditing}
                          />
                        ) : (
                          <>
                            <h3>{project.name || "Proyecto sin nombre"}</h3>
                            <p className={styles.projectDescription}>{project.description || "Sin descripción."}</p>
                            <p className={styles.createdDate}>Creado el {formatDate(project.createdAt)}</p>
                            <div className={styles.cardActions}>
                              <Button
                                onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
                                aria-label={`Abrir ${project.name || "proyecto"}`}
                              >
                                Abrir proyecto
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => startEditing(project)}
                                disabled={Boolean(pendingAction)}
                                aria-label={`Editar ${project.name || "proyecto"}`}
                              >
                                Editar
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => toggleProjectArchive(project)}
                                loading={pendingAction?.projectId === project.id && ["archive", "restore"].includes(pendingAction.type)}
                                loadingText={project.archivedAt ? "Restaurando…" : "Archivando…"}
                                disabled={Boolean(pendingAction)}
                                aria-label={`${project.archivedAt ? "Restaurar" : "Archivar"} ${project.name || "proyecto"}`}
                              >
                                {project.archivedAt ? "Restaurar" : "Archivar"}
                              </Button>
                              <Button
                                variant="secondary"
                                className={styles.deleteButton}
                                onClick={() => deleteProject(project)}
                                loading={pendingAction?.projectId === project.id && pendingAction.type === "delete"}
                                loadingText="Eliminando…"
                                disabled={Boolean(pendingAction)}
                                aria-label={`Eliminar ${project.name || "proyecto"}`}
                              >
                                Eliminar
                              </Button>
                            </div>
                          </>
                        )}
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
