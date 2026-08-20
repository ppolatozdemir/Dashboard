import axios from "axios";
import { getConfig } from "./config.js";

/**
 * Olka -> Hebiar ETİKET (label) EŞİTLEME servisi.
 *
 * Olka (E-COMM DEVELOPMENT TEAM) projesindeki her taskın etiketlerini,
 * CLLINK alanı ile eşleşen Hebiar (CL) taskına BİREBİR kopyalar.
 * "Hebiar = Olka birebir kopya": Hebiar tarafındaki fazla etiketler SİLİNİR,
 * eksik etiketler EKLENİR. Olka tarafına HİÇBİR yazma yapılmaz.
 *
 * Her iki Jira'ya da aynı email + API token ile bağlanılır.
 */

const OLKA_BASE_URL = (
  process.env.OLKA_BASE_URL || "https://olkaproduct.atlassian.net"
).replace(/\/$/, "");
const HEBIAR_BASE_URL = (
  process.env.HEBIAR_BASE_URL || "https://hebiar.atlassian.net"
).replace(/\/$/, "");
const OLKA_PROJECT_QUERY =
  process.env.OLKA_PROJECT_QUERY || "E-COMM DEVELOPMENT TEAM";
const OLKA_PROJECT_KEY = process.env.OLKA_PROJECT_KEY || "EWT";
const CLLINK_FIELD_NAME = "CLLINK";
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY || 5);
const REQ_TIMEOUT = Number(process.env.SYNC_TIMEOUT_MS || 30000);

class LabelSyncService {
  constructor() {
    this._cllinkFieldId = null;
    this._running = false;
  }

  getAuthHeader() {
    const { email, apiToken } = getConfig();
    if (!email || !apiToken) {
      throw new Error(
        'Jira kimlik bilgileri eksik. Önce "jira config" komutunu çalıştırın.',
      );
    }
    const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /** Olka'daki CLLINK custom field id'sini bulur (customfield_XXXXX). */
  async getCllinkFieldId() {
    if (this._cllinkFieldId) return this._cllinkFieldId;
    const res = await axios.get(`${OLKA_BASE_URL}/rest/api/3/field`, {
      headers: this.getAuthHeader(),
      timeout: REQ_TIMEOUT,
    });
    const fields = res.data || [];
    const field =
      fields.find(
        (f) =>
          (f.name || "").trim().toLowerCase() ===
          CLLINK_FIELD_NAME.toLowerCase(),
      ) || fields.find((f) => (f.name || "").toLowerCase().includes("cllink"));
    this._cllinkFieldId = field ? field.id : null;
    return this._cllinkFieldId;
  }

  /** CLLINK değerinden Hebiar (CL) task anahtarını çıkarır. */
  extractClKey(value) {
    if (!value) return null;
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const match = str.match(/([A-Z][A-Z0-9]+-\d+)/);
    return match ? match[1] : null;
  }

  /** Enhanced JQL endpoint'i ile bir sorgunun TÜM sonuçlarını (sayfalı) çeker. */
  async searchAllJql(baseUrl, jql, fields) {
    const headers = this.getAuthHeader();
    let nextPageToken = null;
    const all = [];
    do {
      const params = { jql, fields: fields.join(","), maxResults: 100 };
      if (nextPageToken) params.nextPageToken = nextPageToken;
      const res = await axios.get(`${baseUrl}/rest/api/3/search/jql`, {
        params,
        headers,
        timeout: REQ_TIMEOUT,
      });
      const issues = res.data.issues || [];
      all.push(...issues);
      nextPageToken = res.data.isLast ? null : res.data.nextPageToken || null;
    } while (nextPageToken);
    return all;
  }

  /** Verilen Hebiar anahtarlarının mevcut etiketlerini çeker. */
  async fetchHebiarLabels(clKeys, log = () => {}) {
    const map = new Map();
    const unique = [...new Set(clKeys.filter(Boolean))];
    const chunk = 50;
    for (let i = 0; i < unique.length; i += chunk) {
      const part = unique.slice(i, i + chunk);
      const jql = `key in (${part.map((k) => `"${k}"`).join(",")})`;
      try {
        const issues = await this.searchAllJql(HEBIAR_BASE_URL, jql, [
          "labels",
        ]);
        for (const is of issues) map.set(is.key, is.fields?.labels || []);
      } catch (err) {
        log(
          "Hebiar etiket sorgusu hatası: " +
            (err.response?.data?.errorMessages || err.message),
        );
      }
    }
    return map;
  }

  /** Hebiar taskının etiketlerini verilen dizi ile birebir günceller (overwrite). */
  async updateHebiarLabels(key, labels) {
    await axios.put(
      `${HEBIAR_BASE_URL}/rest/api/3/issue/${key}`,
      { fields: { labels } },
      { headers: this.getAuthHeader(), timeout: REQ_TIMEOUT },
    );
  }

  _sameSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    return b.every((x) => sa.has(x));
  }

  /** 429 / 5xx durumunda geri çekilerek yeniden dener. */
  async _withRetry(fn, tries = 4) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (err) {
        const status = err.response?.status;
        if (status === 429 || (status >= 500 && status < 600)) {
          await new Promise((r) => setTimeout(r, (i + 1) * 1500));
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  async _mapWithConcurrency(items, limit, fn) {
    let idx = 0;
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (idx < items.length) {
          const cur = idx++;
          await fn(items[cur], cur);
        }
      },
    );
    await Promise.all(workers);
  }

