async function loadClosedReport() {
    const date = document.getElementById('closedReportDate').value;
    const container = document.getElementById('closedReportContent');
    
    container.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>Kapanan task raporu yükleniyor...</span>
        </div>
    `;
    
    try {
        const response = await fetch(`/api/daily-closed?date=${date}`);
        
        if (!response.ok) {
            throw new Error('Kapanan task raporu alınamadı');
        }
        
        const data = await response.json();
        renderClosedReport(data);
        
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${error.message}
            </div>
        `;
    }
}

function renderClosedReport(data) {
    const container = document.getElementById('closedReportContent');
    const dateStr = new Date(data.date).toLocaleDateString('tr-TR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const rows = data.rows || [];
    const totals = data.totals || { sprint: 0, support: 0, total: 0 };
    const badge = `<span class="period-badge" style="margin-left: auto; align-self: center;">${dateStr}</span>`;
    
    if (rows.length === 0) {
        container.innerHTML = `
            ${renderWorkloadSummary(totals)}
            <div style="text-align: center; padding: 30px; color: rgba(255,255,255,0.6);">
                <span class="period-badge">${dateStr}</span><br><br>
                Bu tarihte kapanan task bulunamadı.
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        ${renderWorkloadSummary(totals, badge)}
        ${renderWorkloadTable(rows, totals)}
    `;
}

// ============== Proje Raporu (sprint bazlı) Fonksiyonları ==============
const PROJECT_REPORT_COLORS = [
    '#4361ee', '#38b000', '#fb8500', '#d61a67', '#9d4edd',
    '#0090b3', '#e63946', '#ffb703', '#2a9d8f', '#8338ec',
    '#ff6b6b', '#3a86ff', '#06d6a0', '#f4a261', '#7209b7'
];
