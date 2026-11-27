import { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import InputField from "../components/InputField.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getApiErrorMessage } from "../services/apiClient.js";
import { authService } from "../services/authService.js";
import styles from "./LoginPage.module.css";

export default function RegisterPage({ navigate }) {
  const { isAuthenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate("/dashboard", { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim();
    if (normalizedEmail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      setError("Escribe un correo electrónico válido.");
      return;
    }
    if (password.length < 15 || password.length > 128) {
      setError("La contraseña debe tener entre 15 y 128 caracteres.");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await authService.register({ email: normalizedEmail, password });
      setRegisteredEmail(normalizedEmail);
    } catch (registrationError) {
      setError(getApiErrorMessage(registrationError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard} aria-labelledby="register-title">
        <a className={styles.brand} href="/register" aria-label="Audio2Score registro">
          <span className={styles.brandIcon}>A2</span>
          <span>
            <strong>Audio2Score</strong>
            <small>Music workspace</small>
          </span>
        </a>

        <p className={styles.eyebrow}>NUEVA CUENTA</p>
        <h1 id="register-title">Crear cuenta</h1>
        <p className={styles.intro}>
          Regístrate para crear y administrar tus proyectos musicales.
        </p>

        {registeredEmail ? (
          <div className={styles.form}>
            <p className={styles.success} role="status">
              La cuenta de {registeredEmail} se creó. Inicia sesión para continuar.
            </p>
            <Button onClick={() => navigate("/login", { replace: true })}>
              Ir al inicio de sesión
            </Button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
            <InputField
              id="register-email"
              label="Correo electrónico"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="nombre@correo.com"
              maxLength={254}
              required
              disabled={isSubmitting}
            />
            <InputField
              id="register-password"
              label="Contraseña"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={15}
              maxLength={128}
              hint="Usa entre 15 y 128 caracteres."
              required
              disabled={isSubmitting}
            />
            <InputField
              id="register-password-confirmation"
              label="Confirmar contraseña"
              type="password"
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
              autoComplete="new-password"
              maxLength={128}
              required
              disabled={isSubmitting}
            />

            {error && <p className={styles.error} role="alert">{error}</p>}

            <Button type="submit" loading={isSubmitting} loadingText="Creando cuenta…">
              Crear cuenta
            </Button>
          </form>
        )}

        {!registeredEmail && (
          <p className={styles.footer}>
            ¿Ya tienes una cuenta?{" "}
            <button className={styles.textLink} type="button" onClick={() => navigate("/login")}>
              Iniciar sesión
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
