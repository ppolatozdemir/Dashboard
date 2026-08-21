const TENANT_NAMES = Object.freeze({
    OLKA: 'Olka',
    MCC: 'Madame Coco',
    SCH: 'SoChic',
    A101: 'A-101',
    GRC: 'Grace Brands',
    MRDIY: 'Mr. DIY',
    DEC: 'Decathlon',
    HD: 'HD',
    CL: 'CommerceLAB'
});

let tenantBoardProjects = [];

async function loadTenantBoardProjects() {
    const select = document.getElementById('tenantBoardProjectSelect');
    const title = document.getElementById('tenantBoardTitle');
    const tenant = window.dashboardCurrentUser?.tenant || '';
    if (title) title.textContent = `🗂️ ${TENANT_NAMES[tenant] || tenant || 'Tenant'} Panosu`;
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json().catch(() => []);
        if (!response.ok) throw new Error(projects.error || 'Projeler alınamadı');
        tenantBoardProjects = Array.isArray(projects) ? projects : [];
        select.innerHTML = tenantBoardProjects.length
            ? tenantBoardProjects.map(project =>
                `<option value="${escapeHtml(project.key)}">${escapeHtml(project.name)} (${escapeHtml(project.key)})</option>`
            ).join('')
            : '<option value="">Bu tenant için proje tanımlı değil</option>';
        select.disabled = tenantBoardProjects.length === 0;
        return tenantBoardProjects[0]?.key || null;
    } catch (error) {
        select.innerHTML = '<option value="">Projeler alınamadı</option>';
        select.disabled = true;
        throw error;
    }
}

async function onTenantBoardProjectChange() {
    await loadMcBoardReport();
}

async function loadMcBoardReport() {
    const el = document.getElementById('mcBoardContent');
    const bar = document.getElementById('mcBoardInfoBar');
    const select = document.getElementById('tenantBoardProjectSelect');
    bar.innerHTML = '';
    el.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>MC panosu yükleniyor…</span>
        </div>
    `;
    try {
        const projectKey = select?.value || await loadTenantBoardProjects();
        if (!projectKey) {
            el.innerHTML = '<div class="mc-empty">Bu tenant için proje tanımlı değil.</div>';
            return;
        }
        const res = await fetch(`/api/mc-board/report?projectKey=${encodeURIComponent(projectKey)}`);
        if (!res.ok) throw new Error((await res.json()).error || 'Pano alınamadı');
        const data = await res.json();
        lastMcBoardData = data;
        renderMcBoardInfo();
        renderMcBoard();
    } catch (error) {
        bar.innerHTML = '';
        el.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderMcBoardInfo() {
    const data = lastMcBoardData;
    const bar = document.getElementById('mcBoardInfoBar');
    if (!data) { bar.innerHTML = ''; return; }
    const colCount = data.columns ? data.columns.length : 0;
    bar.innerHTML = `
        <span style="background: rgba(67,97,238,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🗂️ Toplam Madde: <strong>${data.totalTrue}</strong></span>
        <span style="background: rgba(56,176,0,0.28); padding: 5px 12px; border-radius: 6px; font-size: 13px;">📊 Sütun: <strong>${colCount}</strong></span>
        <span style="background: rgba(251,133,0,0.3); padding: 5px 12px; border-radius: 6px; font-size: 13px;">🏃 Aktif (Tamamlanmamış): <strong>${data.activeCount}</strong></span>
        <span style="background: rgba(255,255,255,0.08); padding: 5px 12px; border-radius: 6px; font-size: 13px;">📌 Board: <strong>${escapeHtml(data.boardName || ('#' + data.boardId))}</strong></span>
    `;
    const lbl = document.getElementById('mcBoardRecentLabel');
    if (lbl && data.recentDays) lbl.textContent = 'son ' + data.recentDays + ' gün';
}

function renderMcBoard() {
    const el = document.getElementById('mcBoardContent');
    const data = lastMcBoardData;
    if (!data || !data.columns || !data.columns.length) {
        el.innerHTML = '<div class="mc-empty">Gösterilecek madde bulunamadı.</div>';
        return;
    }
    let html = '<div class="mc-board">';
    data.columns.forEach(col => {
        const color = mcCategoryColor(col.category);
        const titleAttr = (col.statusNames && col.statusNames.length)
            ? escapeHtml(col.statusNames.join(', '))
            : escapeHtml(col.name);
        html += `<div class="mc-col" style="--mc-cat: ${color};">`;
        html += `
            <div class="mc-col-header">
                <span class="mc-col-title" title="${titleAttr}">${escapeHtml(col.name)}</span>
                <span class="mc-col-count">${col.count}</span>
            </div>
            <div class="mc-col-body">
        `;
        if (!col.cards || col.cards.length === 0) {
            html += '<div class="mc-col-empty">—</div>';
        } else {
            col.cards.forEach(c => { html += mcCardHtml(c, color); });
            if (col.count > col.shownCount) {
                html += `<div class="mc-col-more">+${col.count - col.shownCount} daha…</div>`;
            }
        }
        html += '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
}

function mcCardHtml(c, color) {
    const url = `https://hebiar.atlassian.net/browse/${encodeURIComponent(c.key)}`;
    const type = `<span class="mc-type" title="${escapeHtml(c.issueType || '')}">${mcTypeIcon(c.issueType)}</span>`;
    const prio = c.priority
        ? `<span class="mc-prio" title="${escapeHtml(c.priority)}">${mcPriorityIcon(c.priority)}</span>`
        : '';
    const avatar = c.assignee
        ? `<span class="mc-avatar" style="background: ${mcAvatarColor(c.assignee)};" title="${escapeHtml(c.assignee)}">${escapeHtml(mcInitials(c.assignee))}</span>`
        : `<span class="mc-avatar unassigned" title="Atanmamış">–</span>`;
    return `
        <div class="mc-card" style="--mc-cat: ${color};" onclick="window.open('${url}','_blank')" title="${escapeHtml(c.statusName)}">
            <div class="mc-card-summary">${escapeHtml(c.summary)}</div>
            <div class="mc-card-meta">
                <span class="mc-card-left">${type}<a class="mc-key" href="${url}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(c.key)}</a></span>
                <span class="mc-card-right">${prio}${avatar}</span>
            </div>
        </div>
    `;
}

