(function () {
    const list = document.getElementById('labs');
    if (!list) return;

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function size(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
    function setText(id, value) {
        const n = document.getElementById(id);
        if (n) n.textContent = Number(value).toLocaleString();
    }

    fetch('/api/pt/labs', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            const s = data.stats || {};
            setText('stLabs', s.labs || 0);
            setText('stDownloads', s.downloads || 0);
            setText('stPings', s.pings || 0);
            list.innerHTML = '';
            if (!data.labs.length) {
                list.appendChild(el('div', 'empty-state', 'No labs uploaded yet. Check back soon.'));
                return;
            }
            data.labs.forEach(lab => {
                const row = el('div', 'lab');
                const icon = el('div', 'lab-icon');
                icon.innerHTML = '<i class="fa-solid fa-file-code"></i>';
                const main = el('div', 'lab-main');
                main.appendChild(el('h3', '', lab.title));
                if (lab.description) main.appendChild(el('p', '', lab.description));
                const meta = el('div', 'lab-meta');
                meta.appendChild(el('span', 'lvl lvl-' + lab.level, lab.level));
                meta.appendChild(el('span', '', lab.file_name));
                meta.appendChild(el('span', '', size(lab.size)));
                meta.appendChild(el('span', '', lab.downloads + ' downloads'));
                main.appendChild(meta);
                const a = el('a', 'pbtn solid', 'Download ');
                a.href = lab.download;
                a.appendChild(el('i', 'fa-solid fa-download'));
                row.append(icon, main, a);
                list.appendChild(row);
            });
        })
        .catch(() => { list.innerHTML = ''; list.appendChild(el('div', 'empty-state', 'Could not load labs. Please refresh.')); });
})();
