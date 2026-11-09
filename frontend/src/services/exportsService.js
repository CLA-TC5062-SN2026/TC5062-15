import { apiRequest } from "./apiClient.js";

const projectPath = (projectId) => `/projects/${encodeURIComponent(projectId)}`;

export const exportsService = {
  create(projectId, data, { idempotencyKey } = {}) {
    const headers = new Headers();
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

    return apiRequest(`${projectPath(projectId)}/exports`, {
      method: "POST",
      body: data,
      headers,
    });
  },

  list(projectId) {
    return apiRequest(`${projectPath(projectId)}/exports`);
  },

  download(projectId, exportId) {
    return apiRequest(
      `${projectPath(projectId)}/exports/${encodeURIComponent(exportId)}/file`,
      { responseType: "blob" },
    );
  },
};
