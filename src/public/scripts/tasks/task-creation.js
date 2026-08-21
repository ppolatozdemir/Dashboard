function switchTaskMode(mode) {
    document.getElementById('singleModeBtn').classList.toggle('active', mode === 'single');
    document.getElementById('bulkModeBtn').classList.toggle('active', mode === 'bulk');
    document.getElementById('singleTaskForm').classList.toggle('active', mode === 'single');
    document.getElementById('bulkTaskForm').classList.toggle('active', mode === 'bulk');
}

async function loadTaskFormData() {
    if (taskFormDataLoaded) return;
    
    try {
        // Projeleri yükle
        const projectSelect = document.getElementById('taskProject');
        const bulkProjectSelect = document.getElementById('bulkProject');
        const response = await fetch('/api/projects');
        const projects = await response.json();
        
        const options = '<option value="">Proje seçin...</option>' + 
            projects.map(p => `<option value="${p.key}">${p.name} (${p.key})</option>`).join('');
        
        projectSelect.innerHTML = options;
        bulkProjectSelect.innerHTML = options;
        const hasSingleProject = projects.length === 1;
        if (hasSingleProject) {
            projectSelect.value = projects[0].key;
            bulkProjectSelect.value = projects[0].key;
        }
        projectSelect.disabled = hasSingleProject;
        bulkProjectSelect.disabled = hasSingleProject;
        
        // Tüm sprintleri yükle
        await loadAllSprints();
        
        // Tüm kullanıcıları yükle
        await loadAllUsers();
        
        taskFormDataLoaded = true;
    } catch (error) {
        console.error('Form verileri yüklenemedi:', error);
    }
}

async function loadAllSprints() {
    try {
        const response = await fetch('/api/all-sprints');
        allSprints = await response.json();
    } catch (error) {
        console.error('Sprintler yüklenemedi:', error);
    }
}

async function loadAllUsers() {
    try {
        const response = await fetch('/api/users');
        allUsers = await response.json();
    } catch (error) {
        console.error('Kullanıcılar yüklenemedi:', error);
    }
}

async function loadProjectUsers() {
    // Proje değişince kullanıcıları da yeniden yükleyebiliriz
    // Şimdilik tüm kullanıcılar zaten yüklü
}

// Sprint Autocomplete
function searchSprints(query) {
    const dropdown = document.getElementById('sprintDropdown');
    showSprintResults(dropdown, 'taskSprintSearch', 'taskSprintId', query);
}

function searchSprintsBulk(query) {
    const dropdown = document.getElementById('bulkSprintDropdown');
    showSprintResults(dropdown, 'bulkSprintSearch', 'bulkSprintId', query);
}

function showSprintResults(dropdown, inputId, hiddenId, query) {
    const filtered = allSprints.filter(s => 
        s.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 15);
    
    if (filtered.length === 0) {
        dropdown.classList.remove('show');
        return;
    }
    
    dropdown.innerHTML = filtered.map(sprint => `
        <div class="autocomplete-item" onclick="selectSprint('${sprint.id}', '${sprint.name.replace(/'/g, "\\'")}', '${inputId}', '${hiddenId}')">
            <div class="item-name">${sprint.name}</div>
            <div class="item-detail">${sprint.state === 'active' ? '🟢 Aktif' : '🔵 Gelecek'}</div>
        </div>
    `).join('');
    
    dropdown.classList.add('show');
}

function selectSprint(id, name, inputId, hiddenId) {
    document.getElementById(inputId).value = name;
    document.getElementById(hiddenId).value = id;
    document.getElementById(inputId).parentElement.querySelector('.autocomplete-dropdown').classList.remove('show');
}

// User Autocomplete
function searchUsers(query) {
    const dropdown = document.getElementById('assigneeDropdown');
    const filtered = allUsers.filter(u => 
        u.displayName.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);
    
    if (filtered.length === 0) {
        dropdown.classList.remove('show');
        return;
    }
    
    dropdown.innerHTML = filtered.map(user => `
        <div class="autocomplete-item" onclick="selectUser('${user.accountId}', '${user.displayName.replace(/'/g, "\\'")}')">
            <div class="item-name">${user.displayName}</div>
            <div class="item-detail">${user.emailAddress || ''}</div>
        </div>
    `).join('');
    
    dropdown.classList.add('show');
}

function selectUser(id, name) {
    document.getElementById('taskAssigneeSearch').value = name;
    document.getElementById('taskAssigneeId').value = id;
    document.getElementById('assigneeDropdown').classList.remove('show');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        document.querySelectorAll('.autocomplete-dropdown').forEach(d => d.classList.remove('show'));
    }
});

