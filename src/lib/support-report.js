import jiraClient from "./jira-client.js";
import axios from "axios";
import { getConfig } from "./config.js";

// Günlük iş yükü ve günlük kapanan raporları her zaman Hebiar Jira'ya göre çalışır
// (config.baseUrl Olka'ya işaret etse bile). Sabit URL, HEBIAR_BASE_URL ile override edilebilir.
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");

class SupportReportService {
  constructor() {
    this.client = jiraClient;
  }

  /**
   * Agile API için axios instance oluştur
   */
  getAgileClient() {
    const { baseUrl, email, apiToken } = getConfig();
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

    return axios.create({
      baseURL: `${baseUrl}/rest/agile/1.0`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  /**
   * Hebiar Jira REST API (v3) için axios instance oluştur.
   * config.baseUrl'den bağımsız olarak her zaman Hebiar'a bağlanır.
   */
  getHebiarClient() {
    const { email, apiToken } = getConfig();
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

    return axios.create({
      baseURL: `${HEBIAR_BASE_URL}/rest/api/3`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  /**
   * Hebiar Agile API (rest/agile/1.0) için axios instance oluştur.
   * Weekly board (54) Hebiar'da olduğundan config.baseUrl (Olka'yı gösterebilir)
   * yerine her zaman Hebiar'a bağlanır.
   */
  getHebiarAgileClient() {
    const { email, apiToken } = getConfig();
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

    return axios.create({
      baseURL: `${HEBIAR_BASE_URL}/rest/agile/1.0`,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }

  /**
   * Hebiar weekly board'undaki (54) AKTİF sprint id'lerini döner.
   * openSprints() tüm panoları kapsadığı için (ör. MC projesinin "MC Sprint 1")
   * weekly-only raporlarda bu id'lerle filtrelemek gerekir. Erişilemezse [] döner.
   *
   * Dikkat: board 54'ün aktif sprint listesi, board filtresine takılan başka
   * panoların sprintlerini de içerebilir (ör. originBoardId=50 olan "MC Sprint 1").
   * Bu yüzden YALNIZCA weekly board'dan (54) doğan sprintler alınır.
   */
  async getActiveWeeklySprintIds() {
    try {
      const client = this.getHebiarAgileClient();
      const res = await client.get(`/board/54/sprint`, {
        params: { state: "active" },
      });
      return (res.data.values || [])
        .filter((s) => s.originBoardId === 54)
        .map((s) => s.id);
    } catch (error) {
      console.error("Weekly sprint bilgisi alınamadı:", error.message);
      return [];
    }
  }

  /**
   * Hebiar Jira üzerinde JQL araması yapar (search/jql endpoint).
   * Bu endpoint sonuçları nextPageToken ile sayfalar (tek sayfa ~100 kayıt) ve
   * gönderilen maxResults'ı yok sayar; bu yüzden maxResults'a ulaşana kadar
   * tüm sayfalar çekilir. Aksi halde 100'den fazla sonuç sessizce kaybolur.
   */
  async searchHebiarJql(jql, fields = [], maxResults = 100) {
    const client = this.getHebiarClient();
    const all = [];
    let nextPageToken;
    let pages = 0;

    do {
      const params = { jql, fields: fields.join(","), maxResults: 100 };
      if (nextPageToken) params.nextPageToken = nextPageToken;

      const response = await client.get("/search/jql", { params });
      all.push(...(response.data.issues || []));
      nextPageToken = response.data.nextPageToken;
      pages++;
    } while (nextPageToken && all.length < maxResults && pages < 50);

    return all.slice(0, maxResults);
  }

  /**
   * Tarih aralığı için JQL filtresi oluşturur
   * @param {string} startDate - Başlangıç tarihi (YYYY-MM-DD)
   * @param {string} endDate - Bitiş tarihi (YYYY-MM-DD)
   * @param {string} dateField - Tarih alanı (created, updated, resolutiondate)
   */
  buildDateFilter(startDate, endDate, dateField = "created") {
    let filter = "";
    if (startDate) {
      filter += ` AND ${dateField} >= "${startDate}"`;
    }
    if (endDate) {
      filter += ` AND ${dateField} <= "${endDate}"`;
    }
    return filter;
  }

  /**
   * Önceden tanımlı tarih aralıklarını hesaplar
   * @param {string} period - today, week, month, custom
   */
  getDateRange(period) {
    const now = new Date();
    let startDate, endDate;

    switch (period) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
        );
        break;
      case "week":
        const dayOfWeek = now.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - diffToMonday,
        );
        endDate = now;
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = now;
        break;
      case "all":
      default:
        return { startDate: null, endDate: null };
    }

    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
  }

  /**
   * Kişi filtresi için JQL oluşturur
   * @param {string} personId - Kişi account ID
   * @param {string} personType - reporter veya assignee
   */
  buildPersonFilter(personId, personType = "all") {
    if (!personId) return "";

    if (personType === "reporter") {
      return ` AND reporter = "${personId}"`;
    } else if (personType === "assignee") {
      return ` AND assignee = "${personId}"`;
    } else {
      // Hem reporter hem assignee
      return ` AND (reporter = "${personId}" OR assignee = "${personId}")`;
    }
  }

  /**
   * Support projesindeki tüm tamamlanmış task'ları çeker
   * @param {string} projectKey - Proje anahtarı
   * @param {object} dateFilter - Tarih filtresi {startDate, endDate}
   * @param {object} personFilter - Kişi filtresi {personId, personType}
   * @param {number} maxResults - Maksimum sonuç sayısı
   */
  async getClosedIssues(
    projectKey,
    dateFilter = {},
    personFilter = {},
    maxResults = 1000,
  ) {
    this.client.init();

    const dateClause = this.buildDateFilter(
      dateFilter.startDate,
      dateFilter.endDate,
      "resolutiondate",
    );
    const personClause = this.buildPersonFilter(
      personFilter.personId,
      personFilter.personType,
    );
    const jql = `project = ${projectKey} AND status in (Done, Closed, Resolved)${dateClause}${personClause} ORDER BY resolutiondate DESC`;
    const fields = [
      "summary",
      "status",
      "assignee",
      "reporter",
      "priority",
      "issuetype",
      "created",
      "updated",
      "resolutiondate",
      "project",
    ];

    return await this.client.searchIssuesJql(jql, fields, maxResults);
  }

  /**
   * Support projesindeki tüm açık task'ları çeker
   * @param {string} projectKey - Proje anahtarı
   * @param {object} dateFilter - Tarih filtresi {startDate, endDate}
   * @param {object} personFilter - Kişi filtresi {personId, personType}
   */
  async getOpenIssues(
    projectKey,
    dateFilter = {},
    personFilter = {},
    maxResults = 500,
  ) {
    this.client.init();

    const dateClause = this.buildDateFilter(
      dateFilter.startDate,
      dateFilter.endDate,
      "created",
    );
    const personClause = this.buildPersonFilter(
      personFilter.personId,
      personFilter.personType,
    );
    const jql = `project = ${projectKey} AND status NOT IN (Done, Closed, Resolved)${dateClause}${personClause} ORDER BY created DESC`;
    const fields = [
      "summary",
      "status",
      "assignee",
      "reporter",
      "priority",
      "issuetype",
      "created",
      "updated",
      "project",
    ];

    return await this.client.searchIssuesJql(jql, fields, maxResults);
  }

  /**
   * Kapanma süresi hesaplar (gün cinsinden)
   */
  calculateResolutionTime(issue) {
    const created = new Date(issue.fields.created);
    const resolved = issue.fields.resolutiondate
      ? new Date(issue.fields.resolutiondate)
      : new Date(issue.fields.updated);

    const diffMs = resolved - created;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    return {
      days: Math.round(diffDays * 100) / 100,
      hours: Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100,
      minutes: Math.round(diffMs / (1000 * 60)),
    };
  }

  /**
   * Ortalama kapanma süresi hesaplar
   */
  calculateAverageResolutionTime(issues) {
    if (issues.length === 0) return { days: 0, hours: 0, minutes: 0 };

    const totalDays = issues.reduce((sum, issue) => {
      return sum + this.calculateResolutionTime(issue).days;
    }, 0);

    const avgDays = totalDays / issues.length;

    return {
      days: Math.round(avgDays * 100) / 100,
      hours: Math.round(avgDays * 24 * 100) / 100,
      minutes: Math.round(avgDays * 24 * 60),
    };
  }

  /**
   * En uzun sürede kapanan task'ları bulur
   */
  getLongestResolutionIssues(issues, limit = 10) {
    const issuesWithTime = issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      reporter: issue.fields.reporter?.displayName || "Bilinmiyor",
      assignee: issue.fields.assignee?.displayName || "Atanmamış",
      created: issue.fields.created,
      resolved: issue.fields.resolutiondate || issue.fields.updated,
      resolutionTime: this.calculateResolutionTime(issue),
      priority: issue.fields.priority?.name || "Yok",
      status: issue.fields.status?.name || "Bilinmiyor",
    }));

    return issuesWithTime
      .sort((a, b) => b.resolutionTime.days - a.resolutionTime.days)
      .slice(0, limit);
  }

  /**
   * En hızlı kapanan task'ları bulur
   */
  getFastestResolutionIssues(issues, limit = 10) {
    const issuesWithTime = issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      reporter: issue.fields.reporter?.displayName || "Bilinmiyor",
      assignee: issue.fields.assignee?.displayName || "Atanmamış",
      created: issue.fields.created,
      resolved: issue.fields.resolutiondate || issue.fields.updated,
      resolutionTime: this.calculateResolutionTime(issue),
      priority: issue.fields.priority?.name || "Yok",
      status: issue.fields.status?.name || "Bilinmiyor",
    }));

