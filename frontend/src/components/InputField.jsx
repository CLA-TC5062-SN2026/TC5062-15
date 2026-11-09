import { useId } from "react";
import styles from "./InputField.module.css";

export default function InputField({
  id,
  label,
  type = "text",
  hint,
  error,
  required = false,
  disabled = false,
  className = "",
  inputClassName = "",
  ...inputProps
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
        {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      <input
        {...inputProps}
        id={inputId}
        type={type}
        className={[styles.input, inputClassName].filter(Boolean).join(" ")}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      {hint && <p className={styles.hint} id={hintId}>{hint}</p>}
      {error && <p className={styles.error} id={errorId} role="alert">{error}</p>}
    </div>
  );
}
