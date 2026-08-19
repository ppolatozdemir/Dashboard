function projectReportColor(i) {
    return PROJECT_REPORT_COLORS[i % PROJECT_REPORT_COLORS.length];
}

function projectReportSprintLabel(s) {
    const stateMap = { active: '🟢 Aktif', future: '🔵 Gelecek', closed: '⚪ Kapandı' };
    const badge = stateMap[s.state] || '';
    const end = s.completeDate || s.endDate;
    const dateStr = end ? new Date(end).toLocaleDateString('tr-TR') : '';
    let label = s.name;
    if (dateStr) label += ` (${dateStr})`;
    if (badge) label = `${badge}  ${label}`;
    return label;
}

async function loadProjectReport() {
    const container = document.getElementById('projectReportContent');
    const sel = document.getElementById('projectReportSprintSelect');
    const sprintId = sel && sel.value ? sel.value : '';

    container.innerHTML = `
        <div class="loading" style="height: 160px;">
            <div class="loading-spinner"></div>
            <span>Proje raporu yükleniyor...</span>
        </div>
    `;

    try {
        const url = sprintId
            ? `/api/project-report/breakdown?sprintId=${encodeURIComponent(sprintId)}`
            : '/api/project-report/breakdown';
        const res = await fetch(url);
        if (!res.ok) throw new Error((await res.json()).error || 'Rapor alınamadı');
        const data = await res.json();
        lastProjectReportData = data;

        populateProjectReportDropdown();
        renderProjectReport();
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function onProjectReportSprintChange() {
    loadProjectReport();
}

function populateProjectReportDropdown() {
    const sel = document.getElementById('projectReportSprintSelect');
    const data = lastProjectReportData;
    if (!sel || !data) return;
    const sprints = data.sprints || [];
    if (sprints.length === 0) {
        sel.innerHTML = '<option value="">Sprint bulunamadı</option>';
        return;
    }
    sel.innerHTML = sprints.map(s =>
        `<option value="${s.id}">${escapeHtml(projectReportSprintLabel(s))}</option>`
    ).join('');
    if (data.sprint) sel.value = String(data.sprint.id);
}

function getProjectReportStats(data) {
    const total = data.total || 0;
    const completed = data.completed || 0;
    const remaining = data.remaining != null ? data.remaining : total - completed;
    const completionRate = data.completionRate != null
        ? data.completionRate
        : (total > 0 ? Math.round((completed / total) * 1000) / 10 : 0);
    return { total, completed, remaining, completionRate };
}

function renderProjectRows(projects) {
    return projects.map((project, index) => `
        <tr>
            <td>
                <span class="pr-dot" style="background:${projectReportColor(index)};"></span>
                <strong>${escapeHtml(project.name)}</strong>
                <span class="pr-key">${escapeHtml(project.key)}</span>
            </td>
            <td style="text-align:center;"><span class="pr-count">${project.count}</span></td>
            <td style="text-align:center;">
                <span class="pr-done">${project.completed != null ? project.completed : 0}</span>
                <span class="pr-done-rate">%${project.completionRate != null ? project.completionRate : 0}</span>
            </td>
            <td style="text-align:center; min-width:160px;">
                <div class="pr-bar-wrap">
                    <div class="pr-bar" style="width:${project.percentage}%; background:${projectReportColor(index)};"></div>
                    <span class="pr-bar-label">%${project.percentage}</span>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderProjectSummary(data, projects, stats) {
    const completionWidth = Math.max(0, Math.min(100, stats.completionRate));
    return `
        <div class="pr-summary">
            <span class="pr-summary-sprint">🏃 ${escapeHtml(data.sprint.name)}</span>
            <span class="pr-summary-total">📊 Toplam Task: <strong>${stats.total}</strong></span>
            <span class="pr-summary-total">📁 Proje Sayısı: <strong>${projects.length}</strong></span>
        </div>
        <div class="stats-grid" style="margin-bottom: 20px;">
            <div class="stat-card blue"><div class="label">Alınan Madde</div><div class="value">${stats.total}</div><div class="sub">Sprintteki toplam task</div></div>
            <div class="stat-card green"><div class="label">Tamamlanan</div><div class="value">${stats.completed}</div><div class="sub">RFR, Merge, Merged, QA Testing, Test, Tamam...</div></div>
            <div class="stat-card orange"><div class="label">Kalan</div><div class="value">${stats.remaining}</div><div class="sub">Diğer statüler</div></div>
            <div class="stat-card purple">
                <div class="label">Tamamlanma Oranı</div>
                <div class="value">%${stats.completionRate}</div>
                <div class="osr-progress-wrap"><div class="osr-progress-bar" style="width: ${completionWidth}%;"></div></div>
            </div>
        </div>
    `;
}

function renderProjectTable(projects, stats) {
    return `
        <div class="pr-layout">
            <div class="pr-table-wrap">
                <table class="pr-table">
                    <thead><tr><th style="text-align:left;">Proje</th><th style="text-align:center;">Task Sayısı</th><th style="text-align:center;">Tamamlanan</th><th style="text-align:center;">Yüzde</th></tr></thead>
                    <tbody>
                        ${renderProjectRows(projects)}
                        <tr class="pr-total-row">
                            <td><strong>TOPLAM</strong></td>
                            <td style="text-align:center;"><strong>${stats.total}</strong></td>
                            <td style="text-align:center;"><strong>${stats.completed} · %${stats.completionRate}</strong></td>
                            <td style="text-align:center;"><strong>%100</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="pr-chart-wrap"><canvas id="projectReportPie"></canvas></div>
        </div>
    `;
}

function renderProjectReport() {
    const container = document.getElementById('projectReportContent');
    const data = lastProjectReportData;
    if (projectReportChart) { projectReportChart.destroy(); projectReportChart = null; }

    if (!data || !data.sprint) {
        container.innerHTML = '<div class="rfr-empty">Seçilen sprint için veri bulunamadı.</div>';
        return;
    }

    const projects = data.projects || [];
    if (projects.length === 0) {
        container.innerHTML = `
            <div class="rfr-empty">
                <strong>${escapeHtml(data.sprint.name)}</strong> sprintinde task bulunamadı.
            </div>
        `;
        return;
    }

    const stats = getProjectReportStats(data);
    container.innerHTML = `
        ${renderProjectSummary(data, projects, stats)}
        ${renderProjectTable(projects, stats)}
    `;

    renderProjectReportChart(projects);
}

function renderProjectReportChart(projects) {
    const canvas = document.getElementById('projectReportPie');
    if (!canvas || typeof Chart === 'undefined') return;
    const colors = getChartColors();
    projectReportChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels: projects.map(p => `${p.name} (${p.key})`),
            datasets: [{
                data: projects.map(p => p.count),
                backgroundColor: projects.map((p, i) => projectReportColor(i)),
                borderColor: 'rgba(255,255,255,0.15)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: colors.textColor, font: { size: 12 }, boxWidth: 14 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const val = ctx.parsed || 0;
                            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = sum > 0 ? Math.round((val / sum) * 1000) / 10 : 0;
                            return ` ${ctx.label}: ${val} task (%${pct})`;
                        }
                    }
                }
            }
        }
    });
}

async function exportProjectReportExcel() {
    if (!lastProjectReportData || !lastProjectReportData.sprint) {
        alert('Önce bir sprint seçip raporu yükleyin.');
        return;
    }
    const btn = document.getElementById('projectReportExcelBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }

    try {
        const res = await fetch('/api/project-report/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastProjectReportData)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Excel oluşturulamadı');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const sprintName = (lastProjectReportData.sprint.name || 'sprint').replace(/[^a-z0-9]+/gi, '-');
        const a = document.createElement('a');
        a.href = url;
        a.download = `proje-raporu_${sprintName}_${stamp}.xlsx`;
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

function renderProjectCaptureRows(projects) {
    return projects.map((project, index) => {
        const color = projectReportColor(index);
        return `
            <div style="display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid #eef1f7;">
                <span style="width:16px; height:16px; border-radius:4px; background:${color}; flex:0 0 auto;"></span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:18px; font-weight:700; color:#14172b;">${escapeHtml(project.name)}</div>
                    <div style="font-size:13px; color:#8791a3;">${escapeHtml(project.key)} · ✅ ${project.completed != null ? project.completed : 0} tamam (%${project.completionRate != null ? project.completionRate : 0})</div>
                </div>
                <div style="text-align:right; flex:0 0 auto;">
                    <div style="font-size:20px; font-weight:800; color:${color};">${project.count}</div>
                    <div style="font-size:14px; font-weight:600; color:#6b7280;">%${project.percentage}</div>
                </div>
            </div>
            <div style="height:8px; background:#eef1f7; border-radius:5px; margin:0 0 6px 28px; overflow:hidden;">
                <div style="height:100%; width:${project.percentage}%; background:${color}; border-radius:5px;"></div>
            </div>
        `;
    }).join('');
}

function createProjectCaptureWrapper(data, now) {
    const projects = data.projects;
    const stats = getProjectReportStats(data);
    const dateLabel = now.toLocaleString('tr-TR', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
        'position: fixed', 'left: -99999px', 'top: 0',
        'width: 620px', 'padding: 34px', 'background: #ffffff',
        'box-sizing: border-box',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'color: #14172b'
    ].join(';');
    wrapper.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:20px; padding-bottom:16px; border-bottom:3px solid #4361ee;">
            <div style="font-size:24px; font-weight:800;">📊 Proje Raporu</div>
            <div style="font-size:13px; font-weight:600; color:#4361ee; background:#e3e9fb; padding:8px 13px; border-radius:10px; white-space:nowrap;">${dateLabel}</div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
            <span style="font-size:15px; font-weight:700; background:#eef2ff; color:#3a47c7; padding:8px 14px; border-radius:10px;">🏃 ${escapeHtml(data.sprint.name)}</span>
            <span style="font-size:15px; font-weight:700; background:#e8f7ee; color:#1f7a34; padding:8px 14px; border-radius:10px;">✅ Tamamlanan: ${stats.completed} (%${stats.completionRate})</span>
            <span style="font-size:15px; font-weight:700; background:#fdf0e6; color:#b26a00; padding:8px 14px; border-radius:10px;">⏳ Kalan: ${stats.remaining}</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px;">
            <span style="font-size:15px; font-weight:700; background:#eef2ff; color:#3a47c7; padding:8px 14px; border-radius:10px;">📊 Alınan Madde: ${stats.total}</span>
            <span style="font-size:15px; font-weight:700; background:#f3eefe; color:#6b28c7; padding:8px 14px; border-radius:10px;">📁 Proje: ${projects.length}</span>
        </div>
        <div style="height:12px; background:#eef1f7; border-radius:7px; margin-bottom:20px; overflow:hidden;">
            <div style="height:100%; width:${Math.max(0, Math.min(100, stats.completionRate))}%; background:#2d9600; border-radius:7px;"></div>
        </div>
        <div id="prShotPieWrap" style="display:flex; justify-content:center; margin-bottom:20px;"></div>
        <div>${renderProjectCaptureRows(projects)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:14px; border-top:2px solid #4361ee;">
            <span style="font-size:18px; font-weight:800;">TOPLAM</span>
            <span style="font-size:18px; font-weight:800; color:#4361ee;">${stats.total} task · ✅ ${stats.completed} (%${stats.completionRate})</span>
        </div>
    `;
    document.body.appendChild(wrapper);
    return wrapper;
}

async function appendProjectCaptureChart(projects) {
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = 360;
    const chart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels: projects.map(project => `${project.name} (${project.key})`),
            datasets: [{
                data: projects.map(project => project.count),
                backgroundColor: projects.map((project, index) => projectReportColor(index)),
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: false,
            animation: false,
            plugins: { legend: { position: 'right', labels: { color: '#14172b', font: { size: 13 }, boxWidth: 14 } } }
        }
    });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = new Image();
    image.src = canvas.toDataURL('image/png');
    image.style.cssText = 'width:520px; height:360px;';
    document.getElementById('prShotPieWrap').appendChild(image);
    chart.destroy();
}

async function captureProjectReport() {
    const data = lastProjectReportData;
    if (!data || !data.sprint || !(data.projects || []).length) {
        alert('Önce bir sprint seçip raporu yükleyin.');
        return;
    }
    if (typeof html2canvas === 'undefined' || typeof Chart === 'undefined') {
        alert('Ekran görüntüsü araçları henüz yüklenmedi. Birkaç saniye sonra tekrar deneyin.');
        return;
    }
    const btn = document.getElementById('projectReportShotBtn');
    const oldText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Hazırlanıyor...'; }

    const now = new Date();
    const wrapper = createProjectCaptureWrapper(data, now);
    try {
        await appendProjectCaptureChart(data.projects);
        await new Promise(resolve => setTimeout(resolve, 60));
        const canvas = await html2canvas(wrapper, {
            scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false
        });
        downloadCapture(canvas, 'proje-raporu', now);
    } catch (err) {
        alert('Ekran görüntüsü alınamadı: ' + err.message);
    } finally {
        wrapper.remove();
        if (btn) { btn.disabled = false; btn.textContent = oldText; }
    }
}

// ============== Task Oluşturma Fonksiyonları ==============
let createdTasks = [];
let taskFormDataLoaded = false;
let allSprints = [];
let allUsers = [];
