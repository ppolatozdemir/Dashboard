import axios from "axios";
import { AuthError } from "./error.js";

export class NotificationClient {
  constructor({
    serviceUrl =
      process.env.NOTIFICATION_SERVICE_URL ||
      "https://communication.prod.hebiar.com",
    serviceToken = process.env.NOTIFICATION_SERVICE_TOKEN,
    messageTypeEmail = process.env.NOTIFICATION_MESSAGE_TYPE_EMAIL || "2",
  } = {}) {
    this.serviceUrl = serviceUrl?.replace(/\/$/, "");
    this.serviceToken = serviceToken;
    this.messageTypeEmail = messageTypeEmail;
  }

  get configured() {
    return Boolean(
      this.serviceUrl &&
        this.serviceToken &&
        this.messageTypeEmail !== undefined &&
        Number.isInteger(Number(this.messageTypeEmail)),
    );
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.serviceToken}`,
    };
  }

  async call(endpoint, body) {
    if (!this.configured) {
      console.error("[OTP notification] Configuration missing", {
        hasServiceUrl: Boolean(this.serviceUrl),
        hasServiceToken: Boolean(this.serviceToken),
        messageTypeEmail: this.messageTypeEmail,
      });
      throw new AuthError(503, "Bildirim servisi yapılandırılmamış");
    }
    const url = `${this.serviceUrl}${endpoint}`;
    console.info("[OTP notification] Sending request", {
      url,
      subject: body.subject,
      recipients: body.to,
      providerType: body.provider_type,
      messageType: body.message_type,
      messageLength: body.message?.length,
    });
    try {
      const response = await axios({
        url,
        method: "POST",
        data: body,
        timeout: 10000,
        headers: this.headers(),
        validateStatus: () => true,
      });
      console.info("[OTP notification] Received response", {
        url,
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      });
      return response;
    } catch (error) {
      console.error("[OTP notification] Request failed", {
        url,
        code: error.code,
        message: error.message,
      });
      throw new AuthError(
        502,
        error.code === "ECONNABORTED"
          ? "Bildirim servisi zaman aşımına uğradı"
          : "Bildirim servisine ulaşılamadı",
      );
    }
  }

  async sendNotification({ email, otpCode }) {
    const response = await this.call("/Notification/SendNotificationSync", {
      subject: "Şifre sıfırlama kodunuz",
      message: `<h3>Şifre sıfırlama</h3><p>Şifre sıfırlama kodunuz: <strong>${otpCode}</strong></p><p>Bu kod 15 dakika geçerlidir.</p>`,
      to: [email],
      provider_type: 1,
      message_type: Number(this.messageTypeEmail),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new AuthError(502, "OTP bildirimi gönderilemedi");
    }
    const data = response.data || {};
    const result = data.data && typeof data.data === "object" ? data.data : data;
    if (
      data.success === false ||
      data.isSuccess === false ||
      result.success === false ||
      result.isSuccess === false
    ) {
      throw new AuthError(502, "OTP bildirimi gönderilemedi");
    }
    return response.data;
  }
}

export default NotificationClient;
