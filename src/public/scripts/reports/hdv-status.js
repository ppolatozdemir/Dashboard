async function loadHdvStatusReport() {
    const infoBar = document.getElementById('hdvStatusInfoBar');
    const contentEl = document.getElementById('hdvStatusReportContent');
    infoBar.innerHTML = '';
    contentEl.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>HDV taskları yükleniyor…</span>
        </div>
    `;
    try {
        const res = await fetch('/api/hdv-status/report');
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        lastHdvStatusData = data;
        populateHdvStatusPersonFilter();
        renderHdvStatusInfo();
        renderHdvStatusTable();
    } catch (error) {
        infoBar.innerHTML = '';
        contentEl.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderHdvStatusInfo() {
    const data = lastHdvStatusData;
    const infoBar = document.getElementById('hdvStatusInfoBar');
    if (!data) { infoBar.innerHTML = ''; return; }
    let html = `<span style="background: rgba(67,97,238,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">📌 Toplam Task: <strong>${data.count}</strong></span>`;
    (data.people || []).forEach(p => {
        html += `<span style="background: var(--bg-secondary); padding: 5px 12px; border-radius: 6px; font-size: 13px;">${escapeHtml(p.name)}: <strong>${p.count}</strong></span>`;
    });
    infoBar.innerHTML = html;
}

function populateHdvStatusPersonFilter() {
    const sel = document.getElementById('hdvStatusPersonFilter');
    if (!sel || !lastHdvStatusData) return;
    const current = sel.value;
    let html = '<option value="">Tümü</option>';
    (lastHdvStatusData.people || []).forEach(p => {
        html += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.count})</option>`;
    });
    sel.innerHTML = html;
    // Önceki seçim hâlâ geçerliyse koru
    if (current && (lastHdvStatusData.people || []).some(p => p.name === current)) {
        sel.value = current;
    }
}

function getFilteredHdvStatusRows() {
    if (!lastHdvStatusData || !lastHdvStatusData.rows) return [];
    const person = document.getElementById('hdvStatusPersonFilter').value;
    const term = (document.getElementById('hdvStatusSearch').value || '').trim().toLowerCase();
    return lastHdvStatusData.rows.filter(r => {
        if (person && r.assignee !== person) return false;
        if (term) {
            const hay = `${r.key} ${r.summary}`.toLowerCase();
            if (!hay.includes(term)) return false;
        }
        return true;
    });
}

function hdvStatusBadge(r) {
    const cat = r.statusCategory;
    let bg = 'rgba(255,255,255,0.08)';
    let color = 'var(--text-secondary)';
    if (cat === 'done') { bg = 'rgba(56,176,0,0.18)'; color = 'var(--accent-green)'; }
    else if (cat === 'indeterminate') { bg = 'rgba(251,133,0,0.18)'; color = 'var(--accent-orange)'; }
    else if (cat === 'new') { bg = 'rgba(67,97,238,0.18)'; color = 'var(--accent-blue)'; }
    const name = r.statusName || '—';
    return `<span style="background: ${bg}; color: ${color}; padding: 2px 8px; border-radius: 8px; font-size: 12px; white-space: nowrap;">${escapeHtml(name)}</span>`;
}

function renderHdvStatusTable() {
    const contentEl = document.getElementById('hdvStatusReportContent');
    if (!lastHdvStatusData) return;
    renderHdvStatusInfo();

    const rows = getFilteredHdvStatusRows();
    if (rows.length === 0) {
        contentEl.innerHTML = `
            <div class="rfr-empty">
                Seçilen kritere uygun task bulunamadı.
            </div>
        `;
        return;
    }

    let tableHTML = `
        <table class="rfr-table">
            <thead>
                <tr>
                    <th>Task No</th>
                    <th>Task Özeti</th>
                    <th>Atanan Kişi</th>
                    <th>Sprint</th>
                    <th>Task Durumu</th>
                    <th>Reporter</th>
                </tr>
            </thead>
            <tbody>
    `;

    rows.forEach(r => {
        const keyLink = `<a href="https://hebiar.atlassian.net/browse/${encodeURIComponent(r.key)}" target="_blank" style="color: #81c784; text-decoration: none; font-weight: 500;">${escapeHtml(r.key)}</a>`;
        tableHTML += `
            <tr>
                <td>${keyLink}</td>
                <td>${escapeHtml(r.summary)}</td>
                <td>${r.assignee ? escapeHtml(r.assignee) : '<span style="color: var(--text-muted);">Atanmamış</span>'}</td>
                <td>${r.sprint ? escapeHtml(r.sprint) : '<span style="color: var(--text-muted);">—</span>'}</td>
                <td>${hdvStatusBadge(r)}</td>
                <td>${r.reporter ? escapeHtml(r.reporter) : '<span style="color: var(--text-muted);">—</span>'}</td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    contentEl.innerHTML = tableHTML;
}

// Mevcut (filtreye göre süzülmüş) sonucu şablonlu Excel (.xlsx) olarak indir
async function exportHdvStatusExcel() {
    if (!lastHdvStatusData || !lastHdvStatusData.rows || lastHdvStatusData.rows.length === 0) {
        alert('Önce "Yenile" ile HDV tasklarını listeleyin.');
        return;
    }
    const rows = getFilteredHdvStatusRows();
    if (rows.length === 0) {
        alert('Dışa aktarılacak task yok (filtreyi kontrol edin).');
        return;
    }
    const btn = document.getElementById('exportHdvStatusBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    try {
        const res = await fetch('/api/hdv-status/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Excel oluşturulamadı');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hdv-son-durum_${stamp}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        alert('❌ Excel indirilemedi: ' + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
}

// ========== MC Panosu (Kanban) ==========
let mcBoardLoaded = false;
let lastMcBoardData = null;

// ========== Proje Raporu (sprint bazlı) ==========
let projectReportLoaded = false;
let lastProjectReportData = null;
let projectReportChart = null;

// ========== Olka Roadmap ==========
let olkaRoadmapLoaded = false;
let lastOlkaRoadmapData = null;
let olkaRoadmapMode = 'monthly';
let olkaRoadmapView = null; // {periodLabel, range, included, excludedCount, monthBreakdown, stats}

const RM_TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const rmPad = (n) => String(n).padStart(2, '0');
const rmToInput = (d) => `${d.getFullYear()}-${rmPad(d.getMonth() + 1)}-${rmPad(d.getDate())}`;
const rmParseInput = (str) => {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y) return null;
    return new Date(y, (m || 1) - 1, d || 1);
};
const rmFmt = (d) => `${rmPad(d.getDate())}.${rmPad(d.getMonth() + 1)}.${d.getFullYear()}`;
const rmMonthLabel = (year, month) => `${RM_TR_MONTHS[month - 1]} ${year}`;
