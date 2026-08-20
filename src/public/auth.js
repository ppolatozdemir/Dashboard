(function () {
    const nativeFetch = window.fetch.bind(window);
    let resolveAuth;
    let loginState = null;
    let currentUser = null;
    const tenantNames = Object.freeze({
        MCC: 'Madame Coco',
        SCH: 'SoChic',
        A101: 'A-101',
        GRC: 'Grace Brands',
        MRDIY: 'Mr. DIY',
        DEC: 'Decathlon',
        CL: 'CommerceLAB',
        HD: 'HD',
        OLKA: 'Olka'
    });
    const olkaTenants = new Set(['OLKA', 'SKC', 'SKCP', 'ASC', 'BRR', 'HFV', 'HTR', 'KLD']);
    const hideLoginOverlayDuringTenantSwitch =
        sessionStorage.getItem('dashboard-tenant-switch') === 'true';

    sessionStorage.removeItem('dashboard-tenant-switch');

    window.authReady = new Promise(resolve => {
        resolveAuth = resolve;
    });

    window.fetch = async function (...args) {
        const response = await nativeFetch(...args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (response.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
            showLogin('Oturum sona erdi, tekrar giriş yapın.');
        }
        return response;
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function tenantName(tenant) {
        return tenantNames[tenant] || tenant;
    }

    function injectAuthUi() {
        document.body.insertAdjacentHTML('afterbegin', `
            <div class="auth-overlay" id="authOverlay"${hideLoginOverlayDuringTenantSwitch ? ' hidden' : ''}>
                <div class="auth-card">
                    <h1>Jira Support Dashboard</h1>
                    <p>Devam etmek için giriş yapın.</p>
                    <div class="auth-methods">
                        <button class="auth-method active" type="button" data-auth-method="company">CommerceLab ile giriş</button>
                        <button class="auth-method" type="button" data-auth-method="local">Kullanıcı girişi</button>
                    </div>
                    <form class="auth-form active" id="companyLoginForm">
                        <div class="auth-field">
                            <label for="companyUsername">Kullanıcı adı</label>
                            <input id="companyUsername" autocomplete="username" required>
                        </div>
                        <div class="auth-field">
                            <label for="companyPassword">Şifre</label>
                            <input id="companyPassword" type="password" autocomplete="current-password" required>
                        </div>
                        <div class="auth-field" id="companyTenantField" hidden>
                            <label for="companyTenant">Tenant</label>
                            <select id="companyTenant"></select>
                        </div>
                        <button class="auth-submit" type="submit">Giriş yap</button>
                    </form>
                    <form class="auth-form" id="localLoginForm">
                        <div class="auth-field">
                            <label for="localUsername">Kullanıcı adı</label>
                            <input id="localUsername" autocomplete="username" required>
                        </div>
                        <div class="auth-field">
                            <label for="localPassword">Şifre</label>
                            <input id="localPassword" type="password" autocomplete="current-password" required>
                        </div>
                        <div class="auth-field" id="localTenantField" hidden>
                            <label for="localTenant">Tenant</label>
                            <select id="localTenant"></select>
                        </div>
                        <button class="auth-submit" type="submit">Giriş yap</button>
                    </form>
                    <div class="auth-error" id="authError"></div>
                </div>
            </div>
        `);

        document.querySelectorAll('[data-auth-method]').forEach(button => {
            button.addEventListener('click', () => setAuthMethod(button.dataset.authMethod));
        });
        document.getElementById('companyLoginForm').addEventListener('submit', event => {
            submitLogin(event, 'company');
        });
        document.getElementById('localLoginForm').addEventListener('submit', event => {
            submitLogin(event, 'local');
        });
    }

    function setAuthMethod(method) {
        loginState = null;
        document.getElementById('authError').textContent = '';
        document.querySelectorAll('[data-auth-method]').forEach(button => {
            button.classList.toggle('active', button.dataset.authMethod === method);
        });
        document.getElementById('companyLoginForm').classList.toggle('active', method === 'company');
        document.getElementById('localLoginForm').classList.toggle('active', method === 'local');
        document.getElementById('companyTenantField').hidden = true;
        document.getElementById('localTenantField').hidden = true;
    }

    async function submitLogin(event, method) {
        event.preventDefault();
        const error = document.getElementById('authError');
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const prefix = method === 'company' ? 'company' : 'local';
        const username = document.getElementById(`${prefix}Username`).value.trim();
        const password = document.getElementById(`${prefix}Password`).value;
        const tenantField = document.getElementById(`${prefix}TenantField`);
        const tenant = tenantField.hidden
            ? undefined
            : document.getElementById(`${prefix}Tenant`).value;

        error.textContent = '';
        button.disabled = true;
        button.textContent = 'Giriş yapılıyor...';
        loginState = { method, username, password };

        try {
            const endpoint = method === 'company'
                ? '/api/auth/commercelab/login'
                : '/api/auth/local/login';
            const response = await nativeFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, tenant })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Giriş yapılamadı.');

            if (data.requiresTenant) {
                if (method === 'company') {
                    sessionStorage.setItem(
                        'company-auth-tenants',
                        JSON.stringify(data.tenants)
                    );
                }
                const select = document.getElementById(`${prefix}Tenant`);
                select.innerHTML = data.tenants
                    .map(item => `<option value="${escapeHtml(item)}">${escapeHtml(tenantName(item))}</option>`)
                    .join('');
                tenantField.hidden = false;
                button.textContent = 'Tenant ile giriş yap';
                return;
            }

            loginState = null;
            window.location.reload();
        } catch (loginError) {
            error.textContent = loginError.message;
        } finally {
            button.disabled = false;
            if (!document.getElementById(`${prefix}TenantField`).hidden) {
                button.textContent = 'Tenant ile giriş yap';
            } else {
                button.textContent = 'Giriş yap';
            }
        }
    }

    function showLogin(message = '') {
        document.getElementById('authOverlay').hidden = false;
        document.getElementById('authError').textContent = message;
    }

    function renderAuthenticatedUi(user) {
        currentUser = user;
        document.getElementById('authOverlay').hidden = true;
        const controls = document.querySelector('.header-controls');
        controls.insertAdjacentHTML('afterbegin', `
            <div class="auth-user">
                <div>
                    <strong>${escapeHtml(user.displayName)}</strong>
                    <div class="auth-user-meta">${escapeHtml(user.role)}${user.tenant ? ` · ${escapeHtml(tenantName(user.tenant))}` : ''}</div>
                </div>
                ${renderTenantSwitch(user)}
                <button class="auth-logout" id="authLogout" type="button">Çıkış</button>
            </div>
        `);
        document.getElementById('authLogout').addEventListener('click', logout);
        document.getElementById('authTenantSwitch')?.addEventListener('change', switchTenant);
        if (user.tenant !== 'CL' && user.tenant !== 'MCC') {
            hideTab('tabMcBoard', 'mcBoardTabContent');
        }
        if (user.tenant !== 'CL' && user.tenant !== 'HD' && user.tenant !== 'HDV') {
            hideTab('tabHdvStatus', 'hdvStatusTabContent');
        }
        if (user.tenant !== 'CL' && !olkaTenants.has(user.tenant)) {
            hideTab('tabUnsprinted', 'unsprintedTabContent');
            hideTab('tabOlkaDeploy', 'olkaDeployTabContent');
            hideTab('tabOlkaSprint', 'olkaSprintTabContent');
            hideTab('tabOlkaRoadmap', 'olkaRoadmapTabContent');
            hideTab('tabLabelSync', 'labelSyncTabContent');
        }
        if (user.role === 'OwnerAdmin' || user.role === 'TenantAdmin') {
            injectUserManagement();
        }
    }

    function renderTenantSwitch(user) {
        if (user.role !== 'OwnerAdmin' || !user.allowedTenants?.length) return '';
        return `
            <label class="auth-tenant-switch">
                <span>Tenant</span>
                <select id="authTenantSwitch">
                    ${user.allowedTenants.map(tenant => `
                        <option value="${escapeHtml(tenant)}"${tenant === user.tenant ? ' selected' : ''}>
                            ${escapeHtml(tenantName(tenant))}
                        </option>
                    `).join('')}
                </select>
            </label>
        `;
    }

    async function switchTenant(event) {
        const select = event.currentTarget;
        select.disabled = true;
        try {
            const response = await nativeFetch('/api/auth/tenant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant: select.value })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Tenant değiştirilemedi.');
            sessionStorage.setItem('dashboard-tenant-switch', 'true');
            window.location.reload();
        } catch (error) {
            select.value = currentUser.tenant;
            select.disabled = false;
            window.alert(error.message);
        }
    }

    function hideTab(tabId, contentId) {
        document.getElementById(tabId)?.setAttribute('hidden', '');
        document.getElementById(contentId)?.setAttribute('hidden', '');
    }

    async function logout() {
        await nativeFetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
    }

    function renderTenantFormField(canChooseTenant) {
        if (!canChooseTenant) return '';
        const tenantOptions = getCompanyTenantOptions();
        return `
            <div class="auth-field full">
                <label for="authUserTenant">Tenant</label>
                <select id="authUserTenant" required>
                    ${tenantOptions.map(tenant =>
                        `<option value="${escapeHtml(tenant)}">${escapeHtml(tenantName(tenant))}</option>`
                    ).join('')}
                </select>
            </div>
        `;
    }

    function renderUserManagementContent(canChooseTenant) {
        const tenantFormField = renderTenantFormField(canChooseTenant);
        return `
            <div class="tab-content" id="userManagementTabContent">
                <div class="daily-report-panel">
                    <div class="daily-report-header">
                        <h2>👥 Tenant Kullanıcıları</h2>
                        <button class="refresh-btn" id="refreshAuthUsers" type="button">🔄 Yenile</button>
                    </div>
                    <form class="user-form" id="createAuthUserForm">
                        <div class="auth-field"><label for="authDisplayName">Ad soyad</label><input id="authDisplayName" required></div>
                        <div class="auth-field"><label for="authUsername">Kullanıcı adı</label><input id="authUsername" autocomplete="off" required></div>
                        <div class="auth-field">
                            <label for="authUserPassword">Geçici şifre (en az 10 karakter)</label>
                            <input id="authUserPassword" type="password" minlength="10" autocomplete="new-password" required>
                        </div>
                        <div class="auth-field">
                            <label for="authUserRole">Rol</label>
                            <select id="authUserRole" required>
                                <option value="TenantAdmin">TenantAdmin</option>
                            </select>
                        </div>
                        ${tenantFormField}
                        <div class="full">
                            <button class="refresh-btn" type="submit">Kullanıcı oluştur</button>
                            <span id="authUserMessage" style="margin-left: 12px;"></span>
                        </div>
                    </form>
                    <div id="authUsersContent"></div>
                </div>
            </div>
        `;
    }

    function bindUserManagementEvents() {
        document.getElementById('tabUserManagement').addEventListener('click', () => {
            document.querySelectorAll('.tab-btn, .tab-content').forEach(item => item.classList.remove('active'));
            document.getElementById('tabUserManagement').classList.add('active');
            document.getElementById('userManagementTabContent').classList.add('active');
            loadUsers();
        });
        document.getElementById('refreshAuthUsers').addEventListener('click', loadUsers);
        document.getElementById('createAuthUserForm').addEventListener('submit', createUser);
    }

    function injectUserManagement() {
        const canChooseTenant = currentUser.tenant === 'CL';
        const tenantColumn = canChooseTenant
            ? '<th>Tenant</th>'
            : '';
        document.querySelector('.tab-bar').insertAdjacentHTML('beforeend', `
            <button class="tab-btn" id="tabUserManagement" type="button">👥 Kullanıcılar</button>
        `);
        document.querySelector('.tab-bar').insertAdjacentHTML(
            'afterend',
            renderUserManagementContent(canChooseTenant)
        );

        const originalSwitchTab = window.switchTab;
        window.switchTab = function (tab) {
            document.getElementById('tabUserManagement')?.classList.remove('active');
            document.getElementById('userManagementTabContent')?.classList.remove('active');
            return originalSwitchTab(tab);
        };
        bindUserManagementEvents();
        window.authUserListOptions = {
            showTenant: canChooseTenant,
            tenantColumn,
            canDelete: currentUser.role === 'OwnerAdmin',
        };
    }

    function getCompanyTenantOptions() {
        let tenants = currentUser.allowedTenants || [];
        try {
            tenants = [
                ...tenants,
                ...JSON.parse(sessionStorage.getItem('company-auth-tenants') || '[]')
            ];
        } catch {
            // The authenticated server response remains the trusted source.
        }
        if (currentUser.tenant) tenants.push(currentUser.tenant);
        return [...new Set(tenants.filter(tenant => tenant && tenant !== 'CL'))].sort();
    }

    async function loadUsers() {
        const container = document.getElementById('authUsersContent');
        container.innerHTML = '<div class="loading">Kullanıcılar yükleniyor...</div>';
        try {
            const response = await nativeFetch('/api/auth/users');
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Kullanıcılar alınamadı.');
            const showTenant = window.authUserListOptions?.showTenant;
            const canDelete = window.authUserListOptions?.canDelete;
            const actionColumn = canDelete ? '<th></th>' : '';
            const emptyColspan = (showTenant ? 3 : 2) + (canDelete ? 1 : 0);
            container.innerHTML = `
                <table class="user-table">
                    <thead><tr><th>Kullanıcı</th><th>Rol</th>${showTenant ? '<th>Tenant</th>' : ''}${actionColumn}</tr></thead>
                    <tbody>
                        ${data.users.map(user => `
                            <tr>
                                <td><strong>${escapeHtml(user.displayName)}</strong><br><span class="auth-user-meta">${escapeHtml(user.username)}</span></td>
                                <td>${escapeHtml(user.role)}</td>
                                ${showTenant ? `<td>${user.tenants.map(tenant => escapeHtml(tenantName(tenant))).join(', ')}</td>` : ''}
                                ${canDelete ? `<td><button class="user-delete" type="button" data-user-id="${escapeHtml(user.id)}">Sil</button></td>` : ''}
                            </tr>
                        `).join('') || `<tr><td colspan="${emptyColspan}">Kullanıcı bulunmuyor.</td></tr>`}
                    </tbody>
                </table>
            `;
            container.querySelectorAll('[data-user-id]').forEach(button => {
                button.addEventListener('click', () => deleteUser(button.dataset.userId));
            });
        } catch (error) {
            container.innerHTML = `<div class="error-message">${escapeHtml(error.message)}</div>`;
        }
    }

    async function createUser(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('authUserMessage');
        const tenant = document.getElementById('authUserTenant')?.value || currentUser.tenant;
        const body = {
            displayName: document.getElementById('authDisplayName').value.trim(),
            username: document.getElementById('authUsername').value.trim(),
            password: document.getElementById('authUserPassword').value,
            role: document.getElementById('authUserRole').value,
            tenants: [tenant]
        };
        message.textContent = '';
        try {
            const response = await nativeFetch('/api/auth/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Kullanıcı oluşturulamadı.');
            message.textContent = 'Kullanıcı oluşturuldu.';
            form.reset();
            await loadUsers();
        } catch (error) {
            message.textContent = error.message;
        }
    }

    async function deleteUser(userId) {
        if (!window.confirm('Bu kullanıcı kaydını silmek istediğinizden emin misiniz?')) return;
        const response = await nativeFetch(`/api/auth/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            window.alert(data.error || 'Kullanıcı silinemedi.');
            return;
        }
        await loadUsers();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        injectAuthUi();
        try {
            const response = await nativeFetch('/api/auth/me');
            if (!response.ok) {
                showLogin();
                resolveAuth(false);
                return;
            }
            const data = await response.json();
            renderAuthenticatedUi(data.user);
            resolveAuth(true);
        } catch {
            showLogin('Oturum bilgisi kontrol edilemedi.');
            resolveAuth(false);
        }
    });
})();
