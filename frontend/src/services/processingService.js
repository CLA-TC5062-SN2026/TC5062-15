import { apiRequest } from "./apiClient.js";

const projectPath = (projectId) => `/projects/${encodeURIComponent(projectId)}`;

export const processingService = {
  completeConfiguration(projectId, configuration) {
    return apiRequest(
      `${projectPath(projectId)}/processing-configurations/current`,
      { method: "PUT", body: configuration },
    );
  },

  listAttempts(projectId) {
    return apiRequest(`${projectPath(projectId)}/processing-attempts`);
  },

  getAttempt(projectId, attemptId) {
    return apiRequest(
      `${projectPath(projectId)}/processing-attempts/${encodeURIComponent(attemptId)}`,
    );
  },

  retryAttempt(projectId, attemptId, data, { idempotencyKey } = {}) {
    const headers = new Headers();
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

    return apiRequest(
      `${projectPath(projectId)}/processing-attempts/${encodeURIComponent(attemptId)}/retry`,
      { method: "POST", body: data, headers },
    );
  },
};
