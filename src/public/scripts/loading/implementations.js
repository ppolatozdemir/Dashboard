(function () {
    function initializeLoadingUi() {
        const loader = window.dashboardLoader;
        loader.upgradeLoadingElements();

        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    loader.upgradeLoadingElements(node.matches('.loading') ? node.parentElement : node);
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const pendingTenant = sessionStorage.getItem(
            window.dashboardLoadingConstants.tenantTransitionTargetKey
        );
        if (pendingTenant) loader.resumeTenantTransition(pendingTenant);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeLoadingUi, { once: true });
    } else {
        initializeLoadingUi();
    }
})();
