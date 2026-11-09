import styles from "./Button.module.css";

export default function Button({
  variant = "primary",
  loading = false,
  loadingText,
  disabled = false,
  type = "button",
  className = "",
  children,
  ...buttonProps
}) {
  const variantClass = styles[variant] || styles.primary;
  const classes = [styles.button, variantClass, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      <span>{loading ? loadingText || children : children}</span>
    </button>
  );
}