  /**
   * Etiketleri eşitler. dryRun=true ise hiçbir yazma yapılmaz, sadece plan döner.
   * onLog(msg) ilerleme satırları için çağrılır (opsiyonel).
   * Yapılandırılmış bir sonuç nesnesi döner.
   */
  async syncLabels({ dryRun = false, onLog = () => {} } = {}) {
    if (this._running) {
      throw new Error("Eşitleme zaten çalışıyor. Lütfen bitmesini bekleyin.");
    }
    this._running = true;
    const startedAt = Date.now();
    const log = (m) => {
      try {
        onLog(m);
      } catch {}
    };

    try {
      log(
        `🔗 Olka → Hebiar etiket eşitleme (Hebiar = Olka birebir kopya)${
          dryRun ? " — DRY-RUN" : ""
        }`,
      );

      const cllinkFieldId = await this.getCllinkFieldId();
      if (!cllinkFieldId) {
        throw new Error("CLLINK alanı bulunamadı; eşleştirme yapılamıyor.");
      }

      // 1) Tüm Olka tasklarını (etiket + CLLINK) çek
      const olkaFields = ["summary", "labels", cllinkFieldId];
      let olkaIssues;
      try {
        olkaIssues = await this.searchAllJql(
          OLKA_BASE_URL,
          `project = "${OLKA_PROJECT_QUERY}" ORDER BY key ASC`,
          olkaFields,
        );
      } catch (err) {
        log(
          "Proje adı ile sorgu başarısız, proje anahtarı ile deneniyor: " +
            (err.response?.data?.errorMessages || err.message),
        );
        olkaIssues = await this.searchAllJql(
          OLKA_BASE_URL,
          `project = ${OLKA_PROJECT_KEY} ORDER BY key ASC`,
          olkaFields,
        );
      }
      log(`📥 Olka task sayısı: ${olkaIssues.length}`);

      // 2) CLLINK'e göre Hebiar anahtarına eşle; aynı CL key'e birden çok
      //    Olka taskı bağlıysa etiketleri birleştir (union) -> tek hedef.
      const byClKey = new Map();
      let noLinkCount = 0;
      for (const issue of olkaIssues) {
        const f = issue.fields || {};
        const clKey = this.extractClKey(f[cllinkFieldId]);
        if (!clKey) {
          noLinkCount++;
          continue;
        }
        if (!byClKey.has(clKey)) {
          byClKey.set(clKey, { clKey, olkaKeys: [], labels: new Set() });
        }
        const g = byClKey.get(clKey);
        g.olkaKeys.push(issue.key);
        for (const l of f.labels || []) g.labels.add(l);
      }
      const groups = [...byClKey.values()];
      log(
        `🔗 CLLINK ile eşleşen benzersiz Hebiar taskı: ${groups.length} ` +
          `(CLLINK'i olmayan Olka taskı atlandı: ${noLinkCount})`,
      );

      // 3) Hebiar mevcut etiketlerini çek
      const hebiarLabels = await this.fetchHebiarLabels(
        groups.map((g) => g.clKey),
        log,
      );

      // 4) Değişiklikleri hesapla
      const toUpdate = [];
      const notFoundKeys = [];
      let alreadyEqual = 0;
      for (const g of groups) {
        if (!hebiarLabels.has(g.clKey)) {
          notFoundKeys.push(g.clKey);
          continue;
        }
        const current = hebiarLabels.get(g.clKey);
        const target = [...g.labels];
        if (this._sameSet(current, target)) {
          alreadyEqual++;
          continue;
        }
        const added = target.filter((l) => !current.includes(l));
        const removed = current.filter((l) => !target.includes(l));
        toUpdate.push({
          clKey: g.clKey,
          olkaKeys: g.olkaKeys,
          current,
          target,
          added,
          removed,
        });
      }

      log(
        `📊 Plan: zaten eşit ${alreadyEqual}, güncellenecek ${toUpdate.length}, ` +
          `bulunamadı ${notFoundKeys.length}`,
      );

      // 5) Uygula
      let updatedCount = 0;
      let failedCount = 0;
      let totalAdded = 0;
      let totalRemoved = 0;
      const changes = [];
      const errors = [];

      await this._mapWithConcurrency(toUpdate, CONCURRENCY, async (u) => {
        const change = {
          clKey: u.clKey,
          olkaKeys: u.olkaKeys,
          added: u.added,
          removed: u.removed,
          target: u.target,
        };
        if (dryRun) {
          change.status = "dry";
          changes.push(change);
          totalAdded += u.added.length;
          totalRemoved += u.removed.length;
          updatedCount++;
          return;
        }
        try {
          await this._withRetry(() =>
            this.updateHebiarLabels(u.clKey, u.target),
          );
          change.status = "updated";
          changes.push(change);
          totalAdded += u.added.length;
          totalRemoved += u.removed.length;
          updatedCount++;
          log(`✔ ${u.clKey}`);
        } catch (err) {
          failedCount++;
          const message =
            err.response?.data?.errors ||
            err.response?.data?.errorMessages ||
            err.message;
          errors.push({ clKey: u.clKey, message });
          change.status = "failed";
          change.error =
            typeof message === "string" ? message : JSON.stringify(message);
          changes.push(change);
          log(`✖ ${u.clKey} güncellenemedi`);
        }
      });

      const result = {
        dryRun,
        cllinkFieldFound: true,
        olkaCount: olkaIssues.length,
        matchedCount: groups.length,
        noLinkCount,
        alreadyEqual,
        updatedCount,
        failedCount,
        totalAdded,
        totalRemoved,
        notFoundCount: notFoundKeys.length,
        notFoundKeys,
        changes,
        errors,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
      };
      log(
        `✅ Tamamlandı${dryRun ? " (DRY-RUN)" : ""}: güncellenen ${updatedCount}, ` +
          `başarısız ${failedCount}, +${totalAdded} / -${totalRemoved} etiket`,
      );
      return result;
    } finally {
      this._running = false;
    }
  }
}

export default new LabelSyncService();
