import supportReportService from "../../lib/support-report.js";
import { getConfig, isConfigured } from "../../lib/config.js";
import {
  getHebiarClient,
  HEBIAR_WEEKLY_BOARD_ID,
} from "../../shared/hebiar-client.js";
import { requireConfiguration } from "./controller-utils.js";

export function configStatus(req, res) {
  res.json({
    configured: isConfigured(),
    defaultProject: getConfig().defaultProject || null,
  });
}

export async function projects(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const client = getHebiarClient();
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
      projects.map((project) => ({
        key: project.key,
        name: project.name,
        id: project.id,
      })),
    );
  } catch (error) {
    console.error("Proje listesi hatası:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
}

export async function people(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    res.json(await supportReportService.getProjectPeople(req.params.projectKey));
  } catch (error) {
    console.error("Kişi listesi hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function dailyReport(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    res.json(await supportReportService.getDailyWorkloadReport());
  } catch (error) {
    console.error("Günlük rapor hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function dailyClosed(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    res.json(
      await supportReportService.getDailyClosedReport(req.query.date || null),
    );
  } catch (error) {
    console.error("Günlük kapanan rapor hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function sprintReport(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    res.json(
      await supportReportService.getProjectSprintReport(req.params.projectKey),
    );
  } catch (error) {
    console.error("Sprint rapor hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

function alertText(alert, includeEscalation = false) {
  const taskList = alert.tasks
    .map((task) => `• ${task.key}: ${task.summary}`)
    .join("\n");
  const escalation = includeEscalation
    ? "\nEğer yetiştiremeyeceğinizi düşünüyorsanız, lütfen proje yöneticinize başvurunuz."
    : "";
  return `Merhaba ${alert.personName},

${alert.sprintName} sprint'i ${alert.sprintEndDate} tarihinde sona erecek.
Sprint'e ${alert.daysUntilEnd} gün kaldı.

Üzerinizde ${alert.taskCount} adet açık task bulunmaktadır:

${taskList}

Bu taskları sprint bitimine kadar tamamlamanız gerekmektedir.${escalation}

Saygılarımızla,
Proje Yönetimi`;
}

function manualAlerts(alertData) {
  return alertData.alerts.map((alert) => ({
    personName: alert.personName,
    email: alert.email || "Email bulunamadı",
    taskCount: alert.taskCount,
    subject: `⚠️ Sprint Uyarısı: ${alert.taskCount} açık task - ${alert.sprintName}`,
    body: alertText(alert),
  }));
}

async function sendAlertEmails(transporter, alertData, smtpUser) {
  const result = { sentCount: 0, errors: [], sent: [] };
  for (const alert of alertData.alerts) {
    if (!alert.email) {
      result.errors.push(`${alert.personName}: Email adresi bulunamadı`);
      continue;
    }
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || smtpUser,
        to: alert.email,
        subject: `⚠️ Sprint Uyarısı: ${alert.taskCount} açık task - ${alert.sprintName}`,
        text: alertText(alert, true),
      });
      result.sentCount++;
      result.sent.push({ name: alert.personName, email: alert.email });
      console.log(`✅ Mail gönderildi: ${alert.personName} (${alert.email})`);
    } catch (error) {
      result.errors.push(`${alert.personName}: ${error.message}`);
      console.error(`❌ Mail gönderilemedi: ${alert.personName}`, error.message);
    }
  }
  return result;
}

function missingSmtpResponse(res, alertData) {
  return res.json({
    success: false,
    message:
      "SMTP yapılandırması eksik. Mail gönderilemedi ancak alert içerikleri hazırlandı.",
    smtpConfigured: false,
    sentCount: 0,
    totalAlerts: alertData.alerts.length,
    sprintName: alertData.sprintName,
    daysUntilEnd: alertData.daysUntilEnd,
    alerts: manualAlerts(alertData),
  });
}

export async function sprintAlerts(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const alertData = await supportReportService.prepareSprintAlerts(
      req.params.projectKey,
    );
    const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = process.env;
    if (!host || !user || !pass) return missingSmtpResponse(res, alertData);
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user, pass },
    });
    const result = await sendAlertEmails(transporter, alertData, user);
    res.json({
      success: true,
      message: "Sprint uyarı mailleri gönderildi",
      smtpConfigured: true,
      sentCount: result.sentCount,
      totalAlerts: alertData.alerts.length,
      sprintName: alertData.sprintName,
      daysUntilEnd: alertData.daysUntilEnd,
      sent: result.sent,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error("Sprint alert hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function fullReport(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const {
      period = "all",
      startDate,
      endDate,
      personId,
      personType = "all",
    } = req.query;
    const report = await supportReportService.generateFullReport(
      req.params.projectKey,
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
}

export async function stats(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const report = await supportReportService.generateFullReport(
      req.params.projectKey,
    );
    res.json({
      summary: report.summary,
      averageResolutionTime: report.averageResolutionTime,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function longest(req, res) {
  try {
    const issues = await supportReportService.getClosedIssues(
      req.params.projectKey,
    );
    res.json(
      supportReportService.getLongestResolutionIssues(
        issues,
        parseInt(req.query.limit) || 10,
      ),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function fastest(req, res) {
  try {
    const issues = await supportReportService.getClosedIssues(
      req.params.projectKey,
    );
    res.json(
      supportReportService.getFastestResolutionIssues(
        issues,
        parseInt(req.query.limit) || 10,
      ),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function reporters(req, res) {
  try {
    const closed = await supportReportService.getClosedIssues(
      req.params.projectKey,
    );
    const open = await supportReportService.getOpenIssues(req.params.projectKey);
    res.json(
      supportReportService.getTopReporters(
        [...closed, ...open],
        parseInt(req.query.limit) || 15,
      ),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function resolvers(req, res) {
  try {
    const closed = await supportReportService.getClosedIssues(
      req.params.projectKey,
    );
    res.json(
      supportReportService.getTopResolvers(
        closed,
        parseInt(req.query.limit) || 10,
      ),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function jiraUsers(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const response = await getHebiarClient().get("/user/search", {
      params: { query: "", maxResults: 1000 },
    });
    res.json(
      (response.data || []).map((user) => ({
        accountId: user.accountId,
        displayName: user.displayName,
        emailAddress: user.emailAddress,
      })),
    );
  } catch (error) {
    console.error("Kullanıcı listesi hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

async function getSprints(maxResults) {
  const client = getHebiarClient("/rest/agile/1.0");
  const response = await client.get(
    `/board/${HEBIAR_WEEKLY_BOARD_ID}/sprint`,
    { params: { state: "active,future", ...(maxResults ? { maxResults } : {}) } },
  );
  return response.data.values || [];
}

export async function sprints(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const values = await getSprints();
    res.json(
      values.map(({ id, name, state }) => ({ id, name, state })),
    );
  } catch (error) {
    console.error("Sprint listesi hatası:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function allSprints(req, res) {
  try {
    if (!requireConfiguration(res)) return;
    const values = await getSprints(100);
    values.sort((a, b) => {
      if (a.state === "active" && b.state !== "active") return -1;
      if (b.state === "active" && a.state !== "active") return 1;
      return a.name.localeCompare(b.name);
    });
    res.json(values.map(({ id, name, state }) => ({ id, name, state })));
  } catch (error) {
    console.error("Tüm sprint listesi hatası:", error);
    res.status(500).json({ error: error.message });
  }
}
