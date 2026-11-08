import { useEffect, useState } from 'react'
import { useAuth } from '../context/useAuth'
import { getUserMessage } from '../services/apiClient'
import { projectsService } from '../services/projectsService'
import styles from './DashboardPage.module.css'

function formatDate(value) {
  if (!value) {
    return 'Sin fecha disponible'
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function DashboardPage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let isActive = true
    const startedAt = Date.now()

    projectsService
      .list()
      .then((response) => {
        if (isActive) {
          setProjects(response.items ?? [])
        }
      })
      .catch((error) => {
        if (isActive) {
          setErrorMessage(getUserMessage(error))
        }
      })
      .finally(() => {
  const elapsed = Date.now() - startedAt
  const remaining = Math.max(0, 700 - elapsed)

  window.setTimeout(() => {
    if (isActive) {
      setIsLoading(false)
    }
  }, remaining)
})
    return () => {
      isActive = false
    }
  }, [loadKey])

  function reloadProjects() {
    setErrorMessage('')
    setIsLoading(true)
    setLoadKey((currentKey) => currentKey + 1)
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Audio2Score</p>
          <h1>Mis proyectos</h1>
          <p className={styles.user}>{user?.email}</p>
        </div>

        <button type="button" onClick={reloadProjects} disabled={isLoading}>
          {isLoading ? 'Actualizando…' : 'Actualizar proyectos'}
        </button>
      </header>

      {isLoading && (
        <section className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <p>Cargando proyectos desde el backend…</p>
        </section>
      )}

      {!isLoading && errorMessage && (
        <section className={styles.error} role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={reloadProjects}>
            Reintentar
          </button>
        </section>
      )}

      {!isLoading && !errorMessage && projects.length === 0 && (
        <section className={styles.empty}>
          <h2>Aún no hay proyectos</h2>
          <p>El backend respondió correctamente, pero no hay proyectos asociados a esta cuenta.</p>
        </section>
      )}

      {!isLoading && !errorMessage && projects.length > 0 && (
        <section className={styles.grid} aria-label="Lista de proyectos">
          {projects.map((project) => (
            <article className={styles.projectCard} key={project.id}>
              <p className={styles.status}>{project.status}</p>
              <h2>{project.name}</h2>
              <p>{project.description || 'Sin descripción'}</p>
              <small>Creado: {formatDate(project.createdAt)}</small>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}