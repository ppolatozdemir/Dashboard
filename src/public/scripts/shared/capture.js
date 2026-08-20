function validateCaptureSource(source) {
    if (!source) return false;
    if (source.querySelector('.loading') || !source.querySelector('.daily-table, .daily-summary-cards')) {
        alert('Önce raporun yüklenmesini bekleyin.');
        return false;
    }
    if (typeof html2canvas === 'undefined') {
        alert('Ekran görüntüsü aracı henüz yüklenmedi. Birkaç saniye sonra tekrar deneyin.');
        return false;
    }
    return true;
}

function createCaptureWrapper(source, title, dateLabel) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = [
        'position: fixed',
        'left: -99999px',
        'top: 0',
        'width: 820px',
        'padding: 36px',
        'background: #ffffff',
        'box-sizing: border-box',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'font-size: 17px',
        'color: #14172b',
        '--text-primary: #14172b',
        '--text-secondary: rgba(0,0,0,0.65)',
        '--text-muted: rgba(0,0,0,0.45)',
        '--border-color: rgba(0,0,0,0.14)',
        '--bg-tertiary: #ffffff',
        '--bg-secondary: #ffffff',
        '--card-bg: #f2f5fb',
        '--table-header-bg: #dfe6fb',
        '--table-row-hover: transparent',
        '--accent-blue: #2f47c7',
        '--accent-pink: #d61a67',
        '--accent-cyan: #0090b3',
        '--accent-orange: #d96f00',
        '--accent-green: #2d9600'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; padding-bottom:18px; border-bottom:3px solid #2f47c7;';
    header.innerHTML =
        '<div style="font-size:26px; font-weight:800; color:#14172b;">' + title + '</div>' +
        '<div style="font-size:15px; font-weight:600; color:#2f47c7; background:#e3e9fb; padding:9px 15px; border-radius:10px; white-space:nowrap;">' + dateLabel + '</div>';
    wrapper.appendChild(header);

    const clone = source.cloneNode(true);
    clone.querySelectorAll('.loading').forEach(el => el.remove());
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return wrapper;
}

function downloadCapture(canvas, fileNamePrefix, now) {
    const pad = n => String(n).padStart(2, '0');
    const dateFile = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = fileNamePrefix + '-' + dateFile + '.jpg';
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/jpeg', 0.95);
}

async function captureReport(contentId, title, fileNamePrefix, btn) {
    const source = document.getElementById(contentId);
    if (!validateCaptureSource(source)) return;

    const originalBtnText = btn ? btn.textContent : null;
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Hazırlanıyor...';
    }

    const now = new Date();
    const dateLabel = now.toLocaleString('tr-TR', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const wrapper = createCaptureWrapper(source, title, dateLabel);

    try {
        const canvas = await html2canvas(wrapper, {
            scale: 3,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false
        });
        downloadCapture(canvas, fileNamePrefix, now);
    } catch (err) {
        alert('Ekran görüntüsü alınamadı: ' + err.message);
    } finally {
        wrapper.remove();
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalBtnText;
        }
    }
}

// Günlük iş yükü raporu yükleme fonksiyonu
