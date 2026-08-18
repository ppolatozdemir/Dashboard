import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import supportReportService from "./support-report.js";
import { isConfigured, getConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Task oluşturma ekranı tamamen Hebiar Jira kapsamında çalışır.
// getConfig().baseUrl Olka'yı gösterebildiği için sabit URL kullanılır.
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_WEEKLY_BOARD_ID = process.env.HEBIAR_WEEKLY_BOARD_ID || "54";

class DashboardServer {
  constructor() {
    this.app = express();
    this.port = 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  async getHebiarClient(apiPath = "/rest/api/3") {
    const { email, apiToken } = getConfig();
    const axios = (await import("axios")).default;
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

    return axios.create({
      baseURL: `${HEBIAR_BASE_URL}${apiPath}`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 30000,
    });
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: "10mb" }));
    // HTML asla cache'lenmemeli: eski dashboard.html yeni API şemasıyla uyuşmayıp
    // sekmelerin boş/sıfır görünmesine yol açıyor.
    this.app.use(
      express.static(path.join(__dirname, "../public"), {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache, must-revalidate");
          }
        },
      }),
    );
  }

  setupRoutes() {
    // Ana sayfa
    this.app.get("/", (req, res) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.sendFile(path.join(__dirname, "../public/dashboard.html"));
    });

    // Yapılandırma kontrolü
    this.app.get("/api/config/status", (req, res) => {
      res.json({
        configured: isConfigured(),
        defaultProject: getConfig().defaultProject || null,
      });
    });

    // Projeler listesi (Hebiar Jira)
    this.app.get("/api/projects", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const client = await this.getHebiarClient();
        const projects = [];
        let startAt = 0;

        for (let page = 0; page < 50; page++) {
          const response = await client.get("/project/search", {
            params: { startAt, maxResults: 50, orderBy: "name" },
          });
          const values = response.data.values || [];
          projects.push(...values);
          if (response.data.isLast || values.length === 0) break;
          startAt += values.length;
        }

        res.json(
          projects.map((p) => ({
            key: p.key,
            name: p.name,
            id: p.id,
          })),
        );
      } catch (error) {
        console.error(
          "Proje listesi hatası:",
          error.response?.data || error.message,
        );
        res.status(500).json({ error: error.message });
      }
    });

    // Projedeki kişiler
    this.app.get("/api/people/:projectKey", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { projectKey } = req.params;
        const people = await supportReportService.getProjectPeople(projectKey);
        res.json(people);
      } catch (error) {
        console.error("Kişi listesi hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Günlük iş yükü raporu (tüm projeler - aktif sprint + support)
    this.app.get("/api/daily-report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const report = await supportReportService.getDailyWorkloadReport();
        res.json(report);
      } catch (error) {
        console.error("Günlük rapor hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Günlük kapanan task raporu
    this.app.get("/api/daily-closed", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { date } = req.query;
        const report = await supportReportService.getDailyClosedReport(
          date || null,
        );
        res.json(report);
      } catch (error) {
        console.error("Günlük kapanan rapor hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Proje sprint raporu (CL-SC için)
    this.app.get("/api/sprint-report/:projectKey", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { projectKey } = req.params;
        const report =
          await supportReportService.getProjectSprintReport(projectKey);
        res.json(report);
      } catch (error) {
        console.error("Sprint rapor hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Sprint uyarı maili gönder
    this.app.post("/api/sprint-alerts/:projectKey", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { projectKey } = req.params;
        const alertData =
          await supportReportService.prepareSprintAlerts(projectKey);

        // SMTP ayarları kontrolü
        const smtpHost = process.env.SMTP_HOST;
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;

        if (!smtpHost || !smtpUser || !smtpPass) {
          // SMTP yoksa alert bilgilerini döndür (manuel gönderim için)
          const alertsWithContent = alertData.alerts.map((alert) => {
            const taskList = alert.tasks
              .map((t) => `• ${t.key}: ${t.summary}`)
              .join("\n");
            return {
              personName: alert.personName,
              email: alert.email || "Email bulunamadı",
              taskCount: alert.taskCount,
              subject: `⚠️ Sprint Uyarısı: ${alert.taskCount} açık task - ${alert.sprintName}`,
              body: `Merhaba ${alert.personName},\n\n${alert.sprintName} sprint'i ${alert.sprintEndDate} tarihinde sona erecek.\nSprint'e ${alert.daysUntilEnd} gün kaldı.\n\nÜzerinizde ${alert.taskCount} adet açık task bulunmaktadır:\n\n${taskList}\n\nBu taskları sprint bitimine kadar tamamlamanız gerekmektedir.\n\nSaygılarımızla,\nProje Yönetimi`,
            };
          });

          return res.json({
            success: false,
            message:
              "SMTP yapılandırması eksik. Mail gönderilemedi ancak alert içerikleri hazırlandı.",
            smtpConfigured: false,
            sentCount: 0,
            totalAlerts: alertData.alerts.length,
            sprintName: alertData.sprintName,
            daysUntilEnd: alertData.daysUntilEnd,
            alerts: alertsWithContent,
          });
        }

        // Mail gönderme işlemi
        const nodemailer = await import("nodemailer");

        const transporter = nodemailer.default.createTransport({
          host: smtpHost,
          port: parseInt(process.env.SMTP_PORT || "587"),
          secure: process.env.SMTP_SECURE === "true",
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        let sentCount = 0;
        const errors = [];
        const sent = [];

        for (const alert of alertData.alerts) {
          if (!alert.email) {
            errors.push(`${alert.personName}: Email adresi bulunamadı`);
            continue;
          }

          const taskList = alert.tasks
            .map((t) => `• ${t.key}: ${t.summary}`)
            .join("\n");

          const mailContent = `
Merhaba ${alert.personName},

${alert.sprintName} sprint'i ${alert.sprintEndDate} tarihinde sona erecek.
Sprint'e ${alert.daysUntilEnd} gün kaldı.

Üzerinizde ${alert.taskCount} adet açık task bulunmaktadır:

${taskList}

Bu taskları sprint bitimine kadar tamamlamanız gerekmektedir.
Eğer yetiştiremeyeceğinizi düşünüyorsanız, lütfen proje yöneticinize başvurunuz.

Saygılarımızla,
Proje Yönetimi
          `.trim();

          try {
            await transporter.sendMail({
              from: process.env.SMTP_FROM || smtpUser,
              to: alert.email,
              subject: `⚠️ Sprint Uyarısı: ${alert.taskCount} açık task - ${alert.sprintName}`,
              text: mailContent,
            });
            sentCount++;
            sent.push({ name: alert.personName, email: alert.email });
            console.log(
              `✅ Mail gönderildi: ${alert.personName} (${alert.email})`,
            );
          } catch (mailError) {
            errors.push(`${alert.personName}: ${mailError.message}`);
            console.error(
              `❌ Mail gönderilemedi: ${alert.personName}`,
              mailError.message,
            );
          }
        }

        res.json({
          success: true,
          message: `Sprint uyarı mailleri gönderildi`,
          smtpConfigured: true,
          sentCount,
          totalAlerts: alertData.alerts.length,
          sprintName: alertData.sprintName,
          daysUntilEnd: alertData.daysUntilEnd,
          sent,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        console.error("Sprint alert hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Tam rapor
    this.app.get("/api/report/:projectKey", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { projectKey } = req.params;
        const {
          period = "all",
          startDate,
          endDate,
          personId,
          personType = "all",
        } = req.query;

        const report = await supportReportService.generateFullReport(
          projectKey,
          period,
          startDate,
          endDate,
          personId || null,
          personType,
        );
        res.json(report);
      } catch (error) {
        console.error("Rapor hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Özet istatistikler
    this.app.get("/api/stats/:projectKey", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { projectKey } = req.params;
        const report =
          await supportReportService.generateFullReport(projectKey);

        res.json({
          summary: report.summary,
          averageResolutionTime: report.averageResolutionTime,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // En uzun kapanan task'lar
    this.app.get("/api/longest/:projectKey", async (req, res) => {
      try {
        const { projectKey } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const closedIssues =
          await supportReportService.getClosedIssues(projectKey);
        const longest = supportReportService.getLongestResolutionIssues(
          closedIssues,
          limit,
        );

        res.json(longest);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // En hızlı kapanan task'lar
    this.app.get("/api/fastest/:projectKey", async (req, res) => {
      try {
        const { projectKey } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const closedIssues =
          await supportReportService.getClosedIssues(projectKey);
        const fastest = supportReportService.getFastestResolutionIssues(
          closedIssues,
          limit,
        );

        res.json(fastest);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // En çok task oluşturanlar
    this.app.get("/api/reporters/:projectKey", async (req, res) => {
      try {
        const { projectKey } = req.params;
        const limit = parseInt(req.query.limit) || 15;

        const closedIssues =
          await supportReportService.getClosedIssues(projectKey);
        const openIssues = await supportReportService.getOpenIssues(projectKey);
        const allIssues = [...closedIssues, ...openIssues];

        const reporters = supportReportService.getTopReporters(
          allIssues,
          limit,
        );
        res.json(reporters);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // En çok task çözenler
    this.app.get("/api/resolvers/:projectKey", async (req, res) => {
      try {
        const { projectKey } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const closedIssues =
          await supportReportService.getClosedIssues(projectKey);
        const resolvers = supportReportService.getTopResolvers(
          closedIssues,
          limit,
        );

        res.json(resolvers);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Kullanıcı listesi (Hebiar Jira)
    this.app.get("/api/users", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const client = await this.getHebiarClient();

        // Tüm kullanıcıları çekmek için genel arama
        const response = await client.get("/user/search", {
          params: { query: "", maxResults: 1000 },
        });
        const users = response.data || [];

        res.json(
          users.map((u) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress,
          })),
        );
      } catch (error) {
        console.error("Kullanıcı listesi hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Sprint listesi (Hebiar weekly board)
    this.app.get("/api/sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const client = await this.getHebiarClient("/rest/agile/1.0");

        // Board 54'ten tüm aktif ve future sprintleri çek
        const response = await client.get(
          `/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint`,
          {
            params: { state: "active,future" },
          },
        );

        const sprints = response.data.values || [];

        res.json(
          sprints.map((s) => ({
            id: s.id,
            name: s.name,
            state: s.state,
          })),
        );
      } catch (error) {
        console.error("Sprint listesi hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Tüm sprintler (Autocomplete için — Hebiar weekly board)
    this.app.get("/api/all-sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const client = await this.getHebiarClient("/rest/agile/1.0");

        // Board 54'ten tüm aktif ve future sprintleri çek
        const response = await client.get(
          `/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint`,
          {
            params: { state: "active,future", maxResults: 100 },
          },
        );

        const sprints = response.data.values || [];

        // Aktif olanları önce göster, sonra ada göre sırala
        const sorted = sprints.sort((a, b) => {
          if (a.state === "active" && b.state !== "active") return -1;
          if (b.state === "active" && a.state !== "active") return 1;
          return a.name.localeCompare(b.name);
        });

        res.json(
          sorted.map((s) => ({
            id: s.id,
            name: s.name,
            state: s.state,
          })),
        );
      } catch (error) {
        console.error("Tüm sprint listesi hatası:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Task oluşturma (Hebiar Jira)
    this.app.post("/api/create-task", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { projectKey, summary, description, sprintId, assigneeId } =
          req.body;

        if (!projectKey || !summary) {
          return res
            .status(400)
            .json({ error: "Proje ve konu başlığı zorunludur" });
        }

        const client = await this.getHebiarClient();
        const agileClient = await this.getHebiarClient("/rest/agile/1.0");

        // Projenin task tipini bul (bazı Hebiar projelerinde "Görev")
        let issuetype = { name: "Task" };
        try {
          const metaResponse = await client.get(
            `/issue/createmeta/${projectKey}/issuetypes`,
          );
          const types = (metaResponse.data.issueTypes || []).filter(
            (t) => !t.subtask,
          );
          const picked =
            types.find((t) => /^(task|görev)$/i.test(t.name)) || types[0];
          if (picked) issuetype = { id: picked.id };
        } catch (e) {
          console.error("Issue type belirlenemedi:", e.message);
        }

        const createResponse = await client.post("/issue", {
          fields: {
            project: { key: projectKey },
            summary,
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: description || "" }],
                },
              ],
            },
            issuetype,
          },
        });
        const issueKey = createResponse.data.key;

        let assigneeName = null;
        let sprintName = null;

        // Assignee ata
        if (assigneeId) {
          try {
            await client.put(`/issue/${issueKey}/assignee`, { accountId: assigneeId });
            const userResponse = await client.get("/user", {
              params: { accountId: assigneeId },
            });
            assigneeName = userResponse.data.displayName || "Atandı";
          } catch (e) {
            console.error("Assignee atanamadı:", e.message);
          }
        }

        // Sprint'e ekle
        if (sprintId) {
          try {
            await agileClient.post(`/sprint/${sprintId}/issue`, {
              issues: [issueKey],
            });

            // Sprint adını al
            const sprintResponse = await agileClient.get(`/sprint/${sprintId}`);
            sprintName = sprintResponse.data.name;
          } catch (e) {
            console.error("Sprint eklenemedi:", e.message);
          }
        }

        console.log(`✅ Task oluşturuldu: ${issueKey} - ${summary}`);

        res.json({
          success: true,
          key: issueKey,
          summary: summary,
          assignee: assigneeName,
          sprint: sprintName,
        });
      } catch (error) {
        const jiraErrors = error.response?.data;
        const detail = jiraErrors
          ? [
              ...(jiraErrors.errorMessages || []),
              ...Object.values(jiraErrors.errors || {}),
            ].join(" | ")
          : "";
        console.error("Task oluşturma hatası:", detail || error.message);
        res.status(500).json({ error: detail || error.message });
      }
    });

    // Sprinte Alınmayan - Olka (E-COMM DEVELOPMENT TEAM) sprint listesi
    this.app.get("/api/unsprinted/olka-sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./unsprinted-report.js")).default;
        const sprints = await service.getOlkaSprints();
        res.json(sprints);
      } catch (error) {
        console.error("Olka sprint listesi hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Sprinte Alınmayan - Hebiar (weekly / Board 54) sprint listesi
    this.app.get("/api/unsprinted/hebiar-sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./unsprinted-report.js")).default;
        const sprints = await service.getHebiarSprints();
        res.json(sprints);
      } catch (error) {
        console.error("Hebiar sprint listesi hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Sprinte Alınmayan - karşılaştırma raporu
    this.app.get("/api/unsprinted/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { olkaSprintId, hebiarSprintId } = req.query;
        if (!olkaSprintId || !hebiarSprintId) {
          return res
            .status(400)
            .json({ error: "Olka ve Hebiar sprint seçimi zorunludur" });
        }

        const service = (await import("./unsprinted-report.js")).default;
        const report = await service.getUnsprintedTasks(
          olkaSprintId,
          hebiarSprintId,
        );
        res.json(report);
      } catch (error) {
        console.error("Sprinte alınmayan rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Sprinte Alınmayan - şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/unsprinted/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const {
          rows,
          olkaSprintName,
          hebiarSprintName,
          olkaTotal,
          hebiarTotal,
        } = req.body || {};
        if (!Array.isArray(rows)) {
          return res
            .status(400)
            .json({ error: "Geçersiz veri: rows listesi gerekli" });
        }

        const service = (await import("./unsprinted-report.js")).default;
        const buffer = await service.buildUnsprintedXlsxBuffer(rows, {
          olkaSprintName,
          hebiarSprintName,
          olkaTotal,
          hebiarTotal,
        });

        const safe = (t) =>
          (t || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `sprinte-alinmayan_${safe(olkaSprintName) || "olka"}_vs_${safe(hebiarSprintName) || "hebiar"}_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Olka Deploy - statüsü "Ready for Ship" olan Olka taskları (CL karşılıklarıyla)
    this.app.get("/api/olka-deploy/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./olka-deploy-report.js")).default;
        const report = await service.getDeployTasks();
        res.json(report);
      } catch (error) {
        console.error("Olka Deploy rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Olka Deploy - şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/olka-deploy/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { rows, status } = req.body || {};
        if (!Array.isArray(rows)) {
          return res
            .status(400)
            .json({ error: "Geçersiz veri: rows listesi gerekli" });
        }

        const service = (await import("./olka-deploy-report.js")).default;
        const buffer = await service.buildOlkaDeployXlsxBuffer(rows, {
          status,
        });

        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `olka-deploy_ready-for-ship_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Olka Deploy Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // RFR Takip - statüsü "Ready For Release" olan Hebiar taskları (kişi bazlı)
    this.app.get("/api/rfr/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./rfr-report.js")).default;
        const report = await service.getRfrTasks();
        res.json(report);
      } catch (error) {
        console.error("RFR Takip rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // RFR Takip - şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/rfr/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { rows, status, overdueDays } = req.body || {};
        if (!Array.isArray(rows)) {
          return res
            .status(400)
            .json({ error: "Geçersiz veri: rows listesi gerekli" });
        }

        const service = (await import("./rfr-report.js")).default;
        const buffer = await service.buildRfrXlsxBuffer(rows, {
          status,
          overdueDays,
        });

        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `rfr-takip_ready-for-release_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("RFR Takip Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Reject Takip - statüsü "Reject"/"REJECT" olan Hebiar maddeleri (HDV hariç,
    // proje bazlı)
    this.app.get("/api/reject/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./reject-report.js")).default;
        const report = await service.getRejectTasks();
        res.json(report);
      } catch (error) {
        console.error("Reject Takip rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // HDV Son Durum - HDV projesinde yalnızca belirli kişilere atanmış tasklar
    this.app.get("/api/hdv-status/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./hdv-status-report.js")).default;
        const report = await service.getHdvStatusTasks();
        res.json(report);
      } catch (error) {
        console.error("HDV Son Durum rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // HDV Son Durum - şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/hdv-status/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { rows } = req.body || {};
        if (!Array.isArray(rows)) {
          return res
            .status(400)
            .json({ error: "Geçersiz veri: rows listesi gerekli" });
        }

        const service = (await import("./hdv-status-report.js")).default;
        const buffer = await service.buildHdvStatusXlsxBuffer(rows);

        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `hdv-son-durum_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("HDV Son Durum Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Reject Takip - şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/reject/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { rows, statuses, projectCount } = req.body || {};
        if (!Array.isArray(rows)) {
          return res
            .status(400)
            .json({ error: "Geçersiz veri: rows listesi gerekli" });
        }

        const service = (await import("./reject-report.js")).default;
        const buffer = await service.buildRejectXlsxBuffer(rows, {
          statuses,
          projectCount,
        });

        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `reject-takip_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Reject Takip Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Olka Sprint Rapor - Hebiar weekly board'un en son kapanan sprintindeki
    // OLK + SKCH maddelerini tamamlanan/kalan/bloke olarak kategorize eder.
    // İsteğe bağlı ?sprintId ile başka bir kapanan sprint seçilebilir.
    this.app.get("/api/olka-sprint/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { sprintId } = req.query;
        const service = (await import("./olka-sprint-report.js")).default;
        const report = await service.getSprintReport(sprintId);
        res.json(report);
      } catch (error) {
        console.error("Olka Sprint Rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Olka Sprint Rapor - şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/olka-sprint/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const data = req.body || {};
        if (!data.stats || !Array.isArray(data.rows)) {
          return res.status(400).json({
            error: "Geçersiz veri: rapor verisi (stats + rows) gerekli",
          });
        }

        const service = (await import("./olka-sprint-report.js")).default;
        const buffer = await service.buildXlsxBuffer(data);

        const stamp = new Date().toISOString().slice(0, 10);
        const sprintName = (
          data.sprint && data.sprint.name ? data.sprint.name : "sprint"
        ).replace(/[^a-z0-9]+/gi, "-");
        const filename = `olka-sprint-rapor_${sprintName}_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Olka Sprint Rapor Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Proje Raporu - weekly board 54 sprintleri (aktif + future + kapanan)
    this.app.get("/api/project-report/sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./project-report.js")).default;
        const sprints = await service.getSprints();
        res.json(sprints);
      } catch (error) {
        console.error("Proje Raporu sprint listesi hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Proje Raporu - seçilen sprintte proje bazlı task kırılımı (sayı + yüzde)
    this.app.get("/api/project-report/breakdown", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { sprintId } = req.query;
        const service = (await import("./project-report.js")).default;
        const report = await service.getBreakdown(sprintId);
        res.json(report);
      } catch (error) {
        console.error("Proje Raporu kırılım hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Proje Raporu - Excel (.xlsx) dışa aktarma
    this.app.post("/api/project-report/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const data = req.body || {};
        if (!Array.isArray(data.projects)) {
          return res.status(400).json({
            error: "Geçersiz veri: proje kırılımı (projects) gerekli",
          });
        }

        const service = (await import("./project-report.js")).default;
        const buffer = await service.buildXlsxBuffer(data);

        const stamp = new Date().toISOString().slice(0, 10);
        const sprintName = (
          data.sprint && data.sprint.name ? data.sprint.name : "sprint"
        ).replace(/[^a-z0-9]+/gi, "-");
        const filename = `proje-raporu_${sprintName}_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Proje Raporu Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Etiket Eşitle - Olka etiketlerini CLLINK ile eşleşen Hebiar tasklarına
    // birebir kopyalar (manuel tetiklenir). body.dryRun=true ise yalnızca önizleme.
    this.app.post("/api/label-sync/run", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const dryRun = req.body?.dryRun === true;
        const service = (await import("./label-sync-report.js")).default;
        const logLines = [];
        const result = await service.syncLabels({
          dryRun,
          onLog: (m) => logLines.push(m),
        });
        res.json({ ...result, logLines });
      } catch (error) {
        console.error("Etiket eşitleme hatası:", error.message);
        const status = /zaten çalışıyor/i.test(error.message) ? 409 : 500;
        res.status(status).json({ error: error.message });
      }
    });

    // MC Panosu - Madame Coco (MC) projesinin maddelerini gerçek Kanban board
    // sütun düzenine göre statü bazında gruplayan pano verisi.
    this.app.get("/api/mc-board/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./mc-board-report.js")).default;
        const report = await service.getBoardData();
        res.json(report);
      } catch (error) {
        console.error("MC Panosu rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Olka Roadmap - OLK projesinin ay-etiketli maddelerini roadmap tamamlanma
    // verisiyle döner. Frontend haftalık/aylık/yıllık/özel dönem filtresini
    // bu ay bilgisine göre client-side uygular.
    this.app.get("/api/olka-roadmap/report", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const service = (await import("./olka-roadmap-report.js")).default;
        const report = await service.getReport();
        res.json(report);
      } catch (error) {
        console.error("Olka Roadmap rapor hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Olka Roadmap - seçilen dönem için şablonlu Excel (.xlsx) dışa aktarma
    this.app.post("/api/olka-roadmap/export", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const data = req.body || {};
        if (!Array.isArray(data.rows)) {
          return res
            .status(400)
            .json({ error: "Geçersiz veri: madde listesi (rows) gerekli" });
        }

        const service = (await import("./olka-roadmap-report.js")).default;
        const buffer = await service.buildXlsxBuffer(data);

        const stamp = new Date().toISOString().slice(0, 10);
        const periodSlug = (data.periodLabel || "roadmap").replace(
          /[^a-z0-9]+/gi,
          "-",
        );
        const filename = `olka-roadmap_${periodSlug}_${stamp}.xlsx`;

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(buffer);
      } catch (error) {
        console.error("Olka Roadmap Excel export hatası:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Sağlık kontrolü
    this.app.get("/api/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });
  }

  start(port) {
    this.port = port || this.port;

    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`\n🚀 Support Dashboard çalışıyor!`);
        console.log(`📊 Panel: http://localhost:${this.port}`);
        console.log(`📡 API: http://localhost:${this.port}/api`);
        console.log(`\nKapatmak için Ctrl+C basın.\n`);
        resolve(this.server);
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

export default new DashboardServer();
