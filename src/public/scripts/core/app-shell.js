let currentReport = null;
let charts = {};

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'dark';
    setTheme(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('dashboard-theme', newTheme);
    
    // Update charts if they exist
    if (Object.keys(charts).length > 0) {
        updateChartTheme();
    }
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    
    if (theme === 'dark') {
        icon.textContent = '🌙';
        text.textContent = 'Dark';
    } else {
        icon.textContent = '☀️';
        text.textContent = 'Light';
    }
}

function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        textColor: isDark ? '#fff' : '#1a1a2e',
        gridColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
        tickColor: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)'
    };
}

function updateChartTheme() {
    const colors = getChartColors();
    
    Object.values(charts).forEach(chart => {
        if (chart.options.plugins && chart.options.plugins.legend) {
            chart.options.plugins.legend.labels.color = colors.textColor;
        }
        if (chart.options.scales) {
            if (chart.options.scales.x) {
                chart.options.scales.x.ticks.color = colors.tickColor;
                chart.options.scales.x.grid.color = colors.gridColor;
            }
            if (chart.options.scales.y) {
                chart.options.scales.y.ticks.color = colors.tickColor;
                chart.options.scales.y.grid.color = colors.gridColor;
            }
        }
        chart.update();
    });
}

// Initialize theme on page load
initTheme();

const DASHBOARD_TABS = [
    'daily', 'closed', 'unsprinted', 'olkaDeploy', 'rfr', 'reject',
    'hdvStatus', 'olkaSprint', 'olkaRoadmap', 'labelSync', 'mcBoard',
    'project', 'createTask', 'tenantManagement'
];

function updateActiveTab(tab) {
    DASHBOARD_TABS.forEach(name => {
        const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
        document.getElementById(`tab${pascalName}`)?.classList.toggle('active', name === tab);
        document.getElementById(`${name}TabContent`)?.classList.toggle('active', name === tab);
    });
}

function loadTabOnce(tab, state) {
    if (tab !== state.name || state.isLoaded()) return;
    state.markLoaded();
    state.load();
}

function loadTabContent(tab) {
    if (tab === 'closed') loadClosedReport();
    if (tab === 'createTask') loadTaskFormData();
    if (tab === 'tenantManagement') loadTenantManagement();
    if (tab === 'unsprinted' && !unsprintedLoaded) {
        unsprintedLoaded = true;
        loadUnsprintedSprints();
    }

    [
        { name: 'olkaDeploy', isLoaded: () => olkaDeployLoaded, markLoaded: () => { olkaDeployLoaded = true; }, load: loadOlkaDeployReport },
        { name: 'rfr', isLoaded: () => rfrLoaded, markLoaded: () => { rfrLoaded = true; }, load: loadRfrReport },
        { name: 'reject', isLoaded: () => rejectLoaded, markLoaded: () => { rejectLoaded = true; }, load: loadRejectReport },
        { name: 'hdvStatus', isLoaded: () => hdvStatusLoaded, markLoaded: () => { hdvStatusLoaded = true; }, load: loadHdvStatusReport },
        { name: 'olkaSprint', isLoaded: () => olkaSprintLoaded, markLoaded: () => { olkaSprintLoaded = true; }, load: loadOlkaSprintReport },
        { name: 'mcBoard', isLoaded: () => mcBoardLoaded, markLoaded: () => { mcBoardLoaded = true; }, load: loadMcBoardReport },
        { name: 'project', isLoaded: () => projectReportLoaded, markLoaded: () => { projectReportLoaded = true; }, load: loadProjectReport },
        { name: 'olkaRoadmap', isLoaded: () => olkaRoadmapLoaded, markLoaded: () => { olkaRoadmapLoaded = true; }, load: loadOlkaRoadmapReport }
    ].forEach(state => loadTabOnce(tab, state));
}

function switchTab(tab) {
    updateActiveTab(tab);
    loadTabContent(tab);
}

// Sayfa yüklendiğinde günlük raporu yükle
document.addEventListener('DOMContentLoaded', async () => {
    const authenticated = await window.authReady;
    if (!authenticated) return;

    const initialTab = window.dashboardAllowedTabs?.[0];
    if (!initialTab) return;
    updateActiveTab(initialTab);

    // Günlük kapanan raporu için tarih ayarla
    document.getElementById('closedReportDate').value = new Date().toISOString().split('T')[0];
    if (initialTab === 'daily') {
        await loadDailyReport();
    } else {
        loadTabContent(initialTab);
    }
});

// Rapor ekran görüntüsü alma (yüksek çözünürlüklü - WhatsApp paylaşımı için)
