import { apiRequest, ApiError } from "./apiClient.js";

const projectPath = (projectId) => `/projects/${encodeURIComponent(projectId)}`;

export const transcriptionsService = {
  getCurrent(projectId) {
    return apiRequest(`${projectPath(projectId)}/transcriptions/current`);
  },

  createRevision(projectId, data, ifMatch) {
    if (!ifMatch) {
      throw new ApiError(
        "No se puede guardar la revisión sin la versión actual (ETag). Vuelve a consultar la transcripción e inténtalo de nuevo.",
        { code: "MISSING_IF_MATCH", kind: "validation" },
      );
    }

    const headers = new Headers();
    headers.set("If-Match", ifMatch);

    return apiRequest(
      `${projectPath(projectId)}/transcriptions/current/revisions`,
      { method: "POST", body: data, headers },
    );
  },

  listVersions(projectId) {
    return apiRequest(`${projectPath(projectId)}/transcriptions/versions`);
  },
};
