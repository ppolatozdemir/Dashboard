async function runLabelSync(dryRun) {
    if (labelSyncRunning) return;
    if (!dryRun) {
        const ok = confirm(
            'Olka etiketleri, CLLINK ile eşleşen Hebiar tasklarına BİREBİR kopyalanacak.\n\n' +
            'Hebiar\'daki fazla etiketler SİLİNECEK (Hebiar = Olka).\n\nDevam edilsin mi?'
        );
        if (!ok) return;
    }
    labelSyncRunning = true;
    const container = document.getElementById('labelSyncContent');
    const infoBar = document.getElementById('labelSyncInfoBar');
    const btnRun = document.getElementById('labelSyncRunBtn');
    const btnDry = document.getElementById('labelSyncDryBtn');
    btnRun.disabled = true; btnDry.disabled = true;
    infoBar.innerHTML = '';
    container.innerHTML = `
        <div class="loading" style="height: 150px;">
            <div class="loading-spinner"></div>
            <span>${dryRun ? 'Önizleme hazırlanıyor' : 'Etiketler eşitleniyor'}... (birkaç dakika sürebilir, lütfen bekleyin)</span>
        </div>
    `;
    try {
        const res = await fetch('/api/label-sync/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Eşitleme başarısız');
        const data = await res.json();
        lastLabelSyncData = data;
        renderLabelSync(data);
    } catch (error) {
        container.innerHTML = `
            <div class="error-message" style="text-align: center; padding: 30px;">
                ❌ Hata: ${escapeHtml(error.message)}
            </div>
        `;
    } finally {
        labelSyncRunning = false;
        btnRun.disabled = false; btnDry.disabled = false;
    }
}

function renderLabelSyncInfo(data) {
    const infoBar = document.getElementById('labelSyncInfoBar');
    const badge = (bg, html) => `<span style="background: ${bg}; padding: 5px 12px; border-radius: 6px; font-size: 13px;">${html}</span>`;
    infoBar.innerHTML = [
        badge('rgba(67,97,238,0.3)', `📥 Olka task: <strong>${data.olkaCount}</strong>`),
        badge('rgba(67,97,238,0.3)', `🔗 Eşleşen: <strong>${data.matchedCount}</strong>`),
        badge('rgba(76,175,80,0.3)', `${data.dryRun ? '📝 Değişecek' : '✔ Güncellenen'}: <strong>${data.updatedCount}</strong>`),
        badge('rgba(158,158,158,0.3)', `= Zaten eşit: <strong>${data.alreadyEqual}</strong>`),
        badge('rgba(76,175,80,0.25)', `➕ <strong>${data.totalAdded}</strong> etiket`),
        badge('rgba(243,156,18,0.35)', `➖ <strong>${data.totalRemoved}</strong> etiket`),
        data.failedCount ? badge('rgba(231,76,60,0.4)', `✖ Başarısız: <strong>${data.failedCount}</strong>`) : '',
        badge('rgba(158,158,158,0.3)', `CLLINK yok: <strong>${data.noLinkCount}</strong>`),
        data.notFoundCount ? badge('rgba(243,156,18,0.35)', `Bulunamadı: <strong>${data.notFoundCount}</strong>`) : '',
    ].filter(Boolean).join('');
}

function renderLabelSyncRows(changes) {
    const tag = (t, color) => `<span style="display:inline-block; background:${color}; color:#fff; padding:1px 7px; border-radius:10px; font-size:11px; margin:1px;">${escapeHtml(t)}</span>`;
    if (changes.length === 0) {
        return `<div style="text-align:center; padding:20px; color: var(--text-secondary);">Tüm eşleşen tasklar zaten eşitti — güncelleme gerekmedi. 🎉</div>`;
    }
    return `
        <table class="daily-report-table" style="width: 100%;">
            <thead>
                <tr>
                    <th style="text-align:left;">Hebiar (CL)</th>
                    <th style="text-align:left;">Olka</th>
                    <th style="text-align:left;">➕ Eklenen</th>
                    <th style="text-align:left;">➖ Silinen</th>
                    <th style="text-align:center;">Durum</th>
                </tr>
            </thead>
            <tbody>
                ${changes.map(c => {
                    const olka = (c.olkaKeys || []).map(k => `<a href="https://olkaproduct.atlassian.net/browse/${encodeURIComponent(k)}" target="_blank" style="color:#4361ee;">${escapeHtml(k)}</a>`).join(', ');
                    const added = (c.added || []).length ? c.added.map(t => tag('+' + t, '#2e7d32')).join(' ') : '<span style="color: var(--text-muted);">—</span>';
                    const removed = (c.removed || []).length ? c.removed.map(t => tag('−' + t, '#c0392b')).join(' ') : '<span style="color: var(--text-muted);">—</span>';
                    let status = '<span title="önizleme">📝</span>';
                    if (c.status === 'updated') status = '<span style="color:#2e7d32; font-weight:700;">✔</span>';
                    else if (c.status === 'failed') status = `<span style="color: var(--accent-red); font-weight:700;" title="${escapeHtml(c.error || '')}">✖</span>`;
                    return `
                        <tr>
                            <td><a href="https://hebiar.atlassian.net/browse/${encodeURIComponent(c.clKey)}" target="_blank" style="color:#4361ee; font-weight:600;">${escapeHtml(c.clKey)}</a></td>
                            <td>${olka}</td>
                            <td>${added}</td>
                            <td>${removed}</td>
                            <td style="text-align:center;">${status}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>`;
}

function renderLabelSync(data) {
    const container = document.getElementById('labelSyncContent');
    renderLabelSyncInfo(data);
    const bannerBg = data.failedCount ? 'rgba(231,76,60,0.15)' : (data.dryRun ? 'rgba(67,97,238,0.15)' : 'rgba(76,175,80,0.15)');
    const bannerText = data.dryRun
        ? `👁️ Önizleme tamamlandı — hiçbir değişiklik YAPILMADI. ${data.updatedCount} task değişecek (${(data.durationMs / 1000).toFixed(1)} sn).`
        : `✅ Eşitleme tamamlandı — ${data.updatedCount} Hebiar taskı güncellendi${data.failedCount ? `, ${data.failedCount} başarısız` : ''} (${(data.durationMs / 1000).toFixed(1)} sn).`;

    const changes = data.changes || [];
    let notFoundHTML = '';
    if (data.notFoundCount) {
        notFoundHTML = `<p style="color: var(--text-secondary); font-size:12px; margin-top:12px;">⚠️ Hebiar'da bulunamayan ${data.notFoundCount} anahtar (silinmiş/erişilemez): ${(data.notFoundKeys || []).slice(0, 40).map(escapeHtml).join(', ')}${data.notFoundKeys && data.notFoundKeys.length > 40 ? ' …' : ''}</p>`;
    }

    container.innerHTML = `
        <div style="background: ${bannerBg}; padding: 12px 15px; border-radius: 8px; margin-bottom: 15px; font-size: 14px;">${bannerText}</div>
        ${data.dryRun && changes.length ? `<div style="margin-bottom:12px;"><button class="refresh-btn" onclick="runLabelSync(false)" style="background:#c0392b;">🔄 Bu değişiklikleri uygula (Eşitle)</button></div>` : ''}
        ${renderLabelSyncRows(changes)}
        ${notFoundHTML}
    `;
}

let olkaDeployLoaded = false;
let lastOlkaDeployData = null;

// Ready for Ship tasklarını yükle
