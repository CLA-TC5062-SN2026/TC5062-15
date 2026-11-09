import { apiRequest } from "./apiClient.js";

export const audioFilesService = {
  upload(projectId, file) {
    const formData = new FormData();
    formData.append("file", file);

    return apiRequest(
      `/projects/${encodeURIComponent(projectId)}/audio-files`,
      { method: "POST", body: formData },
    );
  },

  get(projectId, audioFileId) {
    return apiRequest(
      `/projects/${encodeURIComponent(projectId)}/audio-files/${encodeURIComponent(audioFileId)}`,
    );
  },
};
