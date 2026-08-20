async function exportUnsprintedExcel() {
    if (!lastUnsprintedData || !lastUnsprintedData.rows || lastUnsprintedData.rows.length === 0) {
        alert('Önce iki sprint seçip "Karşılaştır" ile bir sonuç oluşturun.');
        return;
    }
    
    const clean = (t) => (t || '').replace(/\(aktif\)/g, '').trim();
    const olkaSprintName = clean(document.getElementById('olkaSprintSelect').selectedOptions[0]?.text);
    const hebiarSprintName = clean(document.getElementById('hebiarSprintSelect').selectedOptions[0]?.text);
    
    const btn = document.getElementById('exportExcelBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    
    try {
        const res = await fetch('/api/unsprinted/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows: lastUnsprintedData.rows,
                olkaSprintName,
                hebiarSprintName,
                olkaTotal: lastUnsprintedData.olkaTotal,
                hebiarTotal: lastUnsprintedData.hebiarTotal
            })
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Excel oluşturulamadı');
        }
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const sanitize = (t) => (t || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
        const stamp = new Date().toISOString().slice(0, 10);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `sprinte-alinmayan_${sanitize(olkaSprintName) || 'olka'}_vs_${sanitize(hebiarSprintName) || 'hebiar'}_${stamp}.xlsx`;
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

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Her iki taraftaki sprint listelerini yükle
async function loadUnsprintedSprints() {
    const olkaSelect = document.getElementById('olkaSprintSelect');
    const hebiarSelect = document.getElementById('hebiarSprintSelect');
    
    olkaSelect.innerHTML = '<option value="">Sprintler yükleniyor...</option>';
    hebiarSelect.innerHTML = '<option value="">Sprintler yükleniyor...</option>';
    
    // Olka sprintleri
    try {
        const res = await fetch('/api/unsprinted/olka-sprints');
        if (!res.ok) throw new Error((await res.json()).error || 'Olka sprintleri alınamadı');
        const sprints = await res.json();
        olkaSelect.innerHTML = '<option value="">Sprint seçin...</option>' + sprints.map(s =>
            `<option value="${s.id}"${s.state === 'active' ? ' selected' : ''}>${escapeHtml(s.name)}${s.state === 'active' ? ' (aktif)' : ''}</option>`
        ).join('');
    } catch (error) {
        olkaSelect.innerHTML = `<option value="">Hata: ${escapeHtml(error.message)}</option>`;
    }
    
    // Hebiar sprintleri
    try {
        const res = await fetch('/api/unsprinted/hebiar-sprints');
        if (!res.ok) throw new Error((await res.json()).error || 'Hebiar sprintleri alınamadı');
        const sprints = await res.json();
        hebiarSelect.innerHTML = '<option value="">Sprint seçin...</option>' + sprints.map(s =>
            `<option value="${s.id}"${s.state === 'active' ? ' selected' : ''}>${escapeHtml(s.name)}${s.state === 'active' ? ' (aktif)' : ''}</option>`
        ).join('');
    } catch (error) {
        hebiarSelect.innerHTML = `<option value="">Hata: ${escapeHtml(error.message)}</option>`;
    }
}

// Karşılaştırma raporunu yükle
async function loadUnsprintedReport() {
    const olkaSprintId = document.getElementById('olkaSprintSelect').value;
    const hebiarSprintId = document.getElementById('hebiarSprintSelect').value;
    const container = document.getElementById('unsprintedReportContent');
    const infoBar = document.getElementById('unsprintedInfoBar');
    
    if (!olkaSprintId || !hebiarSprintId) {
        alert('Lütfen hem Olka hem de Hebiar sprintini seçin.');
        return;
    }
    
    infoBar.innerHTML = '';
    container.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>Tasklar karşılaştırılıyor...</span>
        </div>
    `;
    
    try {
        const res = await fetch(`/api/unsprinted/report?olkaSprintId=${encodeURIComponent(olkaSprintId)}&hebiarSprintId=${encodeURIComponent(hebiarSprintId)}`);
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        renderUnsprintedReport(data);
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderUnsprintedReport(data) {
    lastUnsprintedData = data;
    const container = document.getElementById('unsprintedReportContent');
    const infoBar = document.getElementById('unsprintedInfoBar');
    
    infoBar.innerHTML = `
        <span style="background: rgba(67,97,238,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🟦 Olka Task: <strong>${data.olkaTotal}</strong></span>
        <span style="background: rgba(76,175,80,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🟩 Hebiar Sprint Task: <strong>${data.hebiarTotal}</strong></span>
        <span style="background: rgba(231,76,60,0.35); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🚫 Sprinte Alınmayan: <strong>${data.count}</strong></span>
        ${!data.cllinkFieldFound ? `<span style="background: rgba(243,156,18,0.35); padding: 5px 12px; border-radius: 6px; font-size: 13px;">⚠️ CLLINK alanı bulunamadı</span>` : ''}
    `;
    
    const rows = data.rows || [];
    
    if (rows.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: var(--text-secondary);">
                🎉 Seçilen Olka sprintindeki tüm tasklar Hebiar sprintine alınmış.
            </div>
        `;
        return;
    }
    
    let tableHTML = `
        <table class="daily-report-table" style="width: 100%;">
            <thead>
                <tr>
                    <th style="text-align: left;">Olka Task No</th>
                    <th style="text-align: left;">CL Task No</th>
                    <th style="text-align: left;">Task Adı</th>
                    <th style="text-align: left;">Atanan Kişi</th>
                    <th style="text-align: left;">Reporter</th>
                    <th style="text-align: left;">Statüsü</th>
                    <th style="text-align: left;">Öncelik Seviyesi</th>
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
                <td>${clLink}</td>
                <td style="font-size: 13px;">${escapeHtml(r.summary)}</td>
                <td>${r.assignee ? escapeHtml(r.assignee) : '<span style="color: var(--text-muted);">Atanmamış</span>'}</td>
                <td>${r.reporter ? escapeHtml(r.reporter) : '—'}</td>
                <td>${r.status ? `<span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 8px; font-size: 12px;">${escapeHtml(r.status)}</span>` : '—'}</td>
                <td>${r.priority ? escapeHtml(r.priority) : '—'}</td>
            </tr>
        `;
    });
    
    tableHTML += `
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

// ========== Olka Deploy (Ready for Ship) ==========
// ===== Etiket Eşitle (Olka -> Hebiar) =====
let labelSyncRunning = false;
let lastLabelSyncData = null;
