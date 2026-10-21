const BASE = document.body.dataset.base;

const productForm = document.getElementById('productForm');
const pName = document.getElementById('pName');
const pCategory = document.getElementById('pCategory');
const pPrice = document.getElementById('pPrice');
const pStock = document.getElementById('pStock');
const pDescription = document.getElementById('pDescription');
const pImage = document.getElementById('pImage');
const pPreview = document.getElementById('pPreview');
const productError = document.getElementById('productError');
const productBtn = document.getElementById('productBtn');
const productNote = document.getElementById('productNote');
const productsTable = document.getElementById('productsTable');
const orderFilter = document.getElementById('orderFilter');
const ordersAdmin = document.getElementById('ordersAdmin');

let toastTimer = null;
let allOrders = [];
let orderStatuses = [];

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

function money(value) {
    return '₱' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showFormError(message) {
    productError.innerText = message;
    productError.classList.add('show-error');
}

async function api(path, options) {
    const settings = Object.assign({ credentials: 'same-origin' }, options || {});
    if (settings.body && typeof settings.body !== 'string' && !(settings.body instanceof FormData)) {
        settings.headers = Object.assign({ 'Content-Type': 'application/json' }, settings.headers || {});
        settings.body = JSON.stringify(settings.body);
    }
    const response = await fetch(BASE + '/api' + path, settings);
    if (response.status === 401) {
        window.location.href = BASE;
        throw new Error('unauthorized');
    }
    let data = {};
    try {
        data = await response.json();
    } catch (err) {
        data = {};
    }
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
}

function resizeImage(file) {
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
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('unreadable'))), 'image/jpeg', 0.86);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('unreadable'));
        };
        image.src = url;
    });
}

function actionButton(label, className, handler) {
    const button = el('button', 'btn ' + className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
}

function renderProducts(products) {
    productsTable.innerHTML = '';
    const thead = el('thead');
    const headRow = el('tr');
    ['', 'Product', 'Price (PHP)', 'Stock', 'Status', 'Actions'].forEach((title) => headRow.appendChild(el('th', '', title)));
    thead.appendChild(headRow);
    productsTable.appendChild(thead);

    const tbody = el('tbody');
    if (products.length === 0) {
        const row = el('tr');
        const cell = el('td', 'empty-row', 'No products yet.');
        cell.colSpan = 6;
        row.appendChild(cell);
        tbody.appendChild(row);
    }

    products.forEach((product) => {
        const row = el('tr');

        const imageCell = el('td');
        const thumb = el('img', 'thumb');
        thumb.src = product.image;
        thumb.alt = '';
        imageCell.appendChild(thumb);
        row.appendChild(imageCell);

        const nameCell = el('td');
        nameCell.appendChild(el('strong', '', product.name));
        nameCell.appendChild(el('span', 'reasons', product.category));
        row.appendChild(nameCell);

        const priceInput = el('input', 'inline-input');
        priceInput.value = product.price.toFixed(2);
        priceInput.inputMode = 'decimal';
        const priceCell = el('td');
        priceCell.appendChild(priceInput);
        row.appendChild(priceCell);

        const stockInput = el('input', 'inline-input');
        stockInput.value = product.stock;
        stockInput.inputMode = 'numeric';
        const stockCell = el('td');
        stockCell.appendChild(stockInput);
        row.appendChild(stockCell);

        const statusCell = el('td');
        statusCell.appendChild(el('span', 'pill ' + (product.active ? 'pill-on' : 'pill-off'), product.active ? 'Visible' : 'Hidden'));
        row.appendChild(statusCell);

        const actions = el('div', 'row-actions');
        actions.appendChild(actionButton('Save', 'btn-primary', () => updateProduct(product, { price: priceInput.value, stock: stockInput.value })));
        actions.appendChild(actionButton(product.active ? 'Hide' : 'Show', 'btn-ghost', () => updateProduct(product, { active: !product.active })));
        actions.appendChild(actionButton('Delete', 'btn-danger', () => deleteProduct(product)));
        const actionCell = el('td');
        actionCell.appendChild(actions);
        row.appendChild(actionCell);

        tbody.appendChild(row);
    });
    productsTable.appendChild(tbody);
    productNote.innerText = products.length + ' product(s)';
}

async function loadProducts() {
    try {
        const data = await api('/products');
        renderProducts(data.products);
    } catch (err) {
        if (err.message !== 'unauthorized') toast(err.message, true);
    }
}

async function updateProduct(product, changes) {
    try {
        await api('/products/' + product.id, { method: 'POST', body: changes });
        toast('Product updated.');
        loadProducts();
    } catch (err) {
        toast(err.message, true);
    }
}

async function deleteProduct(product) {
    if (!confirm('Delete "' + product.name + '"? Past orders keep their records.')) return;
    try {
        await api('/products/' + product.id, { method: 'DELETE' });
        toast('Product deleted.');
        loadProducts();
    } catch (err) {
        toast(err.message, true);
    }
}

pImage.addEventListener('change', () => {
    const file = pImage.files[0];
    if (!file) {
        pPreview.hidden = true;
        return;
    }
    pPreview.src = URL.createObjectURL(file);
    pPreview.hidden = false;
});

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    productError.classList.remove('show-error');
    productError.innerText = '';

    const name = pName.value.trim();
    const file = pImage.files[0];
    if (name.length < 2) {
        showFormError('Enter the product name.');
        return;
    }
    if (!pPrice.value.trim()) {
        showFormError('Enter the price.');
        return;
    }
    if (pStock.value.trim() === '') {
        showFormError('Enter the stock quantity.');
        return;
    }
    if (!file) {
        showFormError('Choose a product picture.');
        return;
    }

    productBtn.disabled = true;
    productBtn.innerText = 'Saving...';

    try {
        const blob = await resizeImage(file);
        const formData = new FormData();
        formData.append('name', name);
        formData.append('category', pCategory.value);
        formData.append('price', pPrice.value.trim());
        formData.append('stock', pStock.value.trim());
        formData.append('description', pDescription.value.trim());
        formData.append('image', blob, 'product.jpg');

        await api('/products', { method: 'POST', body: formData });
        productForm.reset();
        pPreview.hidden = true;
        toast('Product added.');
        loadProducts();
    } catch (err) {
        showFormError(err.message === 'unreadable' ? 'The picture could not be read. Try a different image.' : err.message);
    }

    productBtn.disabled = false;
    productBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add product';
});

