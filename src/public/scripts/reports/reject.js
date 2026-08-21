const rejectSort = { key: 'projectName', direction: 1 };

async function loadRejectReport() {
    const listEl = document.getElementById('rejectProjectList');
    const tableEl = document.getElementById('rejectTableContent');
    const infoBar = document.getElementById('rejectInfoBar');
    
    infoBar.innerHTML = '';
    listEl.innerHTML = '';
    tableEl.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>Reddedilen maddeler yükleniyor...</span>
        </div>
    `;
    
    try {
        const res = await fetch('/api/reject/report');
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        lastRejectData = data;
        selectedRejectProject = '__all__';
        
        populateRejectProjectFilter();
        renderRejectInfo();
        renderRejectProjects();
        renderRejectTable();
    } catch (error) {
        infoBar.innerHTML = '';
        listEl.innerHTML = '';
        tableEl.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function populateRejectProjectFilter() {
    const select = document.getElementById('rejectProjectFilter');
    if (!select || !lastRejectData) return;
    select.innerHTML = [
        '<option value="__all__">Tümü</option>',
        ...(lastRejectData.projects || []).map(project =>
            `<option value="${escapeHtml(project.key)}">${escapeHtml(project.name)} (${project.count})</option>`
        )
    ].join('');
    select.value = selectedRejectProject;
}

function onRejectProjectFilterChange() {
    selectedRejectProject = document.getElementById('rejectProjectFilter')?.value || '__all__';
    renderRejectProjects();
    renderRejectTable();
}

function renderRejectInfo() {
    const data = lastRejectData;
    const infoBar = document.getElementById('rejectInfoBar');
    if (!data) { infoBar.innerHTML = ''; return; }
    const statusText = (data.statuses || ['Reject']).join(', ');
    const totalProjects = data.projectCount || (data.projects ? data.projects.length : 0);
    const rejectProjects = data.rejectProjectCount != null
        ? data.rejectProjectCount
        : (data.projects ? data.projects.filter(p => p.count > 0).length : 0);
    infoBar.innerHTML = `
        <span style="background: rgba(230,57,70,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">⛔ Toplam Madde: <strong>${data.count}</strong></span>
        <span style="background: rgba(67,97,238,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">📊 Proje: <strong>${totalProjects}</strong></span>
        <span style="background: rgba(251,133,0,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">⚠️ Kayıtlı Proje: <strong>${rejectProjects}</strong></span>
        <span style="background: rgba(255,255,255,0.08); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🏷️ Statü: <strong>${escapeHtml(statusText)}</strong></span>
    `;
}

// Proje listesini (sol panel) çiz
function renderRejectProjects() {
    const data = lastRejectData;
    const listEl = document.getElementById('rejectProjectList');
    if (!data || !data.projects) { listEl.innerHTML = ''; return; }
    
    let html = `<div class="rfr-people-title">Projeler (${data.projects.length})</div>`;
    
    // "Tümü" seçeneği (tüm projelerin maddelerini gösterir)
    html += `
        <div class="rfr-person ${selectedRejectProject === '__all__' ? 'active' : ''}" onclick="selectRejectProject('__all__')">
            <span class="rfr-person-name">📋 Tümü</span>
            <span class="rfr-badges"><span class="rfr-badge">${data.count}</span></span>
        </div>
    `;
    
    data.projects.forEach(p => {
        const isActive = selectedRejectProject === p.key;
        const zero = !p.count;
        const badgeStyle = zero ? 'style="opacity:0.4;"' : '';
        const nameStyle = zero ? 'style="opacity:0.6;"' : '';
        html += `
            <div class="rfr-person ${isActive ? 'active' : ''}" onclick="selectRejectProject(${escapeHtml(JSON.stringify(p.key))})" title="${escapeHtml(p.name)} (${escapeHtml(p.key)})">
                <span class="rfr-person-name" ${nameStyle}>${escapeHtml(p.name)}</span>
                <span class="rfr-badges"><span class="rfr-badge" ${badgeStyle}>${p.count}</span></span>
            </div>
        `;
    });
    
    listEl.innerHTML = html;
}

function selectRejectProject(key) {
    selectedRejectProject = key;
    const select = document.getElementById('rejectProjectFilter');
    if (select) select.value = key;
    renderRejectProjects();
    renderRejectTable();
}

// Seçili projeye göre görünen satırları döndürür
function getFilteredRejectRows() {
    if (!lastRejectData || !lastRejectData.rows) return [];
    const rows = selectedRejectProject === '__all__'
        ? lastRejectData.rows
        : lastRejectData.rows.filter(r => r.projectKey === selectedRejectProject);
    return sortReportRows(rows, rejectSort);
}

function formatRejectDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// Görünen satırlar için madde tablosunu çiz
function renderRejectTable() {
    const tableEl = document.getElementById('rejectTableContent');
    if (!lastRejectData) return;
    
    const rows = getFilteredRejectRows();
    
    if (rows.length === 0) {
        tableEl.innerHTML = `
            <div class="rfr-empty">
                Seçilen projede reddedilen madde bulunamadı.
            </div>
        `;
        return;
    }
    
    let tableHTML = `
        <table class="rfr-table">
            <thead>
                <tr>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'projectName', renderRejectTable)">Proje${reportSortIndicator(rejectSort, 'projectName')}</th>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'key', renderRejectTable)">Task Kodu${reportSortIndicator(rejectSort, 'key')}</th>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'summary', renderRejectTable)">Task Özet${reportSortIndicator(rejectSort, 'summary')}</th>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'assignee', renderRejectTable)">Atanan Kişi${reportSortIndicator(rejectSort, 'assignee')}</th>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'statusName', renderRejectTable)">Statü${reportSortIndicator(rejectSort, 'statusName')}</th>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'created', renderRejectTable)">Oluşturulma${reportSortIndicator(rejectSort, 'created')}</th>
                    <th class="sortable" onclick="toggleReportSort(rejectSort, 'updated', renderRejectTable)">Son Güncelleme${reportSortIndicator(rejectSort, 'updated')}</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    rows.forEach(r => {
        const keyLink = `<a href="https://hebiar.atlassian.net/browse/${encodeURIComponent(r.key)}" target="_blank" style="color: #81c784; text-decoration: none; font-weight: 500;">${escapeHtml(r.key)}</a>`;
        tableHTML += `
            <tr>
                <td><span style="font-weight: 500;">${escapeHtml(r.projectName || r.projectKey)}</span></td>
                <td>${keyLink}</td>
                <td>${escapeHtml(r.summary)}</td>
                <td>${r.assignee ? escapeHtml(r.assignee) : '<span style="color: var(--text-muted);">Atanmamış</span>'}</td>
                <td><span style="background: rgba(230,57,70,0.18); color: var(--accent-red); padding: 2px 8px; border-radius: 8px; font-size: 12px;">${escapeHtml(r.statusName)}</span></td>
                <td>${formatRejectDate(r.created)}</td>
                <td>${formatRejectDate(r.updated)}</td>
            </tr>
        `;
    });
    
    tableHTML += `
            </tbody>
        </table>
    `;
    
    tableEl.innerHTML = tableHTML;
}

// Mevcut (projeye göre filtrelenmiş) sonucu şablonlu Excel (.xlsx) olarak indir
async function exportRejectExcel() {
    if (!lastRejectData || !lastRejectData.rows || lastRejectData.rows.length === 0) {
        alert('Önce "Yenile" ile reddedilen maddeleri listeleyin.');
        return;
    }
    
    // Proje seçilmediyse tüm maddeleri, seçildiyse yalnızca o projenin maddelerini aktar
    const rows = getFilteredRejectRows();
    const btn = document.getElementById('exportRejectBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    
    try {
        const res = await fetch('/api/reject/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows,
                statuses: lastRejectData.statuses,
                projectCount: lastRejectData.projectCount
            })
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
        a.download = `reject-takip_${stamp}.xlsx`;
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

// ========== HDV Son Durum ==========
let hdvStatusLoaded = false;
let lastHdvStatusData = null;
