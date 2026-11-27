import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import InputField from "../components/InputField.jsx";
import Navbar from "../components/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { ApiError, getApiErrorMessage } from "../services/apiClient.js";
import { audioFilesService } from "../services/audioFilesService.js";
import { processingService } from "../services/processingService.js";
import { projectsService } from "../services/projectsService.js";
import styles from "./ProjectDetailPage.module.css";

const navigationItems = [
  { href: "/dashboard", label: "Resumen", icon: "⌂" },
  { href: "/projects", label: "Proyectos", icon: "▧" },
];

const statusLabels = {
  pendiente: "Pendiente",
  procesando: "Procesando",
  completado: "Completado",
  fallido: "Fallido",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
};

function formatDate(value) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "Tamaño no disponible";
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function makeIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.()
    || `retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ProjectDetailPage({ projectId, navigate, onLogout }) {
  const { user, isAuthenticated } = useAuth();
  const [project, setProject] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const requestId = useRef(0);

  const loadProject = useCallback(async ({ quiet = false } = {}) => {
    const currentRequest = ++requestId.current;
    if (!quiet) setIsLoading(true);
    setPageError("");

    try {
      const projectResponse = await projectsService.get(projectId);
      const currentProject = projectResponse?.project ?? projectResponse;
      if (!currentProject?.id) {
        throw new ApiError("El servidor devolvió un proyecto con formato inesperado.", {
          code: "INVALID_PROJECT_RESPONSE",
          kind: "protocol",
        });
      }

      const [attemptResponse, audioResponse] = await Promise.all([
        processingService.listAttempts(projectId),
        currentProject.audioFileId
          ? audioFilesService.get(projectId, currentProject.audioFileId)
          : Promise.resolve(null),
      ]);
      if (attemptResponse && !Array.isArray(attemptResponse.items)) {
        throw new ApiError("El servidor devolvió un historial de procesamiento inesperado.", {
          code: "INVALID_ATTEMPTS_RESPONSE",
          kind: "protocol",
        });
      }

      if (currentRequest === requestId.current) {
        setProject(currentProject);
        setAttempts(attemptResponse?.items || []);
        setAudioFile(audioResponse);
      }
    } catch (error) {
      if (currentRequest === requestId.current) setPageError(getApiErrorMessage(error));
    } finally {
      if (currentRequest === requestId.current && !quiet) setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProject();
    return () => { requestId.current += 1; };
  }, [loadProject]);

  const currentAttempt = attempts[0] || null;
  const isProcessing = ["pendiente", "procesando"].includes(project?.status)
    || ["pendiente", "procesando"].includes(currentAttempt?.status);

  useEffect(() => {
    if (!isProcessing) return undefined;
    const timer = window.setInterval(() => loadProject({ quiet: true }), 2500);
    return () => window.clearInterval(timer);
  }, [isProcessing, loadProject]);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setFileError("");
    setActionError("");
    setNotice("");
    if (!selectedFile) return;

    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["mp3", "wav"].includes(extension)) {
      setFileError("Selecciona un archivo con extensión MP3 o WAV.");
    } else if (selectedFile.size > 100 * 1024 * 1024) {
      setFileError("El archivo supera el límite permitido de 100 MB.");
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setActionError("");
    setNotice("");
    if (!file) {
      setFileError("Selecciona un archivo MP3 o WAV.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["mp3", "wav"].includes(extension) || file.size > 100 * 1024 * 1024) return;

    setIsUploading(true);
    try {
      const result = await audioFilesService.upload(projectId, file);
      if (!result?.audioFile?.id) {
        throw new ApiError("El servidor no confirmó la carga del audio.", {
          code: "INVALID_UPLOAD_RESPONSE",
          kind: "protocol",
        });
      }
      setFile(null);
      form.reset();
      setNotice(result.processingStarted
        ? "Audio validado. El procesamiento inició y el estado se actualizará automáticamente."
        : "Audio validado. Completa la configuración requerida para iniciar el procesamiento.");
      await loadProject({ quiet: true });
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetry = async () => {
    if (!currentAttempt || isRetrying) return;
    setActionError("");
    setNotice("");
    setIsRetrying(true);
    try {
      await processingService.retryAttempt(
        projectId,
        currentAttempt.id,
        { configuration: currentAttempt.configuration || {} },
        { idempotencyKey: makeIdempotencyKey() },
      );
      setNotice("Se inició un nuevo intento de procesamiento.");
      await loadProject({ quiet: true });
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    } finally {
      setIsRetrying(false);
    }
  };

  const displayName = user?.name || user?.email || "Usuario";
  const projectStatus = statusLabels[project?.status] || project?.status || "Sin estado";

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/dashboard" onClick={(event) => {
          event.preventDefault();
          navigate("/dashboard");
        }} aria-label="Audio2Score inicio">
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
          <div className={styles.breadcrumb}>Workspace <span>/</span> <a href="/projects" onClick={(event) => {
            event.preventDefault();
            navigate("/projects");
          }}>Proyectos</a> <span>/</span> <strong>Detalle</strong></div>
          <span className={styles.environment}><i /> Datos de tu cuenta</span>
        </header>

        <div className={styles.content}>
          <section className={styles.heading} aria-labelledby="project-title">
            <div>
              <p className={styles.eyebrow}>AUDIO2SCORE <span>·</span> FLUJO DE AUDIO</p>
              <h1 id="project-title">{project?.name || "Detalle del proyecto"}</h1>
              <p>{project?.description || "Carga el audio que se analizará en este proyecto."}</p>
            </div>
            <Button variant="secondary" onClick={() => navigate("/projects")}>Volver a proyectos</Button>
          </section>

          {isLoading && (
            <section className={styles.loading} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <div><strong>Cargando proyecto…</strong><span>Consultando el audio y los intentos de procesamiento.</span></div>
            </section>
          )}

          {!isLoading && pageError && (
            <section className={styles.error} role="alert">
              <div><strong>No se pudo cargar el proyecto</strong><p>{pageError}</p></div>
              <Button variant="secondary" onClick={() => loadProject()}>Reintentar</Button>
            </section>
          )}

          {!isLoading && !pageError && project && (
            <div className={styles.sections}>
              {(actionError || notice) && (
                <p className={actionError ? styles.actionError : styles.notice} role={actionError ? "alert" : "status"}>
                  {actionError || notice}
                </p>
              )}

              <section className={styles.projectSummary} aria-label="Estado del proyecto">
                <div><span className={styles.sectionEyebrow}>ESTADO DEL PROYECTO</span><strong>{projectStatus}</strong></div>
                {project.failureReason && <p className={styles.failureReason}>{project.failureReason}</p>}
              </section>

              <section className={styles.section} aria-labelledby="audio-title">
                <div className={styles.sectionHeading}>
                  <div><p className={styles.sectionEyebrow}>ENTRADA</p><h2 id="audio-title">Audio del proyecto</h2></div>
                  <span className={styles.sectionIcon} aria-hidden="true">♫</span>
                </div>

                {audioFile ? (
                  <Card className={styles.audioCard}>
                    <div className={styles.audioTop}>
                      <div><strong>{audioFile.originalFilename}</strong><span>{audioFile.format} · {formatSize(audioFile.sizeBytes)}</span></div>
                      <span className={`${styles.status} ${styles[audioFile.status] || ""}`}>{statusLabels[audioFile.status] || audioFile.status}</span>
                    </div>
                    <dl className={styles.metadata}>
                      <div><dt>Duración</dt><dd>{audioFile.durationSeconds ? `${Math.round(audioFile.durationSeconds)} segundos` : "No disponible"}</dd></div>
                      <div><dt>Cargado</dt><dd>{formatDate(audioFile.uploadedAt)}</dd></div>
                    </dl>
                    {audioFile.rejectionReason && <p className={styles.failureReason}>{audioFile.rejectionReason}</p>}
                  </Card>
                ) : (
                  <Card className={styles.uploadCard}>
                    <form onSubmit={handleUpload}>
                      <InputField
                        label="Archivo de audio"
                        type="file"
                        accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                        required
                        disabled={isUploading}
                        error={fileError}
                        hint="Formatos MP3 o WAV · máximo 100 MB y 15 minutos."
                        onChange={handleFileChange}
                      />
                      <Button type="submit" loading={isUploading} loadingText="Validando audio…" disabled={Boolean(fileError)}>
                        Cargar audio e iniciar
                      </Button>
                    </form>
                  </Card>
                )}
              </section>

              <section className={styles.section} aria-labelledby="processing-title">
                <div className={styles.sectionHeading}>
                  <div><p className={styles.sectionEyebrow}>PROCESAMIENTO ASÍNCRONO</p><h2 id="processing-title">Estado y actividad</h2></div>
                  {isProcessing && <span className={styles.liveStatus}><i /> Actualizando</span>}
                </div>

                {isProcessing && (
                  <div className={styles.processingBanner} role="status" aria-live="polite">
                    <span className={styles.spinner} aria-hidden="true" />
                    <div><strong>{projectStatus === "Pendiente" ? "En espera" : "Analizando el audio"}</strong><span>El estado se consulta automáticamente cada pocos segundos.</span></div>
                  </div>
                )}

                {attempts.length === 0 ? (
                  <Card className={styles.emptyState}><strong>Todavía no hay intentos de procesamiento</strong><p>Carga un archivo de audio válido para iniciar el primer intento.</p></Card>
                ) : (
                  <div className={styles.attemptList}>
                    {attempts.map((attempt) => (
                      <Card key={attempt.id} className={styles.attemptCard}>
                        <div className={styles.attemptTop}>
                          <div><strong>Intento {attempt.attemptNumber}</strong><span>Inició {formatDate(attempt.startedAt)}</span></div>
                          <span className={`${styles.status} ${styles[attempt.status] || ""}`}>{statusLabels[attempt.status] || attempt.status}</span>
                        </div>
                        {attempt.errorMessage && <p className={styles.failureReason}>{attempt.errorMessage}</p>}
                        {attempt.status === "fallido" && attempt === currentAttempt && (
                          <Button onClick={handleRetry} loading={isRetrying} loadingText="Reintentando…">
                            Reintentar procesamiento
                          </Button>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              {project.currentTranscriptionId && project.status === "completado" && (
                <section className={styles.transcriptionCta} aria-labelledby="transcription-cta-title">
                  <div><p className={styles.sectionEyebrow}>RESULTADO DISPONIBLE</p><h2 id="transcription-cta-title">La transcripción está lista</h2><p>Consulta las notas detectadas y guarda una nueva versión con tus correcciones.</p></div>
                  <Button onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/transcription`)}>
                    Revisar transcripción
                  </Button>
                </section>
              )}
            </div>
          )}

          <footer className={styles.footer}><span>Audio2Score · Detalle del proyecto</span><span>Estados consultados desde el backend</span></footer>
        </div>
      </main>
    </div>
  );
}