function renderOrders() {
    const filter = orderFilter.value;
    const list = allOrders.filter((o) => !filter || o.status === filter);
    ordersAdmin.innerHTML = '';

    if (list.length === 0) {
        ordersAdmin.appendChild(el('p', 'books-none', 'No orders found.'));
        return;
    }

    list.forEach((order) => {
        const card = el('div', 'order-admin');

        const top = el('div', 'order-admin-top');
        top.appendChild(el('strong', '', 'Order #' + order.id + '  |  ' + money(order.total)));
        const select = el('select');
        orderStatuses.forEach((status) => {
            const option = el('option', '', status.charAt(0).toUpperCase() + status.slice(1));
            option.value = status;
            option.selected = status === order.status;
            select.appendChild(option);
        });
        select.disabled = order.status === 'cancelled';
        select.addEventListener('change', () => changeStatus(order, select.value, select));
        top.appendChild(select);
        card.appendChild(top);

        const info = [
            ['Customer', order.customer_name + ' (' + order.phone + ')'],
            ['Address', order.address],
            ['Account', order.account],
            ['Items', order.items.map((i) => i.quantity + ' x ' + i.name + ' @ ' + money(i.price)).join(', ')],
            ['Placed', new Date(order.created_at).toLocaleString()]
        ];
        if (order.notes) info.push(['Notes', order.notes]);
        info.forEach(([label, value]) => {
            const line = el('div', 'order-line');
            line.appendChild(el('strong', '', label + ': '));
            line.appendChild(document.createTextNode(value));
            card.appendChild(line);
        });
        ordersAdmin.appendChild(card);
    });
}

async function changeStatus(order, status, select) {
    if (status === 'cancelled' && !confirm('Cancel order #' + order.id + '? The stock will be returned and this cannot be undone.')) {
        select.value = order.status;
        return;
    }
    try {
        await api('/orders/' + order.id + '/status', { method: 'POST', body: { status } });
        toast('Order updated.');
        loadOrders();
        loadProducts();
    } catch (err) {
        select.value = order.status;
        toast(err.message, true);
    }
}

async function loadOrders() {
    try {
        const data = await api('/orders');
        allOrders = data.orders;
        orderStatuses = data.statuses;
        if (orderFilter.options.length === 0) {
            const all = el('option', '', 'All statuses');
            all.value = '';
            orderFilter.appendChild(all);
            orderStatuses.forEach((status) => {
                const option = el('option', '', status.charAt(0).toUpperCase() + status.slice(1));
                option.value = status;
                orderFilter.appendChild(option);
            });
        }
        renderOrders();
    } catch (err) {
        if (err.message !== 'unauthorized') toast(err.message, true);
    }
}

orderFilter.addEventListener('change', renderOrders);
document.getElementById('sideToggle').addEventListener('click', () => {
    document.getElementById('adminSide').classList.toggle('open');
});

loadProducts();
loadOrders();
