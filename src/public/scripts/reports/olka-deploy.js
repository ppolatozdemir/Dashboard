async function loadOlkaDeployReport() {
    const container = document.getElementById('olkaDeployReportContent');
    const infoBar = document.getElementById('olkaDeployInfoBar');
    
    infoBar.innerHTML = '';
    container.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>Ready for Ship tasklar yükleniyor...</span>
        </div>
    `;
    
    try {
        const res = await fetch('/api/olka-deploy/report');
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        lastOlkaDeployData = data;
        
        // CL statü filtre seçeneklerini doldur
        const filter = document.getElementById('olkaDeployStatusFilter');
        const current = filter.value;
        filter.innerHTML = '<option value="">Tümü</option>' +
            (data.clStatuses || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('') +
            '<option value="__none__">— (CL statü yok)</option>';
        filter.value = current;
        
        renderOlkaDeployReport();
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

// Seçilen CL statü filtresine göre görünen satırları döndürür
function getFilteredOlkaDeployRows() {
    if (!lastOlkaDeployData || !lastOlkaDeployData.rows) return [];
    const filterVal = document.getElementById('olkaDeployStatusFilter').value;
    if (!filterVal) return lastOlkaDeployData.rows;
    if (filterVal === '__none__') return lastOlkaDeployData.rows.filter(r => !r.clStatus);
    return lastOlkaDeployData.rows.filter(r => r.clStatus === filterVal);
}

function renderOlkaDeployReport() {
    const data = lastOlkaDeployData;
    const container = document.getElementById('olkaDeployReportContent');
    const infoBar = document.getElementById('olkaDeployInfoBar');
    if (!data) return;
    
    const rows = getFilteredOlkaDeployRows();
    
    infoBar.innerHTML = `
        <span style="background: rgba(67,97,238,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🚀 Ready for Ship: <strong>${data.count}</strong></span>
        <span style="background: rgba(76,175,80,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🔎 Görüntülenen: <strong>${rows.length}</strong></span>
        ${!data.cllinkFieldFound ? `<span style="background: rgba(243,156,18,0.35); padding: 5px 12px; border-radius: 6px; font-size: 13px;">⚠️ CLLINK alanı bulunamadı</span>` : ''}
    `;
    
    if (rows.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--text-secondary);">
                Seçilen filtreye uygun task bulunamadı.
            </div>
        `;
        return;
    }
    
    let tableHTML = `
        <table class="daily-report-table" style="width: 100%;">
            <thead>
                <tr>
                    <th style="text-align: left;">Olka Task No</th>
                    <th style="text-align: left;">Task Adı</th>
                    <th style="text-align: left;">Atanan Kişi</th>
                    <th style="text-align: left;">Reporter</th>
                    <th style="text-align: left;">Cl Task No</th>
                    <th style="text-align: left;">Cl Atanan Kişi</th>
                    <th style="text-align: left;">Cl Statü</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    rows.forEach(r => {
        const olkaLink = `<a href="https://olkaproduct.atlassian.net/browse/${encodeURIComponent(r.olkaKey)}" target="_blank" style="color: #4fc3f7; text-decoration: none; font-weight: 500;">${escapeHtml(r.olkaKey)}</a>`;
        const clLink = r.clKey
            ? `<a href="https://hebiar.atlassian.net/browse/${encodeURIComponent(r.clKey)}" target="_blank" style="color: #81c784; text-decoration: none;">${escapeHtml(r.clKey)}</a>`
            : `<span style="color: var(--text-muted);">—</span>`;
        
        tableHTML += `
            <tr>
                <td>${olkaLink}</td>
                <td style="font-size: 13px;">${escapeHtml(r.summary)}</td>
                <td>${r.assignee ? escapeHtml(r.assignee) : '<span style="color: var(--text-muted);">Atanmamış</span>'}</td>
                <td>${r.reporter ? escapeHtml(r.reporter) : '—'}</td>
                <td>${clLink}</td>
                <td>${r.clAssignee ? escapeHtml(r.clAssignee) : '<span style="color: var(--text-muted);">—</span>'}</td>
                <td>${r.clStatus ? `<span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 8px; font-size: 12px;">${escapeHtml(r.clStatus)}</span>` : '<span style="color: var(--text-muted);">—</span>'}</td>
            </tr>
        `;
    });
    
    tableHTML += `
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

// Mevcut (filtrelenmiş) sonucu şablonlu Excel (.xlsx) olarak indir
async function exportOlkaDeployExcel() {
    if (!lastOlkaDeployData || !lastOlkaDeployData.rows || lastOlkaDeployData.rows.length === 0) {
        alert('Önce "Yenile" ile Ready for Ship tasklarını listeleyin.');
        return;
    }
    
    const rows = getFilteredOlkaDeployRows();
    const btn = document.getElementById('exportOlkaDeployBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    
    try {
        const res = await fetch('/api/olka-deploy/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows,
                status: lastOlkaDeployData.status
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
        a.download = `olka-deploy_ready-for-ship_${stamp}.xlsx`;
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

// ========== RFR Takip (Ready For Release) ==========
let rfrLoaded = false;
let lastRfrData = null;
let selectedRfrPerson = null; // null = henüz seçim yok, '__all__' = tümü, aksi halde kişi adı

// RFR tasklarını yükle
