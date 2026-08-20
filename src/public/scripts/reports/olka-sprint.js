async function loadOlkaSprintReport() {
    const statsEl = document.getElementById('olkaSprintStats');
    const contentEl = document.getElementById('olkaSprintContent');
    const sel = document.getElementById('olkaSprintSelectSprint');
    const sprintId = sel && sel.value ? sel.value : '';
    
    statsEl.innerHTML = '';
    contentEl.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>Sprint raporu yükleniyor...</span>
        </div>
    `;
    
    try {
        const url = sprintId
            ? `/api/olka-sprint/report?sprintId=${encodeURIComponent(sprintId)}`
            : '/api/olka-sprint/report';
        const res = await fetch(url);
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        lastOlkaSprintData = data;
        
        populateOlkaSprintDropdown();
        renderOlkaSprintStats();
        renderOlkaSprintContent();
    } catch (error) {
        statsEl.innerHTML = '';
        contentEl.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

// Dropdown'dan sprint değişince yeniden yükle
function onOlkaSprintChange() {
    loadOlkaSprintReport();
}

// Kapanan sprint listesini dropdown'a doldurur, seçili sprinti işaretler
function populateOlkaSprintDropdown() {
    const sel = document.getElementById('olkaSprintSelectSprint');
    const data = lastOlkaSprintData;
    if (!sel || !data) return;
    const sprints = data.sprints || [];
    if (sprints.length === 0) {
        sel.innerHTML = '<option value="">Sprint yok</option>';
        return;
    }
    sel.innerHTML = sprints.map(s => {
        const end = s.completeDate || s.endDate;
        const dateStr = end ? new Date(end).toLocaleDateString('tr-TR') : '';
        const label = dateStr ? `${s.name} (${dateStr})` : s.name;
        return `<option value="${s.id}">${escapeHtml(label)}</option>`;
    }).join('');
    if (data.sprint) sel.value = String(data.sprint.id);
}

// İstatistik kartlarını çiz
function renderOlkaSprintStats() {
    const el = document.getElementById('olkaSprintStats');
    const data = lastOlkaSprintData;
    if (!data || !data.stats) { el.innerHTML = ''; return; }
    const s = data.stats;
    const width = Math.max(0, Math.min(100, s.successRate));
    el.innerHTML = `
        <div class="stat-card blue">
            <div class="label">Toplam Madde</div>
            <div class="value">${s.total}</div>
            <div class="sub">${escapeHtml((data.prefixes || []).join(' + '))}</div>
        </div>
        <div class="stat-card green">
            <div class="label">Tamamlandı</div>
            <div class="value">${s.completed}</div>
            <div class="sub">RFR, QA, Test, Merge, Merged, Onlive...</div>
        </div>
        <div class="stat-card orange">
            <div class="label">Kalan</div>
            <div class="value">${s.remaining}</div>
            <div class="sub">Diğer statüler</div>
        </div>
        <div class="stat-card red">
            <div class="label">Bloke / Beklemede</div>
            <div class="value">${s.blocked}</div>
            <div class="sub">Blocked, On Hold</div>
        </div>
        <div class="stat-card purple">
            <div class="label">Başarı Yüzdesi</div>
            <div class="value">%${s.successRate}</div>
            <div class="osr-progress-wrap"><div class="osr-progress-bar" style="width: ${width}%;"></div></div>
        </div>
    `;
}

// Üç kolonlu listeyi (tamamlanan / kalan / bloke) çiz
function renderOlkaSprintContent() {
    const el = document.getElementById('olkaSprintContent');
    const data = lastOlkaSprintData;
    if (!data) { el.innerHTML = ''; return; }
    if (!data.sprint) {
        el.innerHTML = '<div class="rfr-empty">Kapanan sprint bulunamadı.</div>';
        return;
    }
    el.innerHTML = `
        <div class="osr-columns">
            ${olkaSprintColumnHtml('completed', '✅ Tamamlananlar', data.completed || [])}
            ${olkaSprintColumnHtml('remaining', '⏳ Kalanlar', data.remaining || [])}
            ${olkaSprintColumnHtml('blocked', '⛔ Bloke / Beklemede', data.blocked || [])}
        </div>
    `;
}

function olkaSprintColumnHtml(cat, title, items) {
    const inner = items.length
        ? items.map(olkaSprintItemHtml).join('')
        : '<div class="osr-list-empty">Bu grupta madde yok.</div>';
    return `
        <div class="osr-col ${cat}">
            <div class="osr-col-header"><span>${title}</span><span class="osr-col-count">${items.length}</span></div>
            <div class="osr-list">${inner}</div>
        </div>
    `;
}

function olkaSprintItemHtml(it) {
    const link = `https://hebiar.atlassian.net/browse/${encodeURIComponent(it.key)}`;
    const assignee = it.assignee ? escapeHtml(it.assignee) : 'Atanmamış';
    return `
        <div class="osr-item">
            <div class="osr-item-top">
                <a class="osr-item-key" href="${link}" target="_blank"><span class="osr-proj">${escapeHtml(it.project || '')}</span>${escapeHtml(it.key || '')}</a>
                <span class="osr-status" title="${escapeHtml(it.status || '')}">${escapeHtml(it.status || '—')}</span>
            </div>
            <div class="osr-item-summary">${escapeHtml(it.summary || '')}</div>
            <div class="osr-item-assignee">👤 ${assignee}</div>
        </div>
    `;
}

// Raporu şablonlu Excel (.xlsx) olarak indir
async function exportOlkaSprintExcel() {
    if (!lastOlkaSprintData || !lastOlkaSprintData.sprint) {
        alert('Önce "Yenile" ile sprint raporunu yükleyin.');
        return;
    }
    const btn = document.getElementById('exportOlkaSprintBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }
    
    try {
        const res = await fetch('/api/olka-sprint/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastOlkaSprintData)
        });
        
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Excel oluşturulamadı');
        }
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const sprintName = (lastOlkaSprintData.sprint.name || 'sprint').replace(/[^a-z0-9]+/gi, '-');
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `olka-sprint-rapor_${sprintName}_${stamp}.xlsx`;
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

// Günlük kapanan task raporu yükleme
