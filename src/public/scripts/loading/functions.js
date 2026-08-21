(function () {
    const constants = window.dashboardLoadingConstants;
    let activeTenant = null;

    function normalizeTenant(tenant) {
        return String(tenant || '').trim().toUpperCase();
    }

    function emblemFor(tenant) {
        return constants.tenantEmblems[normalizeTenant(tenant)] || constants.tenantEmblems.CL;
    }

    function spinnerMarkup(tenant, size = 'content') {
        const normalizedTenant = normalizeTenant(tenant);
        const emblem = emblemFor(normalizedTenant);
        return `
            <span class="tenant-loader tenant-loader--${size}"
                  data-loader-tenant="${normalizedTenant}" aria-hidden="true">
                <img class="tenant-loader-emblem" src="${emblem}" alt="" aria-hidden="true">
            </span>
        `;
    }

    function setActiveTenant(tenant) {
        activeTenant = normalizeTenant(tenant);
        document.documentElement.dataset.activeTenant = activeTenant;
    }

    function currentTenant() {
        return activeTenant ||
            normalizeTenant(document.documentElement.dataset.activeTenant) ||
            normalizeTenant(sessionStorage.getItem(constants.tenantTransitionTargetKey)) ||
            'CL';
    }

    function upgradeLoadingElements(root = document) {
        root.querySelectorAll('.loading').forEach(element => {
            const tenant = currentTenant();
            const existingLoader = element.querySelector('.tenant-loader');
            if (existingLoader?.dataset.loaderTenant === tenant) return;
            element.innerHTML = spinnerMarkup(tenant);
        });
    }

    function ensureTransitionOverlay() {
        let overlay = document.getElementById('tenantTransitionOverlay');
        if (overlay) return overlay;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="tenant-transition-overlay" id="tenantTransitionOverlay" hidden
                 role="status" aria-live="polite" aria-label="Tenant yükleniyor">
                <div class="tenant-transition-card">
                    <div id="tenantTransitionSpinner"></div>
                </div>
            </div>
        `);
        overlay = document.getElementById('tenantTransitionOverlay');
        return overlay;
    }

    function renderTransitionSpinner(tenant) {
        const container = document.getElementById('tenantTransitionSpinner');
        container.innerHTML = spinnerMarkup(tenant, 'transition');
    }

    function showTenantTransition(tenant) {
        const normalizedTenant = normalizeTenant(tenant);
        setActiveTenant(normalizedTenant);
        const overlay = ensureTransitionOverlay();
        renderTransitionSpinner(normalizedTenant);
        overlay.hidden = false;
    }

    async function startTenantTransition(tenant) {
        const normalizedTenant = normalizeTenant(tenant);
        const startedAt = Date.now();
        sessionStorage.setItem(constants.tenantTransitionStartedAtKey, String(startedAt));
        sessionStorage.setItem(constants.tenantTransitionTargetKey, normalizedTenant);
        showTenantTransition(normalizedTenant);
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        return startedAt;
    }

    function resumeTenantTransition(tenant) {
        const pendingTenant = sessionStorage.getItem(constants.tenantTransitionTargetKey);
        if (!pendingTenant) return false;
        showTenantTransition(pendingTenant || tenant);
        return true;
    }

    async function finishTenantTransition(tenant) {
        const startedAt = Number(sessionStorage.getItem(constants.tenantTransitionStartedAtKey));
        if (!Number.isFinite(startedAt)) return;
        const targetTenant = normalizeTenant(
            sessionStorage.getItem(constants.tenantTransitionTargetKey) || tenant
        );
        const overlay = ensureTransitionOverlay();
        renderTransitionSpinner(targetTenant);
        overlay.hidden = false;
        const remaining = Math.max(
            0,
            constants.tenantTransitionMinimumMs - (Date.now() - startedAt)
        );
        await new Promise(resolve => window.setTimeout(resolve, remaining));
        overlay.hidden = true;
        sessionStorage.removeItem(constants.tenantTransitionStartedAtKey);
        sessionStorage.removeItem(constants.tenantTransitionTargetKey);
    }

    function cancelTenantTransition() {
        document.getElementById('tenantTransitionOverlay')?.setAttribute('hidden', '');
        sessionStorage.removeItem(constants.tenantTransitionStartedAtKey);
        sessionStorage.removeItem(constants.tenantTransitionTargetKey);
    }

    window.dashboardLoader = Object.freeze({
        setActiveTenant,
        currentTenant,
        upgradeLoadingElements,
        startTenantTransition,
        resumeTenantTransition,
        finishTenantTransition,
        cancelTenantTransition
    });
})();
