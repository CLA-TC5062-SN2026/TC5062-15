import { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import InputField from "../components/InputField.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { authService } from "../services/authService.js";
import { getApiErrorMessage } from "../services/apiClient.js";
import styles from "./LoginPage.module.css";

export default function LoginPage({ navigate, onLoginSuccess }) {
  const { isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const session = await authService.login({
        email: email.trim(),
        password,
      });
      onLoginSuccess(session);
    } catch (loginError) {
      setError(getApiErrorMessage(loginError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard} aria-labelledby="login-title">
        <a className={styles.brand} href="/login" aria-label="Audio2Score inicio de sesión">
          <span className={styles.brandIcon}>A2</span>
          <span>
            <strong>Audio2Score</strong>
            <small>Music workspace</small>
          </span>
        </a>

        <p className={styles.eyebrow}>BIENVENIDO DE NUEVO</p>
        <h1 id="login-title">Inicia sesión</h1>
        <p className={styles.intro}>
          Accede a tus proyectos y continúa trabajando en tu música.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <InputField
            id="login-email"
            label="Correo electrónico"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            placeholder="nombre@correo.com"
            required
            disabled={isSubmitting}
          />
          <InputField
            id="login-password"
            label="Contraseña"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Ingresa tu contraseña"
            required
            disabled={isSubmitting}
          />

          {error && <p className={styles.error} role="alert">{error}</p>}

          <Button type="submit" loading={isSubmitting} loadingText="Ingresando…">
            Iniciar sesión
          </Button>
        </form>

        <p className={styles.footer}>Tu sesión se mantiene en memoria mientras esta pestaña está abierta.</p>
      </section>
    </main>
  );
}
