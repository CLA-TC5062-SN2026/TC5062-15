import { useCallback, useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import Navbar from "../components/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getApiErrorMessage } from "../services/apiClient.js";
import { audioFilesService } from "../services/audioFilesService.js";
import { exportsService } from "../services/exportsService.js";
import { projectsService } from "../services/projectsService.js";
import { transcriptionsService } from "../services/transcriptionsService.js";
import styles from "./TranscriptionPage.module.css";

const navigationItems = [
  { href: "/dashboard", label: "Resumen", icon: "⌂" },
  { href: "/projects", label: "Proyectos", icon: "▧" },
];

const pitchPattern = /^[A-G](##?|bb?)?(-1|[0-9])$/;
const exportStatusLabels = {
  pendiente: "En espera",
  generando: "Generando",
  listo: "Listo para descargar",
  fallido: "Fallido",
};

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.()
    || `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateNotes(notes) {
  return notes.findIndex((note) => !pitchPattern.test(note.pitch)
    || !Number.isFinite(note.startTimeSeconds) || note.startTimeSeconds < 0
    || !Number.isFinite(note.durationSeconds) || note.durationSeconds <= 0);
}

function formatDate(value) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Fecha no disponible"
    : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function getStaffPosition(pitch) {
  const match = /^([A-G])(##?|bb?)?(-1|[0-9])$/.exec(pitch || "");
  if (!match) return null;
  const letterIndex = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }[match[1]];
  return { diatonic: Number(match[3]) * 7 + letterIndex, accidental: match[2] };
}

function confidenceColor(confidence) {
  if (confidence == null || !Number.isFinite(Number(confidence))) return "#344f80";
  const hue = Math.round(Math.max(0, Math.min(1, Number(confidence)) * 120));
  return `hsl(${hue} 58% 36%)`;
}

function ScorePreview({ notes, version, isDraft }) {
  const totalSeconds = notes.reduce(
    (maximum, note) => Math.max(maximum, Number(note.startTimeSeconds) + Number(note.durationSeconds)),
    1,
  );
  const scale = Math.max(14, Math.min(140, 840 / Math.max(5, totalSeconds)));
  const width = Math.max(900, Math.ceil(75 + totalSeconds * scale));
  const staffLines = [95, 109, 123, 137, 151];

  return (
    <figure className={styles.scoreFigure}>
      <figcaption id="score-caption">
        Partitura automática de la versión {version}{isDraft ? ". Es un borrador y puede requerir corrección humana." : "."}
        <span>Desplázate horizontalmente para recorrer el audio. La confianza del motor es una estimación, no una probabilidad calibrada.</span>
      </figcaption>
      <div className={styles.scoreViewport} role="region" aria-label="Vista horizontal de la partitura" tabIndex={0}>
        <svg className={styles.scoreSvg} width={width} height="230" viewBox={`0 0 ${width} 230`} role="img" aria-labelledby="score-caption">
          <rect width={width} height="230" rx="12" fill="#fff" />
          {staffLines.map((y) => <line key={y} x1="48" x2={width - 24} y1={y} y2={y} stroke="#a6b2c6" strokeWidth="1.4" />)}
          <text x="20" y="128" fill="#3b588c" fontSize="16" fontWeight="700">𝄞</text>
          <text x="48" y="28" fill="#71809a" fontSize="10">Inicio del audio</text>
          {notes.map((note, index) => {
            const position = getStaffPosition(note.pitch);
            if (!position) return null;
            const x = 66 + Number(note.startTimeSeconds) * scale;
            const y = 151 - (position.diatonic - 30) * 7;
            const ledgerSteps = position.diatonic < 28
              ? Array.from({ length: Math.ceil((28 - position.diatonic) / 2) }, (_, i) => 28 - i * 2)
              : position.diatonic > 40
                ? Array.from({ length: Math.ceil((position.diatonic - 40) / 2) }, (_, i) => 40 + i * 2)
                : [];
            return (
              <g key={`${index}-${note.pitch}`}>
                <title>{`Nota ${index + 1}: ${note.pitch}, inicio ${Number(note.startTimeSeconds).toFixed(2)} segundos, duración ${Number(note.durationSeconds).toFixed(2)} segundos${note.confidence == null ? "" : `, confianza estimada ${Math.round(Number(note.confidence) * 100)} por ciento`}${note.isLowConfidence ? ", requiere revisión" : ""}`}</title>
                {ledgerSteps.map((step) => {
                  const ledgerY = 151 - (step - 30) * 7;
                  return <line key={step} x1={x - 10} x2={x + 10} y1={ledgerY} y2={ledgerY} stroke="#7f8ca0" strokeWidth="1" />;
                })}
                {position.accidental && <text x={x - 15} y={y + 4} textAnchor="end" fill="#50617c" fontSize="10">{position.accidental.replaceAll("b", "♭").replaceAll("#", "♯")}</text>}
                <ellipse cx={x} cy={y} rx="6.3" ry="4.3" transform={`rotate(-18 ${x} ${y})`} fill={confidenceColor(note.confidence)} />
                <line x1={x + 5} x2={x + 5} y1={y} y2={y < 123 ? y + 30 : y - 30} stroke="#344f80" strokeWidth="1.4" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className={styles.scoreLegend}>
        <span><i className={styles.confidenceScale} aria-hidden="true" /> Confianza estimada: rojo = baja, verde = alta</span>
        <span>Las notas bajo el umbral muestran “Requiere revisión” en la tabla.</span>
      </div>
    </figure>
  );
}

export default function TranscriptionPage({ projectId, navigate, onLogout }) {
  const { user, isAuthenticated } = useAuth();
  const [project, setProject] = useState(null);
  const [transcription, setTranscription] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invalidNoteIndex, setInvalidNoteIndex] = useState(-1);
  const [draftNotes, setDraftNotes] = useState([]);
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [exports, setExports] = useState([]);
  const [isLoadingExports, setIsLoadingExports] = useState(true);
  const [exportError, setExportError] = useState("");
  const [creatingFormat, setCreatingFormat] = useState("");
  const [downloadingId, setDownloadingId] = useState("");

  const loadTranscription = useCallback(async () => {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const currentProject = await projectsService.get(projectId);
      setProject(currentProject);
      if (!currentProject.currentTranscriptionId) {
        setTranscription(null);
        setVersions([]);
        setDraftNotes([]);
        setAudioFile(null);
        return;
      }
      const [current, history, audio] = await Promise.all([
        transcriptionsService.getCurrent(projectId),
        transcriptionsService.listVersions(projectId),
        currentProject.audioFileId
          ? audioFilesService.get(projectId, currentProject.audioFileId)
          : Promise.resolve(null),
      ]);
      setTranscription(current);
      setDraftNotes(current.notes || []);
      setVersions(Array.isArray(history?.items) ? history.items : []);
      setSelectedVersionId(current.id);
      setAudioFile(audio);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadTranscription(); }, [loadTranscription]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const loadExports = useCallback(async () => {
    setExportError("");
    try {
      const response = await exportsService.list(projectId);
      setExports(Array.isArray(response?.items) ? response.items : []);
    } catch (loadError) {
      setExportError(getApiErrorMessage(loadError));
    } finally {
      setIsLoadingExports(false);
    }
  }, [projectId]);

  useEffect(() => { loadExports(); }, [loadExports]);

  const hasPendingExports = exports.some((item) => ["pendiente", "generando"].includes(item.status));
  useEffect(() => {
    if (!hasPendingExports) return undefined;
    const timer = window.setInterval(loadExports, 2000);
    return () => window.clearInterval(timer);
  }, [hasPendingExports, loadExports]);

  const visibleTranscription = versions.find((version) => version.id === selectedVersionId) || transcription;
  const isCurrentVersionSelected = visibleTranscription?.id === transcription?.id;
  const displayName = user?.name || user?.email || "Usuario";

  const updateNote = (index, field, value) => {
    setDraftNotes((current) => current.map((note, noteIndex) => {
      if (noteIndex !== index) return note;
      if (field === "startTimeSeconds" || field === "durationSeconds") {
        return { ...note, [field]: value === "" ? Number.NaN : Number(value) };
      }
      return { ...note, [field]: value };
    }));
    setInvalidNoteIndex(-1);
    setNotice("");
  };

  const handleVersionChange = (event) => {
    const nextId = event.target.value;
    setSelectedVersionId(nextId);
    if (nextId === transcription?.id) setDraftNotes(transcription.notes || []);
    setInvalidNoteIndex(-1);
    setNotice("");
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!transcription || !isCurrentVersionSelected || isSaving) return;
    const invalidIndex = validateNotes(draftNotes);
    if (invalidIndex !== -1) {
      setInvalidNoteIndex(invalidIndex);
      setError(`Revisa la nota ${invalidIndex + 1}: tono válido, inicio desde cero y duración mayor que cero.`);
      return;
    }
    setError("");
    setNotice("");
    setIsSaving(true);
    try {
      const updated = await transcriptionsService.createRevision(
        projectId,
        { notes: draftNotes.map((note) => ({
          pitch: note.pitch.trim(),
          startTimeSeconds: note.startTimeSeconds,
          durationSeconds: note.durationSeconds,
          ...(note.confidence === undefined ? {} : { confidence: note.confidence }),
          isEstimated: Boolean(note.isEstimated),
          isLowConfidence: Boolean(note.isLowConfidence),
        })) },
        `"v${transcription.version}"`,
      );
      setTranscription(updated);
      setDraftNotes(updated.notes || []);
      const history = await transcriptionsService.listVersions(projectId);
      setVersions(Array.isArray(history?.items) ? history.items : [updated]);
      setSelectedVersionId(updated.id);
      setNotice(`Se guardó la versión ${updated.version} de la transcripción.`);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateExport = async (format) => {
    if (!transcription || creatingFormat) return;
    setExportError("");
    setCreatingFormat(format);
    try {
      await exportsService.create(projectId, { format }, { idempotencyKey: createIdempotencyKey() });
      await loadExports();
    } catch (createError) {
      setExportError(getApiErrorMessage(createError));
    } finally {
      setCreatingFormat("");
    }
  };

  const handleDownload = async (item) => {
    setExportError("");
    setDownloadingId(item.id);
    try {
      const blob = await exportsService.download(projectId, item.id);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = item.fileName || `Audio2Score.${item.format === "midi" ? "mid" : "pdf"}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadError) {
      setExportError(getApiErrorMessage(downloadError));
    } finally {
      setDownloadingId("");
    }
  };

  const handleLoadAudio = async () => {
    if (!audioFile || isLoadingAudio || audioUrl) return;
    setAudioError("");
    setIsLoadingAudio(true);
    try {
      const audioBlob = await audioFilesService.download(projectId, audioFile.id);
      setAudioUrl(URL.createObjectURL(audioBlob));
    } catch (loadError) {
      setAudioError(getApiErrorMessage(loadError));
    } finally {
      setIsLoadingAudio(false);
    }
  };

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
          }}>Proyectos</a> <span>/</span> <a href={`/projects/${encodeURIComponent(projectId)}`} onClick={(event) => {
            event.preventDefault();
            navigate(`/projects/${encodeURIComponent(projectId)}`);
          }}>Detalle</a> <span>/</span> <strong>Transcripción</strong></div>
          <span className={styles.environment}><i /> Datos de tu cuenta</span>
        </header>

        <div className={styles.content}>
          <section className={styles.heading} aria-labelledby="transcription-title">
            <div>
              <p className={styles.eyebrow}>AUDIO2SCORE <span>·</span> REVISIÓN MUSICAL</p>
              <h1 id="transcription-title">{project?.name || "Transcripción"}</h1>
              <p>Revisa las notas detectadas. Los cambios crean una nueva versión y conservan el historial anterior.</p>
            </div>
            <Button variant="secondary" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>Volver al proyecto</Button>
          </section>

          {isLoading && <section className={styles.loading} role="status" aria-live="polite"><span className={styles.spinner} aria-hidden="true" /><strong>Cargando transcripción…</strong></section>}

          {!isLoading && error && (
            <section className={styles.error} role="alert"><div><strong>No se pudo consultar o guardar la transcripción</strong><p>{error}</p></div><Button variant="secondary" onClick={loadTranscription}>Volver a consultar</Button></section>
          )}

          {!isLoading && !error && !transcription && (
            <Card className={styles.emptyState}>
              <strong>La transcripción todavía no está disponible</strong>
              <p>{project?.status === "procesando" || project?.status === "pendiente" ? "El procesamiento sigue activo. Vuelve al proyecto para consultar su avance." : "El proyecto aún no tiene un resultado de procesamiento."}</p>
              <Button onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>Consultar estado del proyecto</Button>
            </Card>
          )}

          {!isLoading && !error && transcription && (
            <div className={styles.sections}>
              {notice && <p className={styles.notice} role="status">{notice}</p>}
              <section className={styles.metadata} aria-label="Resumen de la transcripción">
                <div><span>Versión vigente</span><strong>v{transcription.version}</strong></div>
                <div><span>Notas</span><strong>{transcription.notes?.length ?? 0}</strong></div>
                <div><span>Actualizada</span><strong>{formatDate(transcription.updatedAt || transcription.createdAt)}</strong></div>
                {transcription.tempoEstimated != null && <div><span>Tempo estimado</span><strong>{transcription.tempoEstimated} BPM</strong></div>}
                {transcription.keyEstimated && <div><span>Tonalidad estimada</span><strong>{transcription.keyEstimated}</strong></div>}
              </section>

              {transcription.summary?.estimatedFields?.length > 0 && (
                <p className={styles.estimateNotice}>Algunos datos del resumen son estimaciones automáticas: {transcription.summary.estimatedFields.join(", ")}.</p>
              )}

              <section className={styles.section} aria-labelledby="notes-title">
                <div className={styles.sectionHeading}>
                  <div><p className={styles.sectionEyebrow}>PARTITURA DETECTADA</p><h2 id="notes-title">Notas de la transcripción</h2></div>
                  <label className={styles.versionSelectLabel} htmlFor="transcription-version">Versión
                    <select id="transcription-version" value={selectedVersionId} onChange={handleVersionChange}>
                      {versions.map((version) => <option key={version.id} value={version.id}>v{version.version}{version.id === transcription.id ? " (vigente)" : ""}</option>)}
                    </select>
                  </label>
                </div>

                <Card className={styles.audioCard}>
                  <div className={styles.audioHeading}>
                    <div><p className={styles.sectionEyebrow}>COMPARACIÓN</p><h3>Audio original</h3></div>
                    {audioFile && <span>{audioFile.originalFilename} · {audioFile.format}</span>}
                  </div>
                  {audioUrl ? (
                    <audio className={styles.audioPlayer} controls preload="metadata" src={audioUrl} aria-label={`Audio original del proyecto ${project?.name || ""}`}>
                      Tu navegador no puede reproducir este formato de audio.
                    </audio>
                  ) : (
                    <div className={styles.audioAction}>
                      <p>Escucha el archivo mientras revisas las notas y las marcas de baja confianza en la partitura.</p>
                      <Button onClick={handleLoadAudio} loading={isLoadingAudio} loadingText="Cargando audio…" disabled={!audioFile}>
                        Cargar audio para comparar
                      </Button>
                    </div>
                  )}
                  {audioError && <p className={styles.exportError} role="alert">{audioError}</p>}
                </Card>

                <Card className={styles.scoreCard}>
                  <ScorePreview
                    notes={visibleTranscription?.notes || []}
                    version={visibleTranscription?.version}
                    isDraft={visibleTranscription?.isDraft}
                  />
                </Card>

                <Card className={styles.tableCard}>
                  {!isCurrentVersionSelected && <p className={styles.readOnlyNotice} role="status">Estás consultando una versión anterior. Selecciona la versión vigente para editar.</p>}
                  <form onSubmit={handleSave}>
                    <div className={styles.tableScroll}>
                      <table>
                        <caption>{visibleTranscription?.notes?.length ?? 0} notas. Los tonos siguen la notación MIDI internacional.</caption>
                        <thead><tr><th scope="col">#</th><th scope="col">Tono</th><th scope="col">Inicio (s)</th><th scope="col">Duración (s)</th><th scope="col">Revisar</th></tr></thead>
                        <tbody>
                          {(isCurrentVersionSelected ? draftNotes : visibleTranscription?.notes || []).map((note, index) => (
                            <tr key={`${visibleTranscription?.id}-${index}`} className={index === invalidNoteIndex ? styles.invalidRow : ""}>
                              <th scope="row">{index + 1}</th>
                              <td><div className={styles.pitchCell}><input aria-label={`Nota ${index + 1}, tono`} value={note.pitch} onChange={(event) => updateNote(index, "pitch", event.target.value)} disabled={!isCurrentVersionSelected || isSaving} maxLength={5} />{note.isLowConfidence && <span className={styles.reviewBadge}>Requiere revisión</span>}</div></td>
                              <td><input aria-label={`Nota ${index + 1}, segundo de inicio`} type="number" min="0" step="0.01" value={Number.isFinite(note.startTimeSeconds) ? note.startTimeSeconds : ""} onChange={(event) => updateNote(index, "startTimeSeconds", event.target.value)} disabled={!isCurrentVersionSelected || isSaving} /></td>
                              <td><input aria-label={`Nota ${index + 1}, duración en segundos`} type="number" min="0.01" step="0.01" value={Number.isFinite(note.durationSeconds) ? note.durationSeconds : ""} onChange={(event) => updateNote(index, "durationSeconds", event.target.value)} disabled={!isCurrentVersionSelected || isSaving} /></td>
                              <td><label className={styles.checkLabel}><input type="checkbox" aria-label={`Marcar nota ${index + 1} para revisión`} checked={Boolean(note.isLowConfidence)} onChange={(event) => updateNote(index, "isLowConfidence", event.target.checked)} disabled={!isCurrentVersionSelected || isSaving} /><span>{note.isLowConfidence ? "Sí" : "No"}</span></label></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {isCurrentVersionSelected && <div className={styles.formActions}><p>Guardar correcciones crea una versión nueva; la versión anterior se conserva.</p><Button type="submit" loading={isSaving} loadingText="Guardando versión…">Guardar correcciones</Button></div>}
                  </form>
                </Card>
              </section>

              <section className={styles.section} aria-labelledby="exports-title">
                <div className={styles.sectionHeading}>
                  <div><p className={styles.sectionEyebrow}>ARCHIVOS DE SALIDA</p><h2 id="exports-title">Exportar transcripción</h2></div>
                </div>
                <Card className={styles.exportsCard}>
                  <p className={styles.exportDescription}>Genera un archivo MIDI para abrir las notas en un editor musical o un PDF con partitura esquemática y resumen de las notas.</p>
                  <div className={styles.exportActions}>
                    <Button onClick={() => handleCreateExport("midi")} loading={creatingFormat === "midi"} loadingText="Solicitando MIDI…" disabled={Boolean(creatingFormat)}>Generar MIDI</Button>
                    <Button variant="secondary" onClick={() => handleCreateExport("pdf")} loading={creatingFormat === "pdf"} loadingText="Solicitando PDF…" disabled={Boolean(creatingFormat)}>Generar PDF</Button>
                    <Button variant="secondary" onClick={loadExports} disabled={isLoadingExports}>Actualizar archivos</Button>
                  </div>
                  {exportError && <p className={styles.exportError} role="alert">{exportError}</p>}
                  {isLoadingExports ? <p className={styles.exportLoading} role="status">Consultando exportaciones…</p> : exports.length === 0 ? (
                    <p className={styles.exportEmpty}>Aún no hay exportaciones para este proyecto.</p>
                  ) : (
                    <ul className={styles.exportList}>
                      {exports.map((item) => (
                        <li key={item.id}>
                          <div className={styles.exportItemInfo}>
                            <strong>{item.fileName || `Audio2Score.${item.format}`}</strong>
                            <span className={`${styles.exportStatus} ${styles[item.status] || ""}`}>{exportStatusLabels[item.status] || item.status}</span>
                            {item.draftNotice && <small>{item.draftNotice}</small>}
                          </div>
                          {item.status === "listo" && <Button variant="secondary" onClick={() => handleDownload(item)} loading={downloadingId === item.id} loadingText="Descargando…" disabled={Boolean(downloadingId)}>Descargar</Button>}
                          {item.status === "fallido" && <span className={styles.exportFailure}>No se pudo generar este archivo.</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            </div>
          )}

          <footer className={styles.footer}><span>Audio2Score · Revisión de transcripción</span><span>Datos guardados como versiones en el backend</span></footer>
        </div>
      </main>
    </div>
  );
}
