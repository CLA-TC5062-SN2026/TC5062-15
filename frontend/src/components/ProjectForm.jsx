import { useEffect, useState } from "react";
import Button from "./Button.jsx";
import InputField from "./InputField.jsx";
import { getApiErrorMessage } from "../services/apiClient.js";
import { projectsService } from "../services/projectsService.js";
import styles from "./ProjectForm.module.css";

function valuesFromProject(project) {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    archived: Boolean(project?.archivedAt),
  };
}

export default function ProjectForm({ project = null, onSuccess, onCancel }) {
  const isEditing = Boolean(project?.id);
  const [values, setValues] = useState(() => valuesFromProject(project));
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValues(valuesFromProject(project));
    setFieldErrors({});
    setServerError("");
  }, [project?.id, project?.name, project?.description, project?.archivedAt]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setServerError("");

    const name = values.name.trim();
    const description = values.description.trim();
    const nextErrors = {};

    if (!name) nextErrors.name = "Escribe el nombre del proyecto.";
    else if (name.length > 120) nextErrors.name = "El nombre no puede superar 120 caracteres.";
    if (description.length > 1000) nextErrors.description = "La descripción no puede superar 1000 caracteres.";

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || isSaving) return;

    const body = { name };
    if (isEditing) {
      body.description = description || null;
      body.archived = values.archived;
    } else if (description) {
      body.description = description;
    }

    setIsSaving(true);
    try {
      const savedProject = isEditing
        ? await projectsService.update(project.id, body)
        : await projectsService.create(body);
      onSuccess?.(savedProject);
    } catch (requestError) {
      setServerError(getApiErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={isSaving}>
      <div className={styles.heading}>
        <p className={styles.eyebrow}>{isEditing ? "ACTUALIZAR" : "NUEVO"} PROYECTO</p>
        <h3>{isEditing ? "Editar proyecto" : "Crear proyecto"}</h3>
        <p>{isEditing ? "Modifica los datos del proyecto." : "Agrega un proyecto a tu espacio de trabajo."}</p>
      </div>

      {serverError && <p className={styles.serverError} role="alert">{serverError}</p>}

      <InputField
        id={isEditing ? `project-form-name-${project.id}` : "new-project-name"}
        label="Nombre del proyecto"
        value={values.name}
        onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
        error={fieldErrors.name}
        maxLength={120}
        required
        autoFocus
        disabled={isSaving}
      />

      <div className={styles.field}>
        <label htmlFor={isEditing ? `project-form-description-${project.id}` : "new-project-description"}>
          Descripción <span>Opcional</span>
        </label>
        <textarea
          id={isEditing ? `project-form-description-${project.id}` : "new-project-description"}
          value={values.description}
          onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
          maxLength={1000}
          rows={3}
          disabled={isSaving}
          aria-invalid={Boolean(fieldErrors.description)}
          aria-describedby={fieldErrors.description ? "project-description-error" : undefined}
        />
        {fieldErrors.description && (
          <p id="project-description-error" className={styles.fieldError} role="alert">
            {fieldErrors.description}
          </p>
        )}
        <small>{values.description.length}/1000 caracteres</small>
      </div>

      {isEditing && (
        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={values.archived}
            onChange={(event) => setValues((current) => ({ ...current, archived: event.target.checked }))}
            disabled={isSaving}
          />
          <span>Proyecto archivado</span>
        </label>
      )}

      <div className={styles.actions}>
        <Button type="submit" loading={isSaving} loadingText="Guardando…">
          {isEditing ? "Guardar cambios" : "Crear proyecto"}
        </Button>
        {onCancel && (
          <Button variant="secondary" type="button" onClick={onCancel} disabled={isSaving}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
