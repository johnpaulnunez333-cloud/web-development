(function () {
    const grid = document.getElementById('grid');
    const chips = document.getElementById('chips');
    let projects = [];
    let active = 'All';

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function safeLink(url) {
        return /^(https?:\/\/|\/)/.test(url || '') ? url : '';
    }

    function render() {
        grid.innerHTML = '';
        const list = projects.filter(p => active === 'All' || p.category === active);
        if (!list.length) {
            grid.appendChild(el('div', 'empty-state', 'No projects in this category yet.'));
            return;
        }
        list.forEach(p => {
            const card = el('article', 'pcard');
            const media = el('div', 'pcard-media');
            if (p.image) {
                const img = el('img');
                img.src = p.image;
                img.alt = p.title;
                img.loading = 'lazy';
                img.addEventListener('error', () => { img.remove(); media.innerHTML = '<i class="fa-solid fa-laptop-code"></i>'; });
                media.appendChild(img);
            } else {
                media.innerHTML = '<i class="fa-solid fa-laptop-code"></i>';
            }
            const body = el('div', 'pcard-body');
            body.appendChild(el('span', 'pcard-cat', p.category));
            body.appendChild(el('h3', '', p.title));
            if (p.description) body.appendChild(el('p', '', p.description));
            if (p.tech.length) {
                const tags = el('div', 'tags');
                p.tech.forEach(t => tags.appendChild(el('span', 'tag', t)));
                body.appendChild(tags);
            }
            const href = safeLink(p.link);
            if (href) {
                const a = el('a', 'pbtn', 'View project ');
                a.href = href;
                if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
                a.appendChild(el('i', 'fa-solid fa-arrow-up-right-from-square'));
                body.appendChild(a);
            }
            card.append(media, body);
            grid.appendChild(card);
        });
    }

    function renderChips() {
        chips.innerHTML = '';
        const cats = ['All'].concat([...new Set(projects.map(p => p.category))]);
        cats.forEach(c => {
            const b = el('button', 'chip' + (c === active ? ' on' : ''), c);
            b.type = 'button';
            b.addEventListener('click', () => { active = c; renderChips(); render(); });
            chips.appendChild(b);
        });
    }

    fetch('/api/portfolio', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => { projects = data.projects || []; renderChips(); render(); })
        .catch(() => { grid.innerHTML = ''; grid.appendChild(el('div', 'empty-state', 'Could not load the portfolio. Please refresh.')); });
})();
