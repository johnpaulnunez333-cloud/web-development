const BASE = document.body.dataset.base;
const MAX_PDF = 25 * 1024 * 1024;

const bookForm = document.getElementById('bookForm');
const bookTitle = document.getElementById('bookTitle');
const coverInput = document.getElementById('coverInput');
const coverPreview = document.getElementById('coverPreview');
const pdfInput = document.getElementById('pdfInput');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const bookError = document.getElementById('bookError');
const uploadBtn = document.getElementById('uploadBtn');
const bookList = document.getElementById('bookList');
const storageNote = document.getElementById('storageNote');

let toastTimer = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

function toast(message, isError) {
    const node = document.getElementById('toast');
    node.innerText = message;
    node.classList.toggle('error', Boolean(isError));
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
}

function showFormError(message) {
    bookError.innerText = message;
    bookError.classList.add('show-error');
}

function clearFormError() {
    bookError.innerText = '';
    bookError.classList.remove('show-error');
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function formatDate(value) {
    return new Date(value).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function resizeCover(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            const maxSide = 900;
            const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('unreadable'));
            }, 'image/jpeg', 0.86);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('unreadable'));
        };
        image.src = url;
    });
}

function sendBook(formData) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', BASE + '/api/books');
        xhr.withCredentials = true;

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const pct = Math.round(event.loaded / event.total * 100);
                progressFill.style.width = pct + '%';
                progressText.innerText = pct + '%';
            }
        };

        xhr.onload = () => {
            if (xhr.status === 401) {
                window.location.href = BASE;
                return;
            }
            let data = {};
            try {
                data = JSON.parse(xhr.responseText);
            } catch (err) {
                data = {};
            }
            if (xhr.status >= 200 && xhr.status < 300 && data.success) resolve(data);
            else reject(new Error(data.message || 'The upload failed. Please try again.'));
        };

        xhr.onerror = () => reject(new Error('Network error. Check your connection and try again.'));
        xhr.send(formData);
    });
}

async function loadBooks() {
    try {
        const response = await fetch(BASE + '/api/books', { credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = BASE;
            return;
        }
        const data = await response.json();
        renderBooks(data.books || []);
        storageNote.innerText = 'Storage used: ' + formatSize(data.used_bytes || 0);
    } catch (err) {
        bookList.innerHTML = '';
        bookList.appendChild(el('p', 'books-none', 'Could not load the books. Refresh the page to try again.'));
    }
}

function renderBooks(books) {
    bookList.innerHTML = '';
    if (books.length === 0) {
        bookList.appendChild(el('p', 'books-none', 'No books uploaded yet.'));
        return;
    }

    books.forEach((book) => {
        const card = el('div', 'admin-book');
        const cover = el('img');
        cover.src = book.cover;
        cover.alt = '';
        cover.loading = 'lazy';

        const info = el('div', 'admin-book-info');
        info.appendChild(el('strong', '', book.title));
        info.appendChild(el('small', '', formatSize(book.size) + ' | ' + formatDate(book.created_at)));

        const remove = el('button', 'btn btn-danger', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', () => deleteBook(book));
        info.appendChild(remove);

        card.appendChild(cover);
        card.appendChild(info);
        bookList.appendChild(card);
    });
}

async function deleteBook(book) {
    if (!confirm('Delete "' + book.title + '"? This cannot be undone.')) return;
    try {
        const response = await fetch(BASE + '/api/books/' + book.id, { method: 'DELETE', credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = BASE;
            return;
        }
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Could not delete the book.');
        toast('Book deleted.');
        loadBooks();
    } catch (err) {
        toast(err.message, true);
    }
}

coverInput.addEventListener('change', () => {
    const file = coverInput.files[0];
    if (!file) {
        coverPreview.hidden = true;
        return;
    }
    coverPreview.src = URL.createObjectURL(file);
    coverPreview.hidden = false;
});

bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError();

    const title = bookTitle.value.trim();
    const cover = coverInput.files[0];
    const pdf = pdfInput.files[0];

    if (title.length < 2) {
        showFormError('Enter the book title.');
        return;
    }
    if (!cover) {
        showFormError('Choose a cover picture.');
        return;
    }
    if (!pdf) {
        showFormError('Choose the PDF file.');
        return;
    }
    if (pdf.size > MAX_PDF) {
        showFormError('The PDF is larger than 25 MB. Compress it first.');
        return;
    }
    if (pdf.type !== 'application/pdf' && !/\.pdf$/i.test(pdf.name)) {
        showFormError('The book file must be a PDF.');
        return;
    }

    uploadBtn.disabled = true;
    uploadBtn.innerText = 'Uploading...';
    progressFill.style.width = '0';
    progressText.innerText = '0%';
    progressWrap.hidden = false;

    try {
        const coverBlob = await resizeCover(cover);
        const formData = new FormData();
        formData.append('title', title);
        formData.append('cover', coverBlob, 'cover.jpg');
        formData.append('pdf', pdf, pdf.name);

        await sendBook(formData);
        bookForm.reset();
        coverPreview.hidden = true;
        toast('Book uploaded.');
        loadBooks();
    } catch (err) {
        showFormError(err.message === 'unreadable' ? 'The cover picture could not be read. Try a different image.' : err.message);
    }

    progressWrap.hidden = true;
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload book';
});

document.getElementById('sideToggle').addEventListener('click', () => {
    document.getElementById('adminSide').classList.toggle('open');
});

loadBooks();
