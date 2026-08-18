const siteSocket = io('/site');
const visitorCountEl = document.getElementById('visitorCount');

siteSocket.on('visitor_count', (count) => {
    if (visitorCount) {
        visitorCountEl.innerText = count;
    }
});

siteSocket.on('disconnect', () => {
    if (visitorCountEl) {
        visitorCountEl.innerText = '-';
    }
});