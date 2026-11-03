const CART_KEY = 'mdw-cart';

const productGrid = document.getElementById('productGrid');
const shopEmpty = document.getElementById('shopEmpty');
const shopSearch = document.getElementById('shopSearch');
const categoryChips = document.getElementById('categoryChips');
const cartBtn = document.getElementById('cartBtn');
const cartCount = document.getElementById('cartCount');
const ordersBtn = document.getElementById('ordersBtn');
const drawerOverlay = document.getElementById('drawerOverlay');
const cartDrawer = document.getElementById('cartDrawer');
const cartClose = document.getElementById('cartClose');
const cartItems = document.getElementById('cartItems');
const cartFoot = document.getElementById('cartFoot');
const cartTotal = document.getElementById('cartTotal');
const checkoutForm = document.getElementById('checkoutForm');
const checkoutError = document.getElementById('checkoutError');
const placeOrderBtn = document.getElementById('placeOrderBtn');
const ordersModal = document.getElementById('ordersModal');
const ordersClose = document.getElementById('ordersClose');
const ordersList = document.getElementById('ordersList');
const shopToast = document.getElementById('shopToast');

let products = [];
let categories = [];
let activeCategory = '';
let cart = loadCart();
let toastTimer = null;

function loadCart() {
    try {
        const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        return {};
    }
}

function saveCart() {
    try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (err) {
        return;
    }
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.innerText = text;
    return node;
}

function money(value) {
    return '₱' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toast(message) {
    shopToast.innerText = message;
    shopToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => shopToast.classList.remove('show'), 2400);
}

function productById(id) {
    return products.find((p) => p.id === Number(id));
}

function cartLines() {
    const lines = [];
    Object.keys(cart).forEach((id) => {
        const product = productById(id);
        if (product && product.stock > 0) {
            lines.push({ product, qty: Math.min(cart[id], product.stock) });
        }
    });
    return lines;
}

function updateCartBadge() {
    const total = cartLines().reduce((sum, line) => sum + line.qty, 0);
    cartCount.innerText = total;
}

function renderChips() {
    categoryChips.innerHTML = '';
    ['', ...categories].forEach((name) => {
        const button = el('button', name === activeCategory ? 'active' : '', name || 'All');
        button.type = 'button';
        button.addEventListener('click', () => {
            activeCategory = name;
            renderChips();
            renderProducts();
        });
        categoryChips.appendChild(button);
    });
}

function renderProducts() {
    const term = shopSearch.value.trim().toLowerCase();
    const list = products.filter((p) =>
        (!activeCategory || p.category === activeCategory) &&
        (!term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)));

    productGrid.innerHTML = '';
    shopEmpty.hidden = list.length > 0;
    if (list.length === 0) {
        shopEmpty.innerText = products.length === 0 ? 'No products yet. Check back soon.' : 'No products match your search.';
    }

    list.forEach((product) => {
        const card = el('article', 'product-card');
        const image = el('img', 'product-image');
        image.src = product.image;
        image.alt = product.name;
        image.loading = 'lazy';
        card.appendChild(image);

        const info = el('div', 'product-info');
        info.appendChild(el('span', 'product-category', product.category));
        info.appendChild(el('h3', 'product-name', product.name));
        if (product.description) info.appendChild(el('p', 'product-desc', product.description));
        info.appendChild(el('div', 'product-price', money(product.price)));

        const stockClass = product.stock === 0 ? 'out' : product.stock <= 5 ? 'low' : '';
        const stockText = product.stock === 0 ? 'Out of stock' : product.stock <= 5 ? 'Only ' + product.stock + ' left' : 'In stock';
        info.appendChild(el('span', 'stock-note ' + stockClass, stockText));

        const add = el('button', 'btn btn-primary', 'Add to cart');
        add.type = 'button';
        add.disabled = product.stock === 0;
        add.addEventListener('click', () => addToCart(product));
        info.appendChild(add);

        card.appendChild(info);
        productGrid.appendChild(card);
    });
}

function addToCart(product) {
    const current = cart[product.id] || 0;
    if (current >= product.stock) {
        toast('You already have all available stock in your cart.');
        return;
    }
    cart[product.id] = current + 1;
    saveCart();
    updateCartBadge();
    toast('Added to cart.');
}

function changeQty(product, delta) {
    const next = (cart[product.id] || 0) + delta;
    if (next <= 0) delete cart[product.id];
    else cart[product.id] = Math.min(next, product.stock);
    saveCart();
    updateCartBadge();
    renderCart();
}

function removeLine(product) {
    delete cart[product.id];
    saveCart();
    updateCartBadge();
    renderCart();
}

