import { apiRequest } from './apiClient'

export const projectsService = {
  list({ includeArchived = false } = {}) {
    const query = new URLSearchParams({
      includeArchived: String(includeArchived),
    })

    return apiRequest(`/projects?${query}`)
  },

  getById(projectId) {
    return apiRequest(`/projects/${encodeURIComponent(projectId)}`)
  },

  create(project) {
    return apiRequest('/projects', {
      method: 'POST',
      body: project,
    })
  },

  update(projectId, changes) {
    return apiRequest(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: changes,
    })
  },

  remove(projectId) {
    return apiRequest(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    })
  },
}
