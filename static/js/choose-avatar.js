const avatarPreview = document.getElementById('avatarPreview');
const avatarGrid = document.getElementById('avatarGrid');
const avatarFile = document.getElementById('avatarFile');
const uploadBtn = document.getElementById('uploadBtn');
const saveAvatarBtn = document.getElementById('saveAvatarBtn');
const avatarError = document.getElementById('avatarError');
const nextUrl = document.body.dataset.next || '/dashboard';

let selected = null;

function showAvatarError(message) {
    avatarError.innerText = message;
    avatarError.classList.add('show-error');
}

function clearAvatarError() {
    avatarError.innerText = '';
    avatarError.classList.remove('show-error');
}

function markSelected(key) {
    avatarGrid.querySelectorAll('.avatar-option').forEach((option) => {
        option.classList.toggle('selected', option.dataset.key === key);
    });
}

avatarGrid.addEventListener('click', (e) => {
    const option = e.target.closest('.avatar-option');
    if (!option) return;
    clearAvatarError();
    selected = { value: option.dataset.key };
    markSelected(option.dataset.key);
    avatarPreview.src = '/avatars/' + option.dataset.key + '.svg';
});

uploadBtn.addEventListener('click', () => avatarFile.click());

function cropToSquare(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            const size = 192;
            const side = Math.min(image.width, image.height);
            const sx = (image.width - side) / 2;
            const sy = (image.height - side) / 2;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            canvas.getContext('2d').drawImage(image, sx, sy, side, side, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('unreadable'));
        };
        image.src = url;
    });
}

avatarFile.addEventListener('change', async () => {
    const file = avatarFile.files[0];
    avatarFile.value = '';
    if (!file) return;
    clearAvatarError();

    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
        showAvatarError('Upload a PNG, JPEG, or WebP image.');
        return;
    }
    if (file.size > 8 * 1024 * 1024) {
        showAvatarError('That image is too large. Choose one under 8 MB.');
        return;
    }

    try {
        const dataUrl = await cropToSquare(file);
        selected = { value: dataUrl };
        markSelected(null);
        avatarPreview.src = dataUrl;
    } catch (err) {
        showAvatarError('That image could not be read. Try a different one.');
    }
});

saveAvatarBtn.addEventListener('click', async () => {
    clearAvatarError();
    if (!selected) {
        showAvatarError('Choose an avatar or upload a photo first.');
        return;
    }

    saveAvatarBtn.disabled = true;
    saveAvatarBtn.innerText = 'Saving...';

    try {
        const response = await fetch('/api/profile/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ avatar: selected.value })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            window.location.href = nextUrl;
            return;
        }
        showAvatarError(data.message || 'Could not save your avatar.');
    } catch (err) {
        showAvatarError('Unable to reach the server. Please try again.');
    }

    saveAvatarBtn.disabled = false;
    saveAvatarBtn.innerText = 'Save and continue';
});

markSelected(document.body.dataset.current);
