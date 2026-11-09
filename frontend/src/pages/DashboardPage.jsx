import { useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FeatureCard from "../components/FeatureCard.jsx";
import InputField from "../components/InputField.jsx";
import Navbar from "../components/Navbar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { API_BASE_URL } from "../services/apiClient.js";
import styles from "./DashboardPage.module.css";

const features = [
  {
    number: "01",
    title: "Proyectos",
    description: "Organiza trabajos musicales y parámetros de procesamiento.",
    status: "Disponible",
  },
  {
    number: "02",
    title: "Audio",
    description: "Carga y valida archivos MP3 o WAV.",
  },
  {
    id: "transcripcion",
    number: "03",
    title: "Transcripción",
    description: "Revisa notas, indicadores de confianza y correcciones.",
  },
  {
    number: "04",
    title: "Exportaciones",
    description: "Prepara partituras en formato MIDI o PDF.",
  },
];

const navigationItems = [
  { href: "/dashboard", label: "Resumen", icon: "⌂" },
  { href: "/projects", label: "Proyectos", icon: "▧" },
  { href: "#transcripcion", label: "Transcripciones", icon: "♫" },
];

export default function DashboardPage({ navigate }) {
  const { user, isAuthenticated } = useAuth();
  const [projectName, setProjectName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const saveTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const handleDemoSubmit = (event) => {
    event.preventDefault();
    setSubmitted(true);
    setSaveMessage("");

    if (!projectName.trim() || isSaving) return;

    setIsSaving(true);
    saveTimer.current = window.setTimeout(() => {
      setIsSaving(false);
      setSaveMessage("Guardado localmente. Este ejemplo no envía datos al API.");
    }, 700);
  };

  const handleDemoReset = () => {
    setProjectName("");
    setSubmitted(false);
    setSaveMessage("");
  };

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="#resumen" aria-label="Audio2Score inicio">
          <span className={styles.brandIcon}>A2</span>
          <span><strong>Audio2Score</strong><small>Music workspace</small></span>
        </a>

        <p className={styles.sidebarCaption}>ESPACIO DE TRABAJO</p>
        <Navbar
          items={navigationItems}
          activeHref="/dashboard"
          onNavigate={navigate}
          isAuthenticated={isAuthenticated}
          userName={user?.name || user?.email || "Usuario"}
          showAccountAction={false}
        />
      </aside>

      <main className={styles.main} id="resumen">
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>Workspace <span>/</span> <strong>Resumen</strong></div>
          <span className={styles.environment}><i /> Sesión autenticada</span>
        </header>

        <div className={styles.content}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>AUDIO2SCORE <span>·</span> CONSTRUCCIÓN DEL FRONTEND</p>
              <h1>La base para darle forma a tu música.</h1>
              <p className={styles.heroText}>
                El scaffolding inicial está listo. Aquí crecerán los flujos para cargar
                audio, revisar transcripciones y preparar exportaciones.
              </p>
              <div className={styles.tags}>
                <span>React</span><span>Vite</span><span>CSS Modules</span>
              </div>
            </div>
            <div className={styles.art} aria-hidden="true">
              <div className={styles.orbit + " " + styles.orbitOuter} />
              <div className={styles.orbit + " " + styles.orbitInner} />
              <div className={styles.bars}>
                <i /><i /><i /><i /><i /><i /><i /><i /><i />
              </div>
              <span className={styles.note}>♪</span>
              <small>AUDIO → PARTITURA</small>
            </div>
          </section>

          <section className={styles.section} id="proyectos">
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionEyebrow}>MÓDULOS DEL PROYECTO</p>
                <h2>Flujos principales</h2>
              </div>
              <span className={styles.hint}>Estructura preparada para conectar</span>
            </div>
            <div className={styles.grid}>
              {features.map((feature) => (
                <FeatureCard key={feature.number} {...feature} />
              ))}
            </div>
          </section>

          <section className={styles.demoSection} aria-labelledby="componentes-title">
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionEyebrow}>PRIMITIVAS DE INTERFAZ</p>
                <h2 id="componentes-title">Componentes base</h2>
              </div>
              <span className={styles.hint}>Ejemplos locales para revisar estados y props</span>
            </div>
            <Card
              className={styles.demoCard}
              title="Validación de proyecto"
              description="El ejemplo permite revisar etiqueta, error visual y estado de carga sin enviar información al backend."
            >
              <form className={styles.demoForm} onSubmit={handleDemoSubmit} noValidate>
                <InputField
                  id="demo-project-name"
                  label="Nombre del proyecto"
                  placeholder="Ej. Cuarteto de cuerdas"
                  value={projectName}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    setSaveMessage("");
                  }}
                  hint="Campo de muestra; los datos permanecen en esta pantalla."
                  error={submitted && !projectName.trim() ? "Escribe un nombre para continuar." : undefined}
                  required
                  disabled={isSaving}
                />
                {saveMessage && <p className={styles.demoSuccess} role="status">{saveMessage}</p>}
                <div className={styles.demoActions}>
                  <Button
                    className={styles.demoButton}
                    type="submit"
                    loading={isSaving}
                    loadingText="Guardando…"
                  >
                    Guardar ejemplo
                  </Button>
                  <Button
                    className={styles.demoButton}
                    type="button"
                    variant="secondary"
                    onClick={handleDemoReset}
                    disabled={isSaving}
                  >
                    Limpiar
                  </Button>
                </div>
              </form>
            </Card>
          </section>

          <section className={styles.api} aria-label="Configuración de API">
            <div className={styles.apiIcon}>↗</div>
            <div className={styles.apiText}>
              <p>CONFIGURACIÓN DEL ENTORNO</p>
              <h2>API base</h2>
              <span>Se puede cambiar en el archivo local <code>.env</code>.</span>
            </div>
            <code className={styles.apiUrl}>{API_BASE_URL}</code>
          </section>

          <footer className={styles.footer}>
            <span>Audio2Score · Scaffolding inicial</span>
            <span>Base para integración por etapas</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
