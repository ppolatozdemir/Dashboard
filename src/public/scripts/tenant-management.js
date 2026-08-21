let tenantManagementData = null;

function tenantManagementEscape(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function tenantManagementSelectedKeys() {
    const tenant = document.getElementById('tenantManagementSelect').value;
    const visibleKeys = new Set(
        [...document.querySelectorAll('[data-tenant-project]')].map(input => input.value)
    );
    const preservedKeys = (tenantManagementData?.projects || [])
        .filter(project => project.tenant === tenant && !visibleKeys.has(project.key))
        .map(project => project.key);
    return [
        ...new Set([
            ...preservedKeys,
            ...[...document.querySelectorAll('[data-tenant-project]:checked')].map(input => input.value)
        ])
    ];
}

async function loadTenantManagement() {
    const container = document.getElementById('tenantManagementContent');
    container.innerHTML = '<div class="loading" style="height: 120px;"><span>Tenant projeleri yükleniyor...</span></div>';
    try {
        const response = await fetch('/api/tenant-projects');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Tenant projeleri alınamadı');
        tenantManagementData = data;
        const select = document.getElementById('tenantManagementSelect');
        const selected = select.value;
        select.innerHTML = data.tenants
            .map(tenant => `<option value="${tenantManagementEscape(tenant)}">${tenantManagementEscape(tenant)}</option>`)
            .join('');
        if (data.tenants.includes(selected)) select.value = selected;
        renderTenantManagementProjects();
    } catch (error) {
        container.innerHTML = `<div class="error-message">${tenantManagementEscape(error.message)}</div>`;
    }
}

function renderTenantManagementProjects() {
    const container = document.getElementById('tenantManagementContent');
    const tenant = document.getElementById('tenantManagementSelect').value;
    const query = document.getElementById('tenantManagementSearch').value.trim().toLocaleLowerCase('tr-TR');
    const projects = (tenantManagementData?.projects || [])
        .filter(project => !query || `${project.name} ${project.key}`.toLocaleLowerCase('tr-TR').includes(query))
        .sort((left, right) => left.name.localeCompare(right.name, 'tr'));
    if (!projects.length) {
        container.innerHTML = '<div class="rfr-empty">Aramanızla eşleşen Jira projesi bulunamadı.</div>';
        return;
    }
    container.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:10px;">
            ${projects.map(project => {
                const checked = project.tenant === tenant ? ' checked' : '';
                const assignment = project.tenant && project.tenant !== tenant
                    ? ` <span style="color:var(--text-muted);">(${tenantManagementEscape(project.tenant)})</span>`
                    : '';
                return `<label style="display:flex; gap:10px; align-items:center; padding:10px; border:1px solid var(--border-color); border-radius:8px;">
                    <input type="checkbox" data-tenant-project value="${tenantManagementEscape(project.key)}"${checked}>
                    <span><strong>${tenantManagementEscape(project.name)}</strong> <code>${tenantManagementEscape(project.key)}</code>${assignment}</span>
                </label>`;
            }).join('')}
        </div>`;
}

async function saveTenantManagement() {
    const tenant = document.getElementById('tenantManagementSelect').value;
    const projects = tenantManagementSelectedKeys();
    const response = await fetch(`/api/tenant-projects/${encodeURIComponent(tenant)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        window.alert(data.error || 'Tenant proje eşlemesi kaydedilemedi.');
        return;
    }
    await loadTenantManagement();
}
