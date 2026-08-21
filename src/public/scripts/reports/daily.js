async function loadDailyReport() {
    const container = document.getElementById('dailyReportContent');
    
    container.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>İş yükü raporu yükleniyor...</span>
        </div>
    `;
    
    try {
        const response = await fetch('/api/daily-report');
        
        if (!response.ok) {
            throw new Error('İş yükü raporu alınamadı');
        }
        
        const data = await response.json();
        renderDailyReport(data);
        
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${error.message}
            </div>
        `;
    }
}

function renderExcludedStatusCards(breakdown) {
    if (!breakdown || breakdown.length === 0) return '';
    return `
        <div class="excluded-status-cards">
            ${breakdown.map(item => `
                <div class="excluded-status-card">
                    <div class="value">${item.count}</div>
                    <div class="label">${item.status}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderWorkloadSummary(totals, badgeHtml = '') {
    return `
        <div class="daily-summary-cards">
            <div class="daily-summary-card sprint">
                <div class="value">${totals.sprint}</div>
                <div class="label">Sprint</div>
            </div>
            <div class="daily-summary-card support">
                <div class="value">${totals.support}</div>
                <div class="label">Support</div>
            </div>
            <div class="daily-summary-card total">
                <div class="value">${totals.total}</div>
                <div class="label">Toplam</div>
            </div>
            ${badgeHtml}
        </div>
    `;
}

function renderWorkloadTable(rows, totals) {
    return `
        <table class="daily-table">
            <thead>
                <tr><th>Kişi</th><th>Sprint</th><th>Support</th><th>Toplam</th></tr>
            </thead>
            <tbody>
                ${rows.map(person => `
                    <tr>
                        <td>${person.personName}</td>
                        <td>${person.sprint}</td>
                        <td>${person.support}</td>
                        <td><strong>${person.total}</strong></td>
                    </tr>
                `).join('')}
                <tr class="subtotal-row">
                    <td><strong>Alt Toplam</strong></td>
                    <td><strong>${totals.sprint}</strong></td>
                    <td><strong>${totals.support}</strong></td>
                    <td><strong>${totals.total}</strong></td>
                </tr>
            </tbody>
        </table>
    `;
}

function renderDailyReport(data) {
    const container = document.getElementById('dailyReportContent');
    const now = new Date().toLocaleString('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const rows = data.rows || [];
    const totals = data.totals || { sprint: 0, support: 0, total: 0 };
    const excludedCards = renderExcludedStatusCards(data.excludedStatusBreakdown);

    if (rows.length === 0) {
        container.innerHTML = `
            ${renderWorkloadSummary(totals)}
            ${excludedCards}
            <div style="text-align: center; padding: 30px; color: rgba(255,255,255,0.6);">
                <span class="period-badge">${now}</span><br><br>
                Açık task bulunamadı.
            </div>
        `;
        return;
    }
    
    const badge = `<span class="period-badge" style="margin-left: auto; align-self: center;">Güncelleme: ${now}</span>`;
    container.innerHTML = `
        ${renderWorkloadSummary(totals, badge)}
        ${excludedCards}
        ${renderWorkloadTable(rows, totals)}
    `;
}

// ========== Sprinte Alınmayan (Olka vs Hebiar) ==========

// Mevcut sonucu şablonlu Excel (.xlsx) olarak indir
