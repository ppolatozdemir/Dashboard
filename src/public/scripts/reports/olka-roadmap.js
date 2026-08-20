function rmWeekRange(base) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const dow = (d.getDay() + 6) % 7; // 0 = Pazartesi
    const start = new Date(d); start.setDate(d.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
}

async function loadOlkaRoadmapReport() {
    const container = document.getElementById('olkaRoadmapContent');
    container.innerHTML = `
        <div class="loading" style="height: 160px;">
            <div class="loading-spinner"></div>
            <span>Roadmap verisi yükleniyor...</span>
        </div>
    `;
    try {
        const res = await fetch('/api/olka-roadmap/report');
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        lastOlkaRoadmapData = await res.json();
        renderOlkaRoadmapShell();
        setRoadmapMode(olkaRoadmapMode || 'monthly');
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderOlkaRoadmapShell() {
    const container = document.getElementById('olkaRoadmapContent');
    const data = lastOlkaRoadmapData;
    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        container.innerHTML = '<div class="rfr-empty">Roadmap ay etiketli madde bulunamadı.</div>';
        return;
    }
    container.innerHTML = `
        <div class="rm-toolbar">
            <div class="rm-modes">
                <button class="rm-mode-btn" data-mode="weekly" onclick="setRoadmapMode('weekly')">Haftalık</button>
                <button class="rm-mode-btn" data-mode="monthly" onclick="setRoadmapMode('monthly')">Aylık</button>
                <button class="rm-mode-btn" data-mode="yearly" onclick="setRoadmapMode('yearly')">Yıllık</button>
                <button class="rm-mode-btn" data-mode="custom" onclick="setRoadmapMode('custom')">Özel Tarih</button>
                <button class="rm-mode-btn" data-mode="sprint" onclick="setRoadmapMode('sprint')">Sprint</button>
            </div>
            <div class="rm-controls" id="roadmapControls"></div>
            <span class="rm-range-label" id="roadmapRangeLabel"></span>
        </div>
        <div id="roadmapResults"></div>
    `;
}

function setRoadmapMode(mode) {
    olkaRoadmapMode = mode;
    document.querySelectorAll('#olkaRoadmapContent .rm-mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === mode));
    renderRoadmapControls();
    applyRoadmapFilter();
}

function renderRoadmapControls() {
    const el = document.getElementById('roadmapControls');
    const data = lastOlkaRoadmapData;
    if (!el || !data) return;
    const now = new Date();

    if (olkaRoadmapMode === 'weekly') {
        el.innerHTML = `
            <label>Hafta (içindeki bir gün):</label>
            <input type="date" class="rm-date" id="roadmapWeekDate" value="${rmToInput(now)}" onchange="applyRoadmapFilter()">
        `;
    } else if (olkaRoadmapMode === 'monthly') {
        const months = data.months || [];
        const curKey = `${now.getFullYear()}-${rmPad(now.getMonth() + 1)}`;
        const hasCur = months.some(m => m.monthKey === curKey);
        const defKey = hasCur ? curKey : (months.length ? months[months.length - 1].monthKey : '');
        el.innerHTML = `
            <label>Ay:</label>
            <select class="rm-select" id="roadmapMonthSelect" onchange="applyRoadmapFilter()">
                ${months.map(m => `<option value="${m.monthKey}" ${m.monthKey === defKey ? 'selected' : ''}>${escapeHtml(m.label)} (${m.count})</option>`).join('')}
            </select>
        `;
    } else if (olkaRoadmapMode === 'yearly') {
        const years = data.years || [];
        const curY = now.getFullYear();
        const defY = years.includes(curY) ? curY : (years.length ? years[years.length - 1] : curY);
        el.innerHTML = `
            <label>Yıl:</label>
            <select class="rm-select" id="roadmapYearSelect" onchange="applyRoadmapFilter()">
                ${years.map(y => `<option value="${y}" ${y === defY ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
        `;
    } else if (olkaRoadmapMode === 'sprint') {
        const sprints = data.sprints || [];
        if (!sprints.length) {
            el.innerHTML = `<span class="rm-range-label">Sprint bulunamadı.</span>`;
        } else {
            const stLabel = (s) => s.state === 'active' ? '🟢 ' : (s.state === 'future' ? '🔵 ' : '');
            el.innerHTML = `
                <label>Sprint:</label>
                <select class="rm-select" id="roadmapSprintSelect" onchange="applyRoadmapFilter()" style="min-width: 220px;">
                    ${sprints.map(s => `<option value="${s.id}">${stLabel(s)}${escapeHtml(s.name)}</option>`).join('')}
                </select>
            `;
        }
    } else { // custom
        const start = new Date(data.defaultYear || now.getFullYear(), 0, 1);
        const end = now;
        el.innerHTML = `
            <label>Başlangıç:</label>
            <input type="date" class="rm-date" id="roadmapStartDate" value="${rmToInput(start)}" onchange="applyRoadmapFilter()">
            <label>Bitiş:</label>
            <input type="date" class="rm-date" id="roadmapEndDate" value="${rmToInput(end)}" onchange="applyRoadmapFilter()">
        `;
    }
}

function computeRoadmapRange() {
    const now = new Date();
    if (olkaRoadmapMode === 'weekly') {
        const base = rmParseInput((document.getElementById('roadmapWeekDate') || {}).value) || now;
        const { start, end } = rmWeekRange(base);
        return { start, end, label: `Hafta: ${rmFmt(start)} – ${rmFmt(end)}` };
    }
    if (olkaRoadmapMode === 'monthly') {
        const key = (document.getElementById('roadmapMonthSelect') || {}).value || '';
        const [y, m] = key.split('-').map(Number);
        if (!y) return { start: now, end: now, label: '—' };
        const start = new Date(y, m - 1, 1);
        const end = new Date(y, m, 0, 23, 59, 59, 999);
        return { start, end, label: rmMonthLabel(y, m) };
    }
    if (olkaRoadmapMode === 'yearly') {
        const y = Number((document.getElementById('roadmapYearSelect') || {}).value) || now.getFullYear();
        return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59, 999), label: `${y}` };
    }
    // custom
    let start = rmParseInput((document.getElementById('roadmapStartDate') || {}).value) || new Date(now.getFullYear(), 0, 1);
    let end = rmParseInput((document.getElementById('roadmapEndDate') || {}).value) || now;
    end = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    if (start > end) { const t = start; start = end; end = t; }
    return { start, end, label: `${rmFmt(start)} – ${rmFmt(end)}` };
}

function roadmapItemsInRange(range) {
    const items = (lastOlkaRoadmapData && lastOlkaRoadmapData.items) || [];
    const included = [], excluded = [];
    for (const it of items) {
        if (!it.isRoadmap || !it.month) continue;
        const mStart = new Date(it.year, it.month - 1, 1);
        const mEnd = new Date(it.year, it.month, 0, 23, 59, 59, 999);
        if (mStart <= range.end && mEnd >= range.start) {
            (it.excluded ? excluded : included).push(it);
        }
    }
    return { included, excluded };
}

// Madde seçilen sprintten ÖNCE kapanmış bir sprintte de yer alıyorsa "kayan"
// sayılır ve sprinte YENİ ALINAN madde sayımına girmez. JQL karşılığı:
// sprint in openSprints() AND sprint not in closedSprints()
function rmIsCarryover(item, sprint) {
    if (!sprint) return false;
    const selStart = sprint.startDate ? new Date(sprint.startDate).getTime() : null;
    return (item.sprints || []).some(s => {
        if (Number(s.id) === Number(sprint.id)) return false;
        if (s.state !== 'closed') return false;
        if (selStart == null || !s.startDate) return true;
        return new Date(s.startDate).getTime() < selStart;
    });
}

function getSprintRoadmapSelection(data) {
    const allItems = data.items || [];
    const select = document.getElementById('roadmapSprintSelect');
    const sprintId = select ? Number(select.value) : null;
    const sprint = (data.sprints || []).find(item => Number(item.id) === sprintId);
    const inSprint = allItems.filter(item => (item.sprints || []).some(value => Number(value.id) === sprintId));
    const fresh = inSprint.filter(item => !rmIsCarryover(item, sprint));
    const openedItems = fresh.filter(item => !item.excluded);
    return {
        periodLabel: sprint ? sprint.name : 'Sprint',
        included: openedItems.filter(item => item.isRoadmap),
        excludedCount: fresh.filter(item => item.excluded).length,
        openedItems,
        carryoverCount: inSprint.length - fresh.length
    };
}

function getDatedRoadmapSelection(data) {
    const range = computeRoadmapRange();
    const selection = roadmapItemsInRange(range);
    const openedItems = (data.items || []).filter(item => {
        if (!item.created) return false;
        const created = new Date(item.created);
        return created >= range.start && created <= range.end;
    });
    return {
        periodLabel: range.label,
        included: selection.included,
        excludedCount: selection.excluded.length,
        openedItems,
        carryoverCount: 0
    };
}

function buildRoadmapMonthBreakdown(included) {
    const monthMap = new Map();
    included.forEach(item => {
        if (!item.monthKey) return;
        const month = monthMap.get(item.monthKey) || {
            monthKey: item.monthKey, label: item.monthLabel,
            year: item.year, month: item.month, total: 0, completed: 0
        };
        month.total += 1;
        if (item.completed) month.completed += 1;
        monthMap.set(item.monthKey, month);
    });
    return [...monthMap.values()]
        .map(month => ({
            ...month,
            completionRate: month.total > 0 ? Math.round((month.completed / month.total) * 1000) / 10 : 0
        }))
        .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));
}

function createRoadmapView(selection) {
    const { included, openedItems } = selection;
    const total = included.length;
    const completed = included.filter(item => item.completed).length;
    const remaining = total - completed;
    const rate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
    const openedTotal = openedItems.length;
    const openedRoadmapItems = openedItems.filter(item => item.isRoadmap && !item.excluded);
    const openedRoadmap = openedRoadmapItems.length;
    const openedRoadmapCompleted = openedRoadmapItems.filter(item => item.completed).length;
    const roadmapRatio = openedTotal > 0 ? Math.round((openedRoadmap / openedTotal) * 1000) / 10 : 0;
    return {
        mode: olkaRoadmapMode,
        ...selection,
        monthBreakdown: buildRoadmapMonthBreakdown(included),
        stats: { total, completed, remaining, completionRate: rate },
        opened: { total: openedTotal, roadmap: openedRoadmap, roadmapCompleted: openedRoadmapCompleted, roadmapRatio }
    };
}

function applyRoadmapFilter() {
    const data = lastOlkaRoadmapData;
    if (!data || !document.getElementById('roadmapResults')) return;
    const selection = olkaRoadmapMode === 'sprint'
        ? getSprintRoadmapSelection(data)
        : getDatedRoadmapSelection(data);
    const label = document.getElementById('roadmapRangeLabel');
    if (label) label.textContent = selection.periodLabel;
    olkaRoadmapView = createRoadmapView(selection);
    renderRoadmapResults();
}

function renderRoadmapOpenedSection(view) {
    const opened = view.opened || { total: 0, roadmap: 0, roadmapCompleted: 0, roadmapRatio: 0 };
    const isSprint = view.mode === 'sprint';
    const ratioWidth = Math.max(0, Math.min(100, opened.roadmapRatio));
    const title = isSprint ? 'Sprinte Alınan Tasklar' : 'Dönemde Açılan Tasklar (oluşturulma tarihine göre)';
    const subtitle = isSprint ? 'Sprinte yeni alınan OLK maddesi' : 'Dönemde açılan OLK maddesi';
    const carryoverNote = (isSprint && view.carryoverCount) ? `
        <div class="rm-note">
            Önceki (kapanmış) sprintlerden kayan <strong>${view.carryoverCount}</strong> madde sayıma
            <strong>dahil edilmedi</strong>; yalnızca bu sprinte yeni alınanlar gösteriliyor.
        </div>
    ` : '';
    return `
        <div class="rm-section-title">${title}</div>
        ${carryoverNote}
        <div class="stats-grid" style="margin-bottom: 20px;">
            <div class="stat-card blue">
                <div class="label">Toplam Madde</div>
                <div class="value">${opened.total}</div>
                <div class="sub">${subtitle}</div>
            </div>
            <div class="stat-card purple">
                <div class="label">Roadmap Madde</div>
                <div class="value">${opened.roadmap}</div>
                <div class="sub">Ay etiketli veya 2026Ondemand / 2026Strategy</div>
            </div>
            <div class="stat-card green">
                <div class="label">Tamamlanan Roadmap</div>
                <div class="value">${opened.roadmapCompleted}</div>
                <div class="sub">Tamamlanmış roadmap maddesi</div>
            </div>
            <div class="stat-card orange">
                <div class="label">Roadmap Oranı</div>
                <div class="value">%${opened.roadmapRatio}</div>
                <div class="osr-progress-wrap"><div class="osr-progress-bar" style="width:${ratioWidth}%; background: linear-gradient(90deg, var(--accent-orange), #ffb703);"></div></div>
            </div>
        </div>
    `;
}

function renderRoadmapMonthsTable(view) {
    if (view.monthBreakdown.length <= 1) return '';
    return `
        <div class="rm-section-title">Aylık Kırılım</div>
        <div class="rm-months-wrap">
            <table class="rm-table">
                <thead><tr>
                    <th>Ay</th><th style="text-align:center;">Toplam</th>
                    <th style="text-align:center;">Tamamlanan</th><th style="min-width:180px;">Tamamlanma</th>
                </tr></thead>
                <tbody>
                    ${view.monthBreakdown.map(month => `
                        <tr>
                            <td><span class="rm-month-pill">${escapeHtml(month.label)}</span></td>
                            <td style="text-align:center;"><span class="pr-count">${month.total}</span></td>
                            <td style="text-align:center;"><span class="pr-done">${month.completed}</span></td>
                            <td>
                                <div class="pr-bar-wrap">
                                    <div class="pr-bar" style="width:${month.completionRate}%; background:var(--accent-green);"></div>
                                    <span class="pr-bar-label">%${month.completionRate}</span>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderRoadmapCompletionSection(view) {
    const { total, completed, remaining, completionRate } = view.stats;
    const isSprint = view.mode === 'sprint';
    const months = view.monthBreakdown.map(month => month.label).join(', ');
    const completionWidth = Math.max(0, Math.min(100, completionRate));
    const excludedNote = view.excludedCount
        ? ` Ayrıca <strong>${view.excludedCount}</strong> silinmiş/iptal madde hariç tutuldu.`
        : '';
    const note = isSprint
        ? `Sprinte yeni alınan roadmap maddeleri aşağıda listelenmiştir.${excludedNote}`
        : `Döneme düşen roadmap ay(lar)ı: <strong style="color:var(--accent-blue);">${escapeHtml(months)}</strong>.${excludedNote}`;
    return `
        <div class="rm-section-title">Roadmap Tamamlanma${isSprint ? '' : ' (ay etiketine göre)'}</div>
        <div class="rm-note">${note}</div>
        <div class="stats-grid" style="margin-bottom: 20px;">
            <div class="stat-card blue"><div class="label">Roadmap Madde</div><div class="value">${total}</div><div class="sub">${isSprint ? 'Sprinte alınan roadmap maddesi' : 'Seçilen döneme düşen roadmap maddesi'}</div></div>
            <div class="stat-card green"><div class="label">Tamamlanan</div><div class="value">${completed}</div><div class="sub">Onlive, Tamam, RFR, QA, Merge...</div></div>
            <div class="stat-card orange"><div class="label">Kalan</div><div class="value">${remaining}</div><div class="sub">Henüz tamamlanmayan</div></div>
            <div class="stat-card purple">
                <div class="label">Tamamlanma Oranı</div>
                <div class="value">%${completionRate}</div>
                <div class="osr-progress-wrap"><div class="osr-progress-bar" style="width: ${completionWidth}%;"></div></div>
            </div>
        </div>
    `;
}

function renderRoadmapListShell(total) {
    return `
        <div class="rm-list-toolbar">
            <div class="rm-section-title">Maddeler (<span id="roadmapListCount">${total}</span>)</div>
            <div class="rm-controls">
                <label>Durum:</label>
                <select class="rm-select" id="roadmapStatusFilter" onchange="renderRoadmapList()">
                    <option value="all">Tümü</option>
                    <option value="done">Tamamlanan</option>
                    <option value="pending">Kalan</option>
                </select>
            </div>
        </div>
        <div class="rm-list-wrap">
            <table class="rm-table">
                <thead><tr>
                    <th>Task No</th><th>Task Adı</th><th>Atanan</th>
                    <th>Roadmap Ayı</th><th>Statü</th><th>Durum</th>
                </tr></thead>
                <tbody id="roadmapListBody"></tbody>
            </table>
        </div>
    `;
}

function renderRoadmapResults() {
    const element = document.getElementById('roadmapResults');
    const view = olkaRoadmapView;
    if (!element || !view) return;

    const openedSection = renderRoadmapOpenedSection(view);
    if (view.stats.total === 0) {
        const excluded = view.excludedCount
            ? `<div class="rm-note">Bu kapsama düşen <strong>${view.excludedCount}</strong> silinmiş/iptal roadmap maddesi hariç tutuldu.</div>`
            : '';
        element.innerHTML = `${openedSection}${excluded}<div class="rfr-empty">Seçilen kapsama (<strong>${escapeHtml(view.periodLabel)}</strong>) düşen roadmap maddesi bulunamadı.</div>`;
        return;
    }

    element.innerHTML = `
        ${openedSection}
        ${renderRoadmapCompletionSection(view)}
        ${renderRoadmapMonthsTable(view)}
        ${renderRoadmapListShell(view.stats.total)}
    `;
    renderRoadmapList();
}

function renderRoadmapList() {
    const v = olkaRoadmapView;
    const body = document.getElementById('roadmapListBody');
    if (!v || !body) return;
    const filter = (document.getElementById('roadmapStatusFilter') || {}).value || 'all';
    const base = (lastOlkaRoadmapData && lastOlkaRoadmapData.baseUrl) || 'https://hebiar.atlassian.net';

    let rows = v.included;
    if (filter === 'done') rows = rows.filter(r => r.completed);
    else if (filter === 'pending') rows = rows.filter(r => !r.completed);

    // En yeni ay üstte, sonra tamamlanmamışlar önce
    rows = rows.slice().sort((a, b) =>
        (b.year * 12 + b.month) - (a.year * 12 + a.month) ||
        (a.completed === b.completed ? 0 : a.completed ? 1 : -1) ||
        a.key.localeCompare(b.key));

    const cnt = document.getElementById('roadmapListCount');
    if (cnt) cnt.textContent = rows.length;

    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">Bu filtreye uyan madde yok.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map(r => `
        <tr>
            <td><a class="rm-key" href="${base}/browse/${encodeURIComponent(r.key)}" target="_blank" rel="noopener">${escapeHtml(r.key)}</a></td>
            <td>${escapeHtml(r.summary || '')}</td>
            <td>${escapeHtml(r.assignee || 'Atanmamış')}</td>
            <td><span class="rm-month-pill">${escapeHtml(r.monthLabel)}</span></td>
            <td><span class="rm-status">${escapeHtml(r.status || '')}</span></td>
            <td><span class="rm-durum ${r.completed ? 'done' : 'pending'}">${r.completed ? '✔ Tamamlandı' : '⏳ Devam'}</span></td>
        </tr>
    `).join('');
}

async function exportOlkaRoadmapExcel() {
    const v = olkaRoadmapView;
    if (!v || !v.included || v.included.length === 0) {
        alert('Önce bir dönem seçip raporu görüntüleyin (dışa aktarılacak madde yok).');
        return;
    }
    const btn = document.getElementById('olkaRoadmapExcelBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    try {
        const payload = {
            baseUrl: (lastOlkaRoadmapData && lastOlkaRoadmapData.baseUrl) || '',
            periodLabel: v.periodLabel,
            stats: v.stats,
            monthBreakdown: v.monthBreakdown,
            rows: v.included,
        };
        const res = await fetch('/api/olka-roadmap/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Excel oluşturulamadı');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const slug = (v.periodLabel || 'roadmap').replace(/[^a-z0-9]+/gi, '-');
        const a = document.createElement('a');
        a.href = url;
        a.download = `olka-roadmap_${slug}_${stamp}.xlsx`;
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