function mcCategoryColor(cat) {
    switch (cat) {
        case 'new': return '#8a94a6';
        case 'indeterminate': return 'var(--accent-blue)';
        case 'done': return 'var(--accent-green)';
        default: return 'var(--text-muted)';
    }
}

function mcInitials(name) {
    if (!name) return '–';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '–';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MC_AVATAR_PALETTE = ['#4361ee', '#38b000', '#fb8500', '#9d4edd', '#e63946', '#f72585', '#4cc9f0', '#2a9d8f', '#e76f51', '#457b9d'];
function mcAvatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return MC_AVATAR_PALETTE[h % MC_AVATAR_PALETTE.length];
}

function mcTypeIcon(name) {
    const n = (name || '').toLowerCase();
    if (/bug|hata/.test(n)) return '🐞';
    if (/story|hikaye/.test(n)) return '📗';
    if (/epic|epik/.test(n)) return '🟪';
    if (/sub.?task|alt ?g[öo]rev/.test(n)) return '↳';
    return '☑️';
}

function mcPriorityIcon(name) {
    const n = (name || '').toLowerCase();
    if (/highest|en y|kritik|critic|blocker/.test(n)) return '🔴';
    if (/high|y[üu]ksek/.test(n)) return '🟠';
    if (/medium|orta|normal/.test(n)) return '🟡';
    if (/lowest|en d/.test(n)) return '🔵';
    if (/low|d[üu][şs][üu]k/.test(n)) return '🟢';
    return '⚪';
}

// ========== Sprint Raporu ==========
let olkaSprintLoaded = false;
let lastOlkaSprintData = null;

// Seçili (ya da en son kapanan) sprintin raporunu yükle
