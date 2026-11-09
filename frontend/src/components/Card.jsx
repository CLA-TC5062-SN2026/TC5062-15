import styles from "./Card.module.css";

export default function Card({
  as: Element = "article",
  title,
  description,
  footer,
  className = "",
  children,
  ...elementProps
}) {
  const classes = [styles.card, className].filter(Boolean).join(" ");

  return (
    <Element {...elementProps} className={classes}>
      {title && <h3 className={styles.title}>{title}</h3>}
      {description && <p className={styles.description}>{description}</p>}
      {children}
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </Element>
  );
}
