const bookGrid = document.getElementById('bookGrid');
const booksEmpty = document.getElementById('booksEmpty');
const bookSearch = document.getElementById('bookSearch');

let allBooks = [];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function actionLink(label, icon, href, className, newTab) {
    const link = el('a', 'btn ' + className);
    link.href = href;
    if (newTab) {
        link.target = '_blank';
        link.rel = 'noopener';
    }
    link.innerHTML = '<i class="fa-solid ' + icon + '"></i> ' + label;
    return link;
}

function renderBooks() {
    const term = bookSearch.value.trim().toLowerCase();
    const list = allBooks.filter((b) => !term || b.title.toLowerCase().includes(term));

    bookGrid.innerHTML = '';
    booksEmpty.hidden = list.length > 0;
    if (list.length === 0) {
        booksEmpty.innerText = allBooks.length === 0
            ? 'No books have been uploaded yet. Check back soon.'
            : 'No books match your search.';
    }

    list.forEach((book) => {
        const card = el('article', 'book-card');

        const cover = el('img', 'book-cover');
        cover.src = book.cover;
        cover.alt = 'Cover of ' + book.title;
        cover.loading = 'lazy';
        card.appendChild(cover);

        const info = el('div', 'book-info');
        info.appendChild(el('h3', 'book-title', book.title));
        info.appendChild(el('span', 'book-meta', 'PDF | ' + formatSize(book.size)));

        const actions = el('div', 'book-actions');
        actions.appendChild(actionLink('Read', 'fa-book-open', book.read, 'btn-primary', true));
        actions.appendChild(actionLink('Download', 'fa-download', book.download, 'btn-ghost', false));
        info.appendChild(actions);

        card.appendChild(info);
        bookGrid.appendChild(card);
    });
}

async function loadBooks() {
    try {
        const response = await fetch('/api/books', { credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        const data = await response.json();
        allBooks = data.books || [];
        renderBooks();
    } catch (err) {
        booksEmpty.hidden = false;
        booksEmpty.innerText = 'Could not load the books. Refresh the page to try again.';
    }
}

bookSearch.addEventListener('input', renderBooks);

loadBooks();
