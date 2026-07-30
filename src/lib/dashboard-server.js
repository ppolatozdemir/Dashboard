import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import supportReportService from "./support-report.js";
import { isConfigured, getConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DashboardServer {
  constructor() {
    this.app = express();
    this.port = 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.static(path.join(__dirname, "../public")));
  }

  setupRoutes() {
    // Ana sayfa
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(__dirname, "../public/dashboard.html"));
    });

    // Yapılandırma kontrolü
    this.app.get("/api/config/status", (req, res) => {
      res.json({
        configured: isConfigured(),
        defaultProject: getConfig().defaultProject || null,
      });
    });

    // Projeler listesi
    this.app.get("/api/projects", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const jiraClient = (await import("./jira-client.js")).default;
        jiraClient.init();
        const projects = await jiraClient.getProjects();

        res.json(
          projects.map((p) => ({
            key: p.key,
            name: p.name,
            id: p.id,
          })),
        );
      } catch (error) {
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

    // Kullanıcı listesi
    this.app.get("/api/users", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const jiraClient = (await import("./jira-client.js")).default;
        jiraClient.init();

        // Tüm kullanıcıları çekmek için genel arama
        const users = await jiraClient.searchUsers("");

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

    // Sprint listesi (Board 54)
    this.app.get("/api/sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { baseUrl, email, apiToken } = getConfig();
        const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
        const axios = (await import("axios")).default;

        // Board 54'ten tüm aktif ve future sprintleri çek
        const response = await axios.get(
          `${baseUrl}/rest/agile/1.0/board/54/sprint`,
          {
            params: { state: "active,future" },
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/json",
            },
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

    // Tüm sprintler (Autocomplete için)
    this.app.get("/api/all-sprints", async (req, res) => {
      try {
        if (!isConfigured()) {
          return res.status(400).json({ error: "Jira yapılandırması eksik" });
        }

        const { baseUrl, email, apiToken } = getConfig();
        const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
        const axios = (await import("axios")).default;

        // Board 54'ten tüm aktif ve future sprintleri çek
        const response = await axios.get(
          `${baseUrl}/rest/agile/1.0/board/54/sprint`,
          {
            params: { state: "active,future", maxResults: 100 },
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/json",
            },
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

    // Task oluşturma
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

        const jiraClient = (await import("./jira-client.js")).default;
        jiraClient.init();

        // Task oluştur
        const issue = await jiraClient.createIssue(
          projectKey,
          summary,
          description || "",
          "Task",
        );
        const issueKey = issue.key;

        let assigneeName = null;
        let sprintName = null;

        // Assignee ata
        if (assigneeId) {
          try {
            await jiraClient.assignIssue(issueKey, assigneeId);
            const users = await jiraClient.searchUsers("");
            const user = users.find((u) => u.accountId === assigneeId);
            assigneeName = user ? user.displayName : "Atandı";
          } catch (e) {
            console.error("Assignee atanamadı:", e.message);
          }
        }

        // Sprint'e ekle
        if (sprintId) {
          try {
            const { baseUrl, email, apiToken } = getConfig();
            const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
            const axios = (await import("axios")).default;

            await axios.post(
              `${baseUrl}/rest/agile/1.0/sprint/${sprintId}/issue`,
              {
                issues: [issueKey],
              },
              {
                headers: {
                  Authorization: `Basic ${auth}`,
                  "Content-Type": "application/json",
                },
              },
            );

            // Sprint adını al
            const sprintResponse = await axios.get(
              `${baseUrl}/rest/agile/1.0/sprint/${sprintId}`,
              {
                headers: {
                  Authorization: `Basic ${auth}`,
                  "Content-Type": "application/json",
                },
              },
            );
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
        console.error("Task oluşturma hatası:", error);
        res.status(500).json({ error: error.message });
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