async function createTask(event) {
    event.preventDefault();
    
    const btn = document.getElementById('createTaskBtn');
    const successMsg = document.getElementById('taskSuccessMessage');
    
    const projectKey = document.getElementById('taskProject').value;
    const summary = document.getElementById('taskSummary').value;
    const description = document.getElementById('taskDescription').value;
    const sprintId = document.getElementById('taskSprintId').value;
    const assigneeId = document.getElementById('taskAssigneeId').value;
    
    if (!projectKey || !summary) {
        alert('Lütfen proje ve konu başlığı alanlarını doldurun.');
        return;
    }
    
    btn.disabled = true;
    btn.textContent = '⏳ Oluşturuluyor...';
    successMsg.style.display = 'none';
    
    try {
        const response = await fetch('/api/create-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectKey,
                summary,
                description,
                sprintId: sprintId || null,
                assigneeId: assigneeId || null
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Task oluşturulamadı');
        }
        
        // Başarılı mesaj göster
        successMsg.innerHTML = `✅ Task başarıyla oluşturuldu: <a href="https://hebiar.atlassian.net/browse/${result.key}" target="_blank" style="color: inherit; font-weight: bold;">${result.key}</a>`;
        successMsg.style.display = 'block';
        
        // Oluşturulan taskları listeye ekle
        createdTasks.unshift({
            key: result.key,
            summary: summary,
            assignee: result.assignee || 'Atanmamış',
            sprint: result.sprint || 'Yok'
        });
        renderCreatedTasks();
        
        // Formu temizle
        document.getElementById('taskSummary').value = '';
        document.getElementById('taskDescription').value = '';
        document.getElementById('taskSprintSearch').value = '';
        document.getElementById('taskSprintId').value = '';
        document.getElementById('taskAssigneeSearch').value = '';
        document.getElementById('taskAssigneeId').value = '';
        
    } catch (error) {
        alert('❌ Hata: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Task Oluştur';
    }
}

function getBulkTaskInput() {
    const projectKey = document.getElementById('bulkProject').value;
    const sprintId = document.getElementById('bulkSprintId').value;
    const bulkText = document.getElementById('bulkTasks').value.trim();
    if (!projectKey || !sprintId || !bulkText) {
        alert('Lütfen proje, sprint ve taskları girin.');
        return null;
    }
    const lines = bulkText.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
        alert('En az bir task girmelisiniz.');
        return null;
    }
    return { projectKey, sprintId, lines };
}

function parseBulkTask(line) {
    const parts = line.trim().split('|').map(part => part.trim());
    const assigneeName = parts[1] || null;
    const user = assigneeName
        ? allUsers.find(candidate => candidate.displayName.toLowerCase().includes(assigneeName.toLowerCase()))
        : null;
    return { summary: parts[0], assigneeName, assigneeId: user ? user.accountId : null };
}

async function submitBulkTask(input, line) {
    const task = parseBulkTask(line);
    try {
        const response = await fetch('/api/create-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectKey: input.projectKey,
                summary: task.summary,
                description: task.summary,
                sprintId: input.sprintId,
                assigneeId: task.assigneeId
            })
        });
        const result = await response.json();
        if (!response.ok) return { success: false, summary: task.summary, error: result.error };

        createdTasks.unshift({
            key: result.key,
            summary: task.summary,
            assignee: task.assigneeName || 'Atanmamış',
            sprint: document.getElementById('bulkSprintSearch').value
        });
        return { success: true, key: result.key, summary: task.summary, assignee: task.assigneeName || 'Atanmamış' };
    } catch (error) {
        return { success: false, summary: task.summary, error: error.message };
    }
}

function renderBulkTaskResult(results) {
    const successful = results.filter(result => result.success);
    const failed = results.filter(result => !result.success);
    let message = `✅ ${successful.length}/${results.length} task başarıyla oluşturuldu.<br><br>`;
    if (successful.length) {
        message += '<strong>Oluşturulan Tasklar:</strong><br>';
        message += successful.map(task =>
            `<a href="https://hebiar.atlassian.net/browse/${task.key}" target="_blank" style="color: inherit;">${task.key}</a> - ${task.summary}`
        ).join('<br>');
    }
    if (failed.length) {
        message += '<br><br><strong style="color: var(--accent-red);">Başarısız:</strong><br>';
        message += failed.map(task => `❌ ${task.summary}: ${task.error}`).join('<br>');
    }
    const successMsg = document.getElementById('taskSuccessMessage');
    successMsg.innerHTML = message;
    successMsg.style.display = 'block';
}

async function createBulkTasks(event) {
    event.preventDefault();
    const input = getBulkTaskInput();
    if (!input) return;

    const btn = document.getElementById('createBulkTaskBtn');
    const successMsg = document.getElementById('taskSuccessMessage');
    btn.disabled = true;
    btn.textContent = `⏳ Oluşturuluyor (0/${input.lines.length})...`;
    successMsg.style.display = 'none';

    const results = [];
    for (let i = 0; i < input.lines.length; i++) {
        results.push(await submitBulkTask(input, input.lines[i]));
        btn.textContent = `⏳ Oluşturuluyor (${i + 1}/${input.lines.length})...`;
    }

    renderBulkTaskResult(results);
    renderCreatedTasks();
    document.getElementById('bulkTasks').value = '';
    btn.disabled = false;
    btn.textContent = '🚀 Tüm Taskları Oluştur';
}

function renderCreatedTasks() {
    const container = document.getElementById('createdTasksContainer');
    
    if (createdTasks.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Henüz task oluşturulmadı.</p>';
        return;
    }
    
    container.innerHTML = createdTasks.map(task => `
        <div class="created-task-item">
            <div>
                <a href="https://hebiar.atlassian.net/browse/${task.key}" target="_blank" class="task-key">${task.key}</a>
                <span style="margin-left: 10px; color: var(--text-secondary);">${task.summary}</span>
            </div>
            <div style="color: var(--text-muted); font-size: 12px;">
                ${task.assignee} | ${task.sprint}
            </div>
        </div>
    `).join('');
}
// ============== Task Oluşturma Fonksiyonları Sonu ==============
