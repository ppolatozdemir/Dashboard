import axios from "axios";
import { AuthError } from "./error.js";

export class UserServiceClient {
  constructor({
    userServiceUrl,
    applicationId,
    authorizationScheme,
  }) {
    this.userServiceUrl = userServiceUrl;
    this.applicationId = applicationId;
    this.authorizationScheme = authorizationScheme;
  }

  async call(endpoint, { method = "GET", body, token } = {}) {
    try {
      return await axios({
        url: `${this.userServiceUrl}${endpoint}`,
        method,
        data: body,
        timeout: 30000,
        validateStatus: () => true,
        headers: {
          "Content-Type": "application/json",
          "X-Application-ID": this.applicationId,
          ...(token
            ? {
                Authorization:
                  `${this.authorizationScheme} ${token}`.trim(),
              }
            : {}),
        },
      });
    } catch (error) {
      throw new AuthError(
        502,
        error.code === "ECONNABORTED"
          ? "Kimlik servisi zaman aşımına uğradı"
          : "Kimlik servisine ulaşılamadı",
      );
    }
  }
}
