import { apiRequest, ApiError } from "./apiClient.js";
import { clearAccessToken, setAccessToken } from "./tokenStore.js";

export const authService = {
  register(data) {
    return apiRequest("/auth/register", {
      method: "POST",
      body: data,
      auth: false,
    });
  },

  async login(credentials) {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: credentials,
      auth: false,
    });

    if (!result?.accessToken) {
      throw new ApiError("La respuesta de inicio de sesión no incluyó un token válido.", {
        code: "MISSING_ACCESS_TOKEN",
        kind: "protocol",
      });
    }

    setAccessToken(result.accessToken);
    return result;
  },

  async logout() {
    try {
      return await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      clearAccessToken();
    }
  },

  getCurrentUser() {
    return apiRequest("/auth/me");
  },
};