function renderCart() {
    const lines = cartLines();
    cartItems.innerHTML = '';
    checkoutForm.hidden = lines.length === 0;
    cartFoot.hidden = lines.length === 0;

    if (lines.length === 0) {
        cartItems.appendChild(el('p', 'cart-empty', 'Your cart is empty.'));
        return;
    }

    let total = 0;
    lines.forEach(({ product, qty }) => {
        total += product.price * qty;
        const row = el('div', 'cart-line');
        const image = el('img');
        image.src = product.image;
        image.alt = '';
        row.appendChild(image);

        const info = el('div', 'cart-line-info');
        info.appendChild(el('div', 'cart-line-name', product.name));
        info.appendChild(el('div', 'cart-line-price', money(product.price) + ' each'));

        const controls = el('div', 'qty-controls');
        const minus = el('button', '', '-');
        minus.type = 'button';
        minus.addEventListener('click', () => changeQty(product, -1));
        const amount = el('span', '', String(qty));
        const plus = el('button', '', '+');
        plus.type = 'button';
        plus.addEventListener('click', () => changeQty(product, 1));
        const remove = el('button', 'remove', 'Remove');
        remove.type = 'button';
        remove.addEventListener('click', () => removeLine(product));
        controls.appendChild(minus);
        controls.appendChild(amount);
        controls.appendChild(plus);
        controls.appendChild(remove);
        info.appendChild(controls);

        row.appendChild(info);
        cartItems.appendChild(row);
    });
    cartTotal.innerText = money(total);
}

function openCart() {
    renderCart();
    drawerOverlay.hidden = false;
    cartDrawer.hidden = false;
}

function closeCart() {
    drawerOverlay.hidden = true;
    cartDrawer.hidden = true;
}

async function loadProducts() {
    try {
        const response = await fetch('/api/shop/products', { credentials: 'same-origin' });
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        const data = await response.json();
        products = data.products || [];
        categories = data.categories || [];
        renderChips();
        renderProducts();
        updateCartBadge();
    } catch (err) {
        shopEmpty.hidden = false;
        shopEmpty.innerText = 'Could not load the shop. Refresh the page to try again.';
    }
}

checkoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    checkoutError.classList.remove('show-error');
    checkoutError.innerText = '';

    const lines = cartLines();
    if (lines.length === 0) return;

    placeOrderBtn.disabled = true;
    placeOrderBtn.innerText = 'Placing order...';

    try {
        const response = await fetch('/api/shop/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                customer_name: document.getElementById('coName').value,
                phone: document.getElementById('coPhone').value,
                address: document.getElementById('coAddress').value,
                notes: document.getElementById('coNotes').value,
                items: lines.map((line) => ({ id: line.product.id, qty: line.qty }))
            })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            cart = {};
            saveCart();
            updateCartBadge();
            closeCart();
            toast('Order #' + data.order.id + ' placed. The seller will contact you.');
            loadProducts();
        } else {
            checkoutError.innerText = data.message || 'Could not place the order.';
            checkoutError.classList.add('show-error');
            if (response.status === 409) loadProducts();
        }
    } catch (err) {
        checkoutError.innerText = 'Unable to reach the server. Please try again.';
        checkoutError.classList.add('show-error');
    }

    placeOrderBtn.disabled = false;
    placeOrderBtn.innerText = 'Place order';
});

async function openOrders() {
    ordersList.innerHTML = '';
    ordersList.appendChild(el('p', 'cart-empty', 'Loading...'));
    ordersModal.hidden = false;

    try {
        const response = await fetch('/api/shop/orders', { credentials: 'same-origin' });
        const data = await response.json();
        ordersList.innerHTML = '';
        if (!data.orders || data.orders.length === 0) {
            ordersList.appendChild(el('p', 'cart-empty', 'You have not placed any orders yet.'));
            return;
        }
        data.orders.forEach((order) => {
            const card = el('div', 'order-card');
            const top = el('div', 'order-top');
            top.appendChild(el('strong', '', 'Order #' + order.id));
            top.appendChild(el('span', 'status-pill status-' + order.status, order.status));
            card.appendChild(top);
            card.appendChild(el('div', 'order-items', order.items.map((i) => i.quantity + ' x ' + i.name).join(', ')));
            card.appendChild(el('div', 'order-total', money(order.total) + '  |  ' + new Date(order.created_at).toLocaleDateString()));
            ordersList.appendChild(card);
        });
    } catch (err) {
        ordersList.innerHTML = '';
        ordersList.appendChild(el('p', 'cart-empty', 'Could not load your orders.'));
    }
}

cartBtn.addEventListener('click', openCart);
cartClose.addEventListener('click', closeCart);
drawerOverlay.addEventListener('click', closeCart);
ordersBtn.addEventListener('click', openOrders);
ordersClose.addEventListener('click', () => { ordersModal.hidden = true; });
ordersModal.addEventListener('click', (e) => {
    if (e.target === ordersModal) ordersModal.hidden = true;
});
shopSearch.addEventListener('input', renderProducts);

document.getElementById('coName').value = document.body.dataset.name || '';
loadProducts();