    return issuesWithTime
      .filter((issue) => issue.resolutionTime.days > 0)
      .sort((a, b) => a.resolutionTime.days - b.resolutionTime.days)
      .slice(0, limit);
  }

  /**
   * En çok task oluşturan kişileri bulur (reporter bazlı)
   */
  getTopReporters(issues, limit = 10) {
    const reporterCounts = {};

    issues.forEach((issue) => {
      const reporter = issue.fields.reporter?.displayName || "Bilinmiyor";
      const email = issue.fields.reporter?.emailAddress || "";
      const key = reporter;

      if (!reporterCounts[key]) {
        reporterCounts[key] = {
          name: reporter,
          email: email,
          count: 0,
          issues: [],
        };
      }

      reporterCounts[key].count++;
      reporterCounts[key].issues.push({
        key: issue.key,
        summary: issue.fields.summary,
      });
    });

    return Object.values(reporterCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * En çok task çözen kişileri bulur (assignee bazlı)
   */
  getTopResolvers(issues, limit = 10) {
    const assigneeCounts = {};

    issues.forEach((issue) => {
      const assignee = issue.fields.assignee?.displayName || "Atanmamış";
      const email = issue.fields.assignee?.emailAddress || "";

      if (!assigneeCounts[assignee]) {
        assigneeCounts[assignee] = {
          name: assignee,
          email: email,
          count: 0,
          avgResolutionDays: 0,
          totalResolutionDays: 0,
        };
      }

      const resTime = this.calculateResolutionTime(issue);
      assigneeCounts[assignee].count++;
      assigneeCounts[assignee].totalResolutionDays += resTime.days;
    });

    // Ortalama hesapla
    Object.values(assigneeCounts).forEach((resolver) => {
      resolver.avgResolutionDays =
        Math.round((resolver.totalResolutionDays / resolver.count) * 100) / 100;
    });

    return Object.values(assigneeCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Priority bazlı dağılım
   */
  getPriorityDistribution(issues) {
    const distribution = {};

    issues.forEach((issue) => {
      const priority = issue.fields.priority?.name || "Tanımsız";
      distribution[priority] = (distribution[priority] || 0) + 1;
    });

    return Object.entries(distribution)
      .map(([name, count]) => ({
        name,
        count,
        percentage: Math.round((count / issues.length) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Aylık trend analizi
   */
  getMonthlyTrend(issues, months = 12) {
    const trend = {};
    const now = new Date();

    // Son X ay için boş kayıtlar oluştur
    for (let i = months - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      trend[key] = { created: 0, resolved: 0, month: key };
    }

    issues.forEach((issue) => {
      // Çözülen task'lar için
      const resolvedDate = issue.fields.resolutiondate || issue.fields.updated;
      if (resolvedDate) {
        const resolved = new Date(resolvedDate);
        const resolvedKey = `${resolved.getFullYear()}-${String(resolved.getMonth() + 1).padStart(2, "0")}`;
        if (trend[resolvedKey]) {
          trend[resolvedKey].resolved++;
        }
      }
    });

    return Object.values(trend);
  }

  /**
   * Haftalık dağılım (hangi gün en çok task geliyor)
   */
  getWeekdayDistribution(issues) {
    const days = [
      "Pazar",
      "Pazartesi",
      "Salı",
      "Çarşamba",
      "Perşembe",
      "Cuma",
      "Cumartesi",
    ];
    const distribution = days.map((day) => ({ day, count: 0 }));

    issues.forEach((issue) => {
      const created = new Date(issue.fields.created);
      distribution[created.getDay()].count++;
    });

    return distribution;
  }

  /**
   * Projedeki tüm kişileri çeker (reporter ve assignee'ler)
   */
  async getProjectPeople(projectKey) {
    this.client.init();

    // Son 1000 issue'yu çek ve kişileri topla
    const jql = `project = ${projectKey} ORDER BY created DESC`;
    const fields = ["assignee", "reporter"];
    const issues = await this.client.searchIssuesJql(jql, fields, 500);

    const peopleMap = new Map();

    issues.forEach((issue) => {
      // Reporter ekle
      if (issue.fields.reporter) {
        const r = issue.fields.reporter;
        if (!peopleMap.has(r.accountId)) {
          peopleMap.set(r.accountId, {
            accountId: r.accountId,
            displayName: r.displayName,
            email: r.emailAddress || "",
            avatarUrl: r.avatarUrls?.["32x32"] || "",
            asReporter: 0,
            asAssignee: 0,
          });
        }
        peopleMap.get(r.accountId).asReporter++;
      }

      // Assignee ekle
      if (issue.fields.assignee) {
        const a = issue.fields.assignee;
        if (!peopleMap.has(a.accountId)) {
          peopleMap.set(a.accountId, {
            accountId: a.accountId,
            displayName: a.displayName,
            email: a.emailAddress || "",
            avatarUrl: a.avatarUrls?.["32x32"] || "",
            asReporter: 0,
            asAssignee: 0,
          });
        }
        peopleMap.get(a.accountId).asAssignee++;
      }
    });

    // Array'e çevir ve sırala
    return Array.from(peopleMap.values()).sort(
      (a, b) => b.asReporter + b.asAssignee - (a.asReporter + a.asAssignee),
    );
  }

  /**
   * Kişi bazlı detaylı rapor
   */
  getPersonStats(issues, personId) {
    const personIssues = issues.filter(
      (issue) =>
        issue.fields.reporter?.accountId === personId ||
        issue.fields.assignee?.accountId === personId,
    );

    const asReporter = issues.filter(
      (i) => i.fields.reporter?.accountId === personId,
    );
    const asAssignee = issues.filter(
      (i) => i.fields.assignee?.accountId === personId,
    );
    const asAssigneeClosed = asAssignee.filter(
      (i) =>
        ["Done", "Closed", "Resolved"].includes(i.fields.status?.name) ||
        i.fields.status?.statusCategory?.name === "Done",
    );

    return {
      totalInvolved: personIssues.length,
      asReporter: asReporter.length,
      asAssignee: asAssignee.length,
      resolvedByPerson: asAssigneeClosed.length,
      avgResolutionTime: this.calculateAverageResolutionTime(asAssigneeClosed),
      recentIssues: personIssues.slice(0, 10).map((i) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name,
        created: i.fields.created,
        isReporter: i.fields.reporter?.accountId === personId,
        isAssignee: i.fields.assignee?.accountId === personId,
      })),
    };
  }

  /**
   * Tam rapor oluştur
   * @param {string} projectKey - Proje anahtarı
   * @param {string} period - Dönem (today, week, month, all, custom)
   * @param {string} startDate - Özel başlangıç tarihi (YYYY-MM-DD)
   * @param {string} endDate - Özel bitiş tarihi (YYYY-MM-DD)
   * @param {string} personId - Kişi filtresi (accountId)
   * @param {string} personType - Kişi türü (reporter, assignee, all)
   */
  async generateFullReport(
    projectKey,
    period = "all",
    startDate = null,
    endDate = null,
    personId = null,
    personType = "all",
  ) {
    console.log(
      `📊 "${projectKey}" projesi için rapor oluşturuluyor (Dönem: ${period}, Kişi: ${personId || "Tümü"})...`,
    );

    // Tarih aralığını hesapla
    let dateFilter = {};
    if (period === "custom" && startDate && endDate) {
      dateFilter = { startDate, endDate };
    } else if (period !== "all") {
      dateFilter = this.getDateRange(period);
    }

    // Kişi filtresi
    const personFilter = personId ? { personId, personType } : {};

    const closedIssues = await this.getClosedIssues(
      projectKey,
      dateFilter,
      personFilter,
    );
    const openIssues = await this.getOpenIssues(
      projectKey,
      dateFilter,
      personFilter,
    );
    const allIssues = [...closedIssues, ...openIssues];

    console.log(
      `✅ ${closedIssues.length} kapatılmış, ${openIssues.length} açık task bulundu.`,
    );

    const report = {
      generatedAt: new Date().toISOString(),
      projectKey,
      period,
      dateFilter: dateFilter.startDate ? dateFilter : null,
      personFilter: personId ? { personId, personType } : null,
      summary: {
        totalIssues: allIssues.length,
        closedIssues: closedIssues.length,
        openIssues: openIssues.length,
        closedPercentage:
          Math.round((closedIssues.length / allIssues.length) * 100) || 0,
      },
      averageResolutionTime: this.calculateAverageResolutionTime(closedIssues),
      longestResolution: this.getLongestResolutionIssues(closedIssues, 10),
      fastestResolution: this.getFastestResolutionIssues(closedIssues, 10),
      topReporters: this.getTopReporters(allIssues, 15),
      topResolvers: this.getTopResolvers(closedIssues, 10),
      priorityDistribution: this.getPriorityDistribution(allIssues),
      monthlyTrend: this.getMonthlyTrend(closedIssues, 12),
      weekdayDistribution: this.getWeekdayDistribution(allIssues),
    };

    // Kişi seçiliyse kişi detaylarını ekle
    if (personId) {
      report.personStats = this.getPersonStats(allIssues, personId);
    }

    return report;
  }

  /**
   * Günlük iş yükü raporu - Kişi bazlı Sprint/Support ayrımı
   * Sprint = Aktif sprintte bulunan ve tamamlanmamış tasklar
   * Support = Customer Support "Evet" olan açık tasklar
   */
  async getDailyWorkloadReport() {
    this.client.init();

    console.log(`📊 Günlük iş yükü raporu oluşturuluyor...`);

    // 1. Aktif WEEKLY sprintteki (Hebiar board 54) tamamlanmamış taskları çek.
    // Not: openSprints() TÜM panolardaki açık sprintleri kapsar (ör. MC projesinin
    // "MC Sprint 1" sprinti). Bu rapor YALNIZCA weekly board'un aktif sprint(ler)ini
    // içermelidir; bu yüzden aktif weekly sprint id'lerine göre filtreliyoruz.
    const weeklySprintIds = await this.getActiveWeeklySprintIds();
    const sprintJql = weeklySprintIds.length
      ? `sprint in (${weeklySprintIds.join(", ")}) AND statusCategory != Done ORDER BY "cf[10020]" DESC`
      : `sprint in openSprints() AND sprint NOT IN futureSprints() AND statusCategory != Done ORDER BY "cf[10020]" DESC`;
    const sprintFields = ["summary", "status", "assignee", "project"];

    const sprintIssues = await this.searchHebiarJql(
      sprintJql,
      sprintFields,
      500,
    );
    console.log(`✅ Aktif sprintte ${sprintIssues.length} açık task bulundu.`);

    // 2. Customer Support = Evet olan açık support taskları çek.
    // Statü allow-list'i ve "created >= -100d" penceresi kullanıcının verdiği JQL
    // ile birebir aynıdır. Bu JQL "On Hold" ve "test" statülerini bilerek dahil
    // ettiği için aşağıdaki hariç tutulan statü filtresi support'a UYGULANMAZ.
    const supportJql = `created >= -100d AND status in (Backlog, "Customer Action Required", Escalated, "In Progress", "On Hold", Open, Pending, Reopened, "Request For Development", "Selected For Development", test, Returned, "To Do", Uat, "Waiting for customer", "Waiting for support", "Work in progress") AND "Customer Support[Dropdown]" = Evet ORDER BY assignee ASC, created DESC`;
    const supportFields = [
      "summary",
      "status",
      "assignee",
      "customfield_10079",
      "project",
    ];

    const supportIssues = await this.searchHebiarJql(
      supportJql,
      supportFields,
      2000,
    );
    console.log(
      `✅ Support alanında ${supportIssues.length} açık task bulundu.`,
    );

    // Rapordan hariç tutulacak statüler - bu statülerdeki tasklar sayılmaz.
    // Anahtar: karşılaştırma için küçük harf, değer: kutucukta gösterilecek etiket.
    const excludedStatusLabels = {
      "customer action": "Customer Action",
      "ready for release": "Ready For Release",
      merge: "Merge",
      merged: "Merged",
      "on hold": "On Hold",
      block: "Block",
      "qa testing": "QA Testing",
      test: "Test",
      // "Deleted" statüsü Done kategorisinde olmadığı için JQL'e takılmıyor; iş yükü değil.
      deleted: "Deleted",
    };
    const excludedStatuses = Object.keys(excludedStatusLabels);
    const normalizeStatus = (issue) =>
      (issue.fields.status?.name || "").toLowerCase().trim();
    const isExcludedStatus = (issue) =>
      excludedStatuses.includes(normalizeStatus(issue));

    const filteredSprintIssues = sprintIssues.filter(
      (i) => !isExcludedStatus(i),
    );
    // Support tarafı JQL'deki statü allow-list'i ile zaten sınırlıdır (On Hold ve
    // test dahil), bu yüzden hariç tutulan statü filtresi support'a uygulanmaz;
    // kişi bazlı support sayısı verilen JQL sonucuyla birebir eşleşir.
    const filteredSupportIssues = supportIssues;
    console.log(
      `🚫 Hariç tutulan statüler nedeniyle ${
        sprintIssues.length - filteredSprintIssues.length
      } sprint task sayılmadı.`,
    );

    // Hariç tutulan statülerin kutucuklarda gösterilecek sayıları (tekilleştirilmiş).
    // Sadece sprint tarafı için hesaplanır; support tarafı allow-list ile sınırlıdır.
    const excludedStatusCountMap = new Map(excludedStatuses.map((s) => [s, 0]));
    const seenExcludedKeys = new Set();
    sprintIssues.forEach((issue) => {
      const status = normalizeStatus(issue);
      if (!excludedStatusCountMap.has(status)) return;
      if (seenExcludedKeys.has(issue.key)) return;
      seenExcludedKeys.add(issue.key);
      excludedStatusCountMap.set(
        status,
        excludedStatusCountMap.get(status) + 1,
      );
    });
    const excludedStatusBreakdown = excludedStatuses.map((s) => ({
      status: excludedStatusLabels[s],
      count: excludedStatusCountMap.get(s),
    }));

    // Kişi bazlı grupla
    const personMap = new Map();

    // Sprint taskları ekle
    filteredSprintIssues.forEach((issue) => {
      const assignee = issue.fields.assignee;
      const personName = assignee?.displayName || "Atanmamış";
      const personId = assignee?.accountId || "unassigned";

      if (!personMap.has(personId)) {
        personMap.set(personId, {
          personId,
          personName,
          sprint: 0,
          support: 0,
          total: 0,
        });
      }

      personMap.get(personId).sprint++;
    });

    // Support taskları ekle
    filteredSupportIssues.forEach((issue) => {
      const assignee = issue.fields.assignee;
      const personName = assignee?.displayName || "Atanmamış";
      const personId = assignee?.accountId || "unassigned";

      if (!personMap.has(personId)) {
        personMap.set(personId, {
          personId,
          personName,
          sprint: 0,
          support: 0,
          total: 0,
        });
      }

      personMap.get(personId).support++;
    });

    // Hariç tutulacak kişiler (kişi bazlı gizleme).
    const excludedNames = [
      "Hakan Gürses",
      "Hakan Gurses",
      "Arif Kula",
      "Bilal Çetin",
      "Oğuzhan Portakal",
      "Mizgin Aydeniz",
      "Ömer Faruk Sandıkçı",
      "Furkan Gencer",
      "Burak Karagöz",
      "Ömer Kurtbey",
      "Faruk Nafiz Öksüz",
      "Gökhan Koçak",
      "Gökhan KOÇAK",
      "Serkan Doksöz",
      "Tahir Polat Özdemir",
      "id",
      "Atanmamış",
    ];

    // Küçük harfe çevrilmiş hariç listesi
    const excludedNamesLower = excludedNames.map((n) => n.toLowerCase());
    const isExcludedPerson = (personName) =>
      excludedNamesLower.some(
        (name) =>
          personName.toLowerCase().includes(name) ||
          name.includes(personName.toLowerCase()),
      );

    // Toplamları hesapla. Kişi gizleme filtresi SADECE sprint tarafına uygulanır:
    // gizlenen kişilerin sprint sayısı 0'lanır, ancak support sayısı korunur ki
    // support toplamı verilen JQL sonucuyla (tüm kişiler dahil) birebir eşleşsin.
    personMap.forEach((person) => {
      if (isExcludedPerson(person.personName)) {
        person.sprint = 0;
      }
      person.total = person.sprint + person.support;
    });

    // Array'e çevir ve sırala (toplam'a göre). total > 0 olan herkes gösterilir;
    // böylece gizlenen kişiler yalnızca support tasklarıyla tabloda görünebilir.
    const rows = Array.from(personMap.values())
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);

    // Alt toplam hesapla
    const totals = rows.reduce(
      (acc, row) => {
        acc.sprint += row.sprint;
        acc.support += row.support;
        acc.total += row.total;
        return acc;
      },
      { sprint: 0, support: 0, total: 0 },
    );

    return {
      generatedAt: new Date().toISOString(),
      rows,
      totals,
      sprintTaskCount: filteredSprintIssues.length,
      supportTaskCount: filteredSupportIssues.length,
      excludedStatusBreakdown,
    };
  }

  /**
   * Günlük kapanan task raporu - Kişi bazlı Sprint/Support ayrımı
   * Sprint = Customer Support "Hayır" veya Boş
   * Support = Customer Support "Evet"
   * @param {string} date - Tarih (YYYY-MM-DD), boşsa bugün
   */
  async getDailyClosedReport(date = null) {
    this.client.init();

    // Tarih belirle
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Bir sonraki günü hesapla
    const targetDateObj = new Date(targetDate);
    const nextDay = new Date(targetDateObj);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];

    console.log(`📊 Günlük kapanan task raporu (${targetDate})...`);

    // Ortak status listesi
    const statusList =
      'Closed, Tamam, Done, Merged, MERGED, Onlive, OnLive, ONLIVE, "Ready For Release", "ready for release", "READY FOR RELEASE", Resolved, "QA TESTING"';

    // Tamamlanma kriteri: listedeki statüler VEYA "Tamamlandı" (Done) kategorisindeki
    // herhangi bir statü. Böylece HDV gibi projelerin özel done statüleri
    // (ör. "CUSTOMER TEST", "TAMAM") da tamamlanan işlere dahil olur.
    const doneClause = `(status in (${statusList}) OR statusCategory = Done)`;

    // Kapanış günü çıpası: normalde "due" (bitiş) tarihi kullanılır. Ancak bazı
    // maddeler (ör. HDV) due tarihi girilmeden kapatılıyor; bu durumda maddenin
    // gerçekten kapandığı gün olan resolutiondate'e göre eşleştiririz. Böylece
    // due tarihi olan maddelerin davranışı değişmez, yalnızca due'su boş bırakılıp
    // o gün kapatılan maddeler de rapora dahil olur.
    const dayClause = `((due >= "${targetDate}" AND due < "${nextDayStr}") OR (due is EMPTY AND resolutiondate >= "${targetDate}" AND resolutiondate < "${nextDayStr}"))`;

    // Sprint kolonu için JQL: Sprint is not EMPTY
    const sprintJql = `${dayClause} AND ${doneClause} AND Sprint is not EMPTY ORDER BY assignee ASC`;

    // Support kolonu için JQL: Sprint is empty AND assignee is not EMPTY
    const supportJql = `${dayClause} AND ${doneClause} AND Sprint is empty AND assignee is not EMPTY ORDER BY assignee ASC`;

    const fields = [
      "summary",
      "status",
      "assignee",
      "reporter",
      "due",
      "customfield_10079",
      "project",
    ];

    // İki sorguyu paralel çalıştır (Hebiar Jira)
    const [sprintIssues, supportIssues] = await Promise.all([
      this.searchHebiarJql(sprintJql, fields, 500),
      this.searchHebiarJql(supportJql, fields, 500),
    ]);

    console.log(
      `✅ Sprint: ${sprintIssues.length}, Support: ${supportIssues.length} kapanan task bulundu.`,
    );

    // Hariç tutulacak kişiler
    const excludedNames = [
      "Hakan Gürses",
      "Hakan Gurses",
      "Arif Kula",
      "Bilal Çetin",
      "Oğuzhan Portakal",
      "Mizgin Aydeniz",
      "Ömer Faruk Sandıkçı",
      "Furkan Gencer",
      "Burak Karagöz",
      "Ömer Kurtbey",
      "Faruk Nafiz Öksüz",
      "Gökhan Koçak",
      "Gökhan KOÇAK",
      "Cihat Bulut",
      "Cihat BULUT",
      "Atanmamış",
    ];

    // Kişi bazlı grupla
    const personMap = new Map();

    // Sprint task'larını ekle
    sprintIssues.forEach((issue) => {
      const assignee = issue.fields.assignee;
      const personName = assignee?.displayName || "Atanmamış";
      const personId = assignee?.accountId || "unassigned";

      // Hariç tutulan kişileri atla
      if (excludedNames.includes(personName)) return;

      if (!personMap.has(personId)) {
        personMap.set(personId, {
          personId,
          personName,
          sprint: 0,
          support: 0,
          total: 0,
        });
      }

      const person = personMap.get(personId);
      person.sprint++;
      person.total++;
    });

    // Support task'larını ekle
    supportIssues.forEach((issue) => {
      const assignee = issue.fields.assignee;
      const personName = assignee?.displayName || "Atanmamış";
      const personId = assignee?.accountId || "unassigned";

      // Hariç tutulan kişileri atla
      if (excludedNames.includes(personName)) return;

      if (!personMap.has(personId)) {
        personMap.set(personId, {
          personId,
          personName,
          sprint: 0,
          support: 0,
          total: 0,
        });
      }

      const person = personMap.get(personId);
      person.support++;
      person.total++;
    });

    // Array'e çevir ve sırala
    const rows = Array.from(personMap.values())
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);

    // Alt toplam hesapla
    const totals = rows.reduce(
      (acc, row) => {
        acc.sprint += row.sprint;
        acc.support += row.support;
        acc.total += row.total;
        return acc;
      },
      { sprint: 0, support: 0, total: 0 },
    );

    return {
      generatedAt: new Date().toISOString(),
      date: targetDate,
      rows,
      totals,
      totalIssues: sprintIssues.length + supportIssues.length,
    };
  }

  /**
   * CL-SC projesinin aktif sprint raporunu çeker
   * @param {string} projectKey - Proje anahtarı (varsayılan: CL-SC)
   */
  async getProjectSprintReport(projectKey = "ALL") {
    this.client.init();

    console.log(
      `🏃 Board 54 aktif sprint raporu oluşturuluyor (Tüm projeler)...`,
    );

    // Board 54 (weekly sprint) aktif sprint bilgisini çek
    const sprintInfo = await this.getActiveSprintInfo();

    // Sprint ID varsa o sprint'e göre, yoksa genel sorgu
    let jql;
    if (sprintInfo.id) {
      // Board 54'teki aktif sprint - TÜM projelerin taskları
      jql = `sprint = ${sprintInfo.id} AND statusCategory != Done ORDER BY project ASC, assignee ASC`;
    } else {
      // Fallback: Açık sprintlerde olan tüm tasklar
      jql = `sprint in openSprints() AND sprint NOT IN futureSprints() AND statusCategory != Done ORDER BY project ASC, assignee ASC`;
    }

    const fields = ["summary", "status", "assignee", "project", "sprint"];

    const issues = await this.client.searchIssuesJql(jql, fields, 500);
    console.log(`✅ ${issues.length} açık task bulundu.`);

    // Bilinen kişilerin email adresleri (Jira privacy nedeniyle göstermiyor)
    const knownEmails = {
      "Tahir Polat Özdemir": "polat.ozdemir@commercelab.com.tr",
      "Serkan doksöz": "serkan.doksoz@commercelab.com.tr",
      "Yasin Teker": "yasin.teker@commercelab.com.tr",
      "Sertaç YALÇINKAYA": "sertac.yalcinkaya@commercelab.com.tr",
      "Alper Özçelik": "alper.ozcelik@commercelab.com.tr",
      "Burak Karagöz": "burak.karagoz@commercelab.com.tr",
      "Faruk Nafiz Öksüz": "faruk.oksuz@commercelab.com.tr",
      "Gökhan Koçak": "gokhan.kocak@commercelab.com.tr",
      "Ömer Kurtbey": "omer.kurtbey@commercelab.com.tr",
      "Furkan Gencer": "furkan.gencer@commercelab.com.tr",
      "Ömer Faruk Sandıkçı": "omer.sandikci@commercelab.com.tr",
      "Bilal Çetin": "bilal.cetin@commercelab.com.tr",
      "Arif Kula": "arif.kula@commercelab.com.tr",
      "Mizgin Aydeniz": "mizgin.aydeniz@commercelab.com.tr",
      "Oğuzhan Portakal": "oguzhan.portakal@commercelab.com.tr",
      "Hakan Gürses": "hakan.gurses@commercelab.com.tr",
    };

    // Kişi bazlı grupla
    const personMap = new Map();

    issues.forEach((issue) => {
      const assignee = issue.fields.assignee;
      const personName = assignee?.displayName || "Atanmamış";
      const personId = assignee?.accountId || "unassigned";
      // Önce Jira'dan gelen email'i kontrol et, yoksa bilinen emaillerden al
      const email = assignee?.emailAddress || knownEmails[personName] || null;

      if (!personMap.has(personId)) {
        personMap.set(personId, {
          personId,
          personName,
          email,
          taskCount: 0,
          tasks: [],
        });
      }

      const person = personMap.get(personId);
      person.taskCount++;
      person.tasks.push({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || "Unknown",
        project: issue.fields.project?.key || "",
      });
    });

    // Array'e çevir ve sırala
    const rows = Array.from(personMap.values())
      .filter((p) => p.taskCount > 0 && p.personName !== "Atanmamış")
      .sort((a, b) => b.taskCount - a.taskCount);

    // Proje bazlı grupla
    const projectMap = new Map();
    issues.forEach((issue) => {
      const projectKey = issue.fields.project?.key || "Unknown";
      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, 0);
      }
      projectMap.set(projectKey, projectMap.get(projectKey) + 1);
    });

    return {
      generatedAt: new Date().toISOString(),
      projectKey: "ALL",
      boardId: 54,
      sprint: sprintInfo,
      rows,
      totalTasks: issues.length,
      projectBreakdown: Object.fromEntries(projectMap),
    };
  }

  /**
   * Board 54 (weekly sprint) aktif sprint bilgisini çeker
   */
  async getActiveSprintInfo() {
    try {
      const agileClient = this.getAgileClient();

      // Board 54 sabit kullan (weekly sprint board - tüm projeler)
      const boardId = 54;

      // Aktif sprinti bul
      const sprintResponse = await agileClient.get(`/board/${boardId}/sprint`, {
        params: { state: "active" },
      });

      const sprints = sprintResponse.data.values || [];
      if (sprints.length === 0) {
        return { name: "Aktif Sprint Yok", endDate: null };
      }

      const activeSprint = sprints[0];
      return {
        id: activeSprint.id,
        name: activeSprint.name,
        startDate: activeSprint.startDate,
        endDate: activeSprint.endDate,
        goal: activeSprint.goal || "",
      };
    } catch (error) {
      console.error("Sprint bilgisi alınamadı:", error.message);
      return { name: "Bilinmiyor", endDate: null };
    }
  }

  /**
   * Sprint bitimine 2 gün kala uyarı maillerini hazırlar
   */
  async prepareSprintAlerts(projectKey = "ALL") {
    const report = await this.getProjectSprintReport();

    if (!report.sprint || !report.sprint.endDate) {
      throw new Error("Sprint bitiş tarihi bulunamadı");
    }

    const endDate = new Date(report.sprint.endDate);
    const today = new Date();
    const daysUntilEnd = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    const alerts = report.rows.map((person) => ({
      personName: person.personName,
      email: person.email,
      taskCount: person.taskCount,
      tasks: person.tasks,
      sprintName: report.sprint.name,
      sprintEndDate: endDate.toLocaleDateString("tr-TR"),
      daysUntilEnd,
    }));

    return {
      sprintName: report.sprint.name,
      sprintEndDate: endDate.toISOString(),
      daysUntilEnd,
      alerts,
      shouldSendAlert: daysUntilEnd <= 2,
    };
  }
}

export default new SupportReportService();
