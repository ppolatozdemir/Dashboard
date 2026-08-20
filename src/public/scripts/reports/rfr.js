async function loadRfrReport() {
    const peopleEl = document.getElementById('rfrPeopleList');
    const tableEl = document.getElementById('rfrTableContent');
    const infoBar = document.getElementById('rfrInfoBar');
    
    infoBar.innerHTML = '';
    peopleEl.innerHTML = '';
    tableEl.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>RFR tasklar yükleniyor...</span>
        </div>
    `;
    
    try {
        const res = await fetch('/api/rfr/report');
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        lastRfrData = data;
        selectedRfrPerson = null;
        
        renderRfrInfo();
        renderRfrPeople();
        renderRfrTable();
    } catch (error) {
        infoBar.innerHTML = '';
        peopleEl.innerHTML = '';
        tableEl.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderRfrInfo() {
    const data = lastRfrData;
    const infoBar = document.getElementById('rfrInfoBar');
    if (!data) { infoBar.innerHTML = ''; return; }
    infoBar.innerHTML = `
        <span style="background: rgba(67,97,238,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🚦 Toplam RFR: <strong>${data.count}</strong></span>
        <span style="background: rgba(76,175,80,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">👥 Kişi: <strong>${data.peopleCount || (data.people ? data.people.length : 0)}</strong></span>
        <span style="background: rgba(230,57,70,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">⏰ ${data.overdueDays} günü geçen: <strong>${data.overdueCount}</strong></span>
    `;
}

// Kişi listesini (sol panel) çiz
function renderRfrPeople() {
    const data = lastRfrData;
    const peopleEl = document.getElementById('rfrPeopleList');
    if (!data || !data.people) { peopleEl.innerHTML = ''; return; }
    
    let html = '<div class="rfr-people-title">Kişiler</div>';
    
    // "Tümü" seçeneği (tüm kişilerin tasklarını gösterir)
    html += `
        <div class="rfr-person ${selectedRfrPerson === '__all__' ? 'active' : ''}" onclick="selectRfrPerson('__all__')">
            <span class="rfr-person-name">📋 Tümü</span>
            <span class="rfr-badges"><span class="rfr-badge">${data.count}</span></span>
        </div>
    `;
    
    data.people.forEach(p => {
        const isActive = selectedRfrPerson === p.name;
        const overdueBadge = p.overdueCount > 0
            ? `<span class="rfr-badge overdue" title="${p.overdueCount} task 1 ayı geçti">${p.overdueCount}</span>`
            : '';
        html += `
            <div class="rfr-person ${isActive ? 'active' : ''}" onclick="selectRfrPerson(${escapeHtml(JSON.stringify(p.name))})" title="${escapeHtml(p.name)}">
                <span class="rfr-person-name">${escapeHtml(p.name)}</span>
                <span class="rfr-badges">
                    <span class="rfr-badge">${p.count}</span>
                    ${overdueBadge}
                </span>
            </div>
        `;
    });
    
    peopleEl.innerHTML = html;
}

function selectRfrPerson(name) {
    selectedRfrPerson = name;
    renderRfrPeople();
    renderRfrTable();
}

// Seçili kişiye göre görünen satırları döndürür
function getFilteredRfrRows() {
    if (!lastRfrData || !lastRfrData.rows) return [];
    if (selectedRfrPerson === null) return [];              // henüz kişi seçilmedi -> boş
    if (selectedRfrPerson === '__all__') return lastRfrData.rows;
    return lastRfrData.rows.filter(r => (r.assignee || 'Atanmamış') === selectedRfrPerson);
}

function formatRfrDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// Görünen satırlar için task tablosunu çiz
function renderRfrTable() {
    const tableEl = document.getElementById('rfrTableContent');
    if (!lastRfrData) return;
    
    // Henüz bir kişi seçilmediyse task listesi yerine yönlendirme mesajı göster
    if (selectedRfrPerson === null) {
        tableEl.innerHTML = `
            <div class="rfr-empty">
                👈 Soldaki listeden bir <strong>kişi</strong> seçin; o kişinin RFR taskları burada listelensin.<br>
                Tüm taskları görmek için <strong>"📋 Tümü"</strong>ne tıklayın.
            </div>
        `;
        return;
    }
    
    const rows = getFilteredRfrRows();
    
    if (rows.length === 0) {
        tableEl.innerHTML = `
            <div class="rfr-empty">
                Seçilen kişiye ait RFR task bulunamadı.
            </div>
        `;
        return;
    }
    
    let tableHTML = `
        <table class="rfr-table">
            <thead>
                <tr>
                    <th>Atanan Kişi</th>
                    <th>Task Kodu</th>
                    <th>Task Özet</th>
                    <th>Statü</th>
                    <th>Son Statü Güncelleme Tarihi</th>
                    <th>Kaç Gündür RFR'de</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    rows.forEach(r => {
        const keyLink = `<a href="https://hebiar.atlassian.net/browse/${encodeURIComponent(r.key)}" target="_blank" style="color: #81c784; text-decoration: none; font-weight: 500;">${escapeHtml(r.key)}</a>`;
        const days = r.daysInRfr != null ? r.daysInRfr : '—';
        const overdueTag = r.overdue ? '<span class="rfr-overdue-tag">1 AY+</span>' : '';
        tableHTML += `
            <tr class="${r.overdue ? 'rfr-overdue' : ''}">
                <td>${r.assignee ? escapeHtml(r.assignee) : '<span style="color: var(--text-muted);">Atanmamış</span>'}</td>
                <td>${keyLink}</td>
                <td>${escapeHtml(r.summary)}</td>
                <td><span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 8px; font-size: 12px;">${escapeHtml(r.statusName)}</span></td>
                <td>${formatRfrDate(r.rfrSince)}</td>
                <td><span class="rfr-days ${r.overdue ? 'overdue' : ''}">${days} gün</span>${overdueTag}</td>
            </tr>
        `;
    });
    
    tableHTML += `
            </tbody>
        </table>
    `;
    
    tableEl.innerHTML = tableHTML;
}

// Mevcut (kişiye göre filtrelenmiş) sonucu şablonlu Excel (.xlsx) olarak indir
async function exportRfrExcel() {
    if (!lastRfrData || !lastRfrData.rows || lastRfrData.rows.length === 0) {
        alert('Önce "Yenile" ile RFR tasklarını listeleyin.');
        return;
    }
    
    // Kişi seçilmediyse tüm taskları, seçildiyse yalnızca o kişinin tasklarını aktar
    const rows = selectedRfrPerson === null ? lastRfrData.rows : getFilteredRfrRows();
    const btn = document.getElementById('exportRfrBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    
    try {
        const res = await fetch('/api/rfr/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows,
                status: lastRfrData.status,
                overdueDays: lastRfrData.overdueDays
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
        a.download = `rfr-takip_ready-for-release_${stamp}.xlsx`;
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

// ========== Reject Takip (Reddedilen Maddeler) ==========
let rejectLoaded = false;
let lastRejectData = null;
let selectedRejectProject = null; // null = henüz seçim yok, '__all__' = tümü, aksi halde proje key

// Reddedilen maddeleri yükle
