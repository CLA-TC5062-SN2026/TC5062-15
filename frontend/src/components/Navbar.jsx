import Button from "./Button.jsx";
import styles from "./Navbar.module.css";

export default function Navbar({
  items = [],
  activeHref,
  isAuthenticated = false,
  userName = "",
  onLogin,
  onLogout,
  onNavigate,
  showAccountAction = true,
  ariaLabel = "Navegación principal",
  className = "",
}) {
  const initial = userName.trim().charAt(0).toUpperCase() || "U";
  const accountAction = isAuthenticated ? onLogout : onLogin;

  return (
    <nav
      className={[styles.navbar, className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      <ul className={styles.items}>
        {items.map(({ href, label, icon }) => {
          const isActive = href === activeHref;
          return (
            <li key={href}>
              <a
                href={href}
                className={[styles.link, isActive ? styles.active : ""]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  if (onNavigate && href.startsWith("/")) {
                    event.preventDefault();
                    onNavigate(href);
                  }
                }}
              >
                {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
                <span>{label}</span>
              </a>
            </li>
          );
        })}
      </ul>

      <div className={styles.account}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {isAuthenticated ? initial : "?"}
          </span>
          <span className={styles.accountText}>
            <strong>{isAuthenticated ? userName || "Usuario" : "Invitado"}</strong>
            <small>{isAuthenticated ? "Sesión activa" : "Sin autenticar"}</small>
          </span>
        </div>
        {showAccountAction && (
          <Button
            variant="secondary"
            className={styles.authButton}
            type="button"
            onClick={accountAction}
            disabled={!accountAction}
          >
            {isAuthenticated ? "Cerrar sesión" : "Iniciar sesión"}
          </Button>
        )}
      </div>
    </nav>
  );
}
