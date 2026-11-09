import { apiRequest, withQuery } from "./apiClient.js";

const projectPath = (projectId) => `/projects/${encodeURIComponent(projectId)}`;

export const projectsService = {
  list({ includeArchived } = {}) {
    return apiRequest(withQuery("/projects", { includeArchived }));
  },

  create(data) {
    return apiRequest("/projects", { method: "POST", body: data });
  },

  get(projectId) {
    return apiRequest(projectPath(projectId));
  },

  update(projectId, changes) {
    return apiRequest(projectPath(projectId), {
      method: "PATCH",
      body: changes,
    });
  },

  remove(projectId) {
    return apiRequest(projectPath(projectId), { method: "DELETE" });
  },
};
