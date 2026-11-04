/* MDW Network Simulator: user interface (uses PTEngine) */
(function () {
    'use strict';
    const E = window.PTEngine;
    const U = E.util;
    const STORE = 'mdw_sim_v1';
    const ICONS = { pc: 'fa-desktop', router: 'fa-route', switch: 'fa-ethernet' };
    const SVGNS = 'http://www.w3.org/2000/svg';

    const $ = (id) => document.getElementById(id);
    const canvas = $('canvas'), nodesBox = $('nodes'), wires = $('wires');
    const hint = $('hint');

    let net = new E.Network();
    let tool = 'select';
    let selected = null;
    let pending = null;          // first device chosen with the cable / ping tools
    let drag = null;
    let animating = false;
    const terms = {};            // per-device terminal buffers

    const HINTS = {
        select: 'Select tool: drag devices to move them. Click a device to configure it.',
        'add-pc': 'Click on the canvas to place a PC.',
        'add-router': 'Click on the canvas to place a router. Its interfaces start shut down: use "no shutdown".',
        'add-switch': 'Click on the canvas to place a switch.',
        cable: 'Cable tool: click the first device, then the second device.',
        ping: 'Ping tool: click the source device, then the destination device.',
        delete: 'Delete tool: click a device or a cable to remove it.'
    };

    /* ---------- storage ---------- */
    function save() {
        try { localStorage.setItem(STORE, JSON.stringify(net.toJSON())); } catch (e) { /* storage unavailable */ }
    }
    function restore() {
        try {
            const raw = localStorage.getItem(STORE);
            if (raw) { net.load(JSON.parse(raw)); return true; }
        } catch (e) { /* ignore */ }
        return false;
    }
    function track(kind) {
        try {
            fetch('/api/pt/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }), keepalive: true });
        } catch (e) { /* analytics are optional */ }
    }

    /* ---------- drawing ---------- */
    function svg(tag, attrs) {
        const n = document.createElementNS(SVGNS, tag);
        Object.keys(attrs || {}).forEach(k => n.setAttribute(k, attrs[k]));
        return n;
    }
    function shortPort(name) {
        return name.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa').replace('Ethernet0', 'Eth0');
    }
    function subLabel(d) {
        if (d.type === 'pc') return d.ip || 'no IP';
        if (d.type === 'router') {
            const up = d.ports.filter(p => p.ip).length;
            return up ? up + ' interface' + (up > 1 ? 's' : '') + ' IP' : 'unconfigured';
        }
        return '8 ports';
    }

    function drawWires() {
        wires.innerHTML = '';
        net.links.forEach(l => {
            const a = net.dev(l.a.d), b = net.dev(l.b.d);
            if (!a || !b) return;
            const pa = net.portOf(a, l.a.p), pb = net.portOf(b, l.b.p);
            const up = !pa.shutdown && !pb.shutdown;
            const line = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wire' + (up ? '' : ' down') });
            line.dataset.id = l.id;
            line.addEventListener('click', (e) => {
                if (tool === 'delete') { net.removeLink(l.id); refresh(); e.stopPropagation(); }
            });
            wires.appendChild(line);
            [[a, b, l.a.p], [b, a, l.b.p]].forEach(([from, to, port]) => {
                const t = 0.2;
                const text = svg('text', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - 5, 'text-anchor': 'middle', class: 'plabel' });
                text.textContent = shortPort(port);
                wires.appendChild(text);
            });
        });
        // pointer events for wires only matter with the delete tool
        wires.style.pointerEvents = 'none';
        wires.querySelectorAll('.wire').forEach(w => { w.style.pointerEvents = tool === 'delete' ? 'stroke' : 'none'; });
    }

    function drawNodes() {
        nodesBox.innerHTML = '';
        net.devices.forEach(d => {
            const n = document.createElement('div');
            n.className = 'node ' + d.type + (selected === d.id ? ' sel' : '') + (pending === d.id ? ' src' : '');
            n.style.left = d.x + 'px';
            n.style.top = d.y + 'px';
            n.dataset.id = d.id;
            n.innerHTML = '<div class="ico"><i class="fa-solid ' + ICONS[d.type] + '"></i></div><div class="lbl"></div><div class="sub"></div>';
            n.querySelector('.lbl').textContent = d.name;
            n.querySelector('.sub').textContent = subLabel(d);
            nodesBox.appendChild(n);
        });
    }

    function refresh() {
        drawWires();
        drawNodes();
        renderInspector();
        save();
    }

    /* ---------- tools ---------- */
    function setTool(name) {
        tool = name;
        pending = null;
        document.querySelectorAll('#tools .tool').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
        canvas.className = 'canvas ' + (name.startsWith('add-') ? 'add' : name);
        hint.textContent = HINTS[name];
        drawNodes();
        drawWires();
    }
    $('tools').addEventListener('click', (e) => {
        const b = e.target.closest('.tool');
        if (b) setTool(b.dataset.tool);
    });

    function canvasPoint(e) {
        const r = canvas.getBoundingClientRect();
        return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
    }

    canvas.addEventListener('pointerdown', (e) => {
        if (animating) return;
        const nodeEl = e.target.closest('.node');
        if (!nodeEl) {
            if (tool.startsWith('add-')) {
                const p = canvasPoint(e);
                const type = tool.slice(4);
                const d = net.addDevice(type, Math.max(48, Math.min(952, p.x)), Math.max(40, Math.min(520, p.y)));
                selected = d.id;
                setTool('select');
                refresh();
                hint.textContent = d.name + ' added. Configure it in the panel, or drag it to move.';
            } else if (tool === 'select') {
                selected = null;
                refresh();
            }
            return;
        }
        const d = net.dev(nodeEl.dataset.id);
        if (tool === 'delete') {
            net.removeDevice(d.id);
            if (selected === d.id) selected = null;
            refresh();
            return;
        }
        if (tool === 'cable') {
            if (!pending) { pending = d.id; drawNodes(); hint.textContent = 'Now click the second device to connect it to ' + d.name + '.'; return; }
            if (pending === d.id) { pending = null; drawNodes(); return; }
            const res = net.connect(pending, d.id);
            pending = null;
            hint.textContent = res.error ? res.error : 'Connected ' + net.dev(res.link.a.d).name + ' ' + shortPort(res.link.a.p) + ' to ' + net.dev(res.link.b.d).name + ' ' + shortPort(res.link.b.p) + '.';
            refresh();
            return;
        }
        if (tool === 'ping') {
            if (!pending) { pending = d.id; drawNodes(); hint.textContent = 'Now click the destination device.'; return; }
            if (pending === d.id) { pending = null; drawNodes(); return; }
            const srcId = pending;
            pending = null;
            drawNodes();
            runPingTool(srcId, d.id);
            return;
        }
        // select + drag
        selected = d.id;
        const p = canvasPoint(e);
        drag = { id: d.id, dx: d.x - p.x, dy: d.y - p.y, moved: false };
        nodeEl.setPointerCapture && nodeEl.setPointerCapture(e.pointerId);
        drawNodes();
        renderInspector();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const d = net.dev(drag.id);
        const p = canvasPoint(e);
        d.x = Math.max(44, Math.min(956, p.x + drag.dx));
        d.y = Math.max(38, Math.min(522, p.y + drag.dy));
        drag.moved = true;
        const el = nodesBox.querySelector('[data-id="' + d.id + '"]');
        if (el) { el.style.left = d.x + 'px'; el.style.top = d.y + 'px'; }
        drawWires();
    });
    function endDrag() {
        if (drag) { const moved = drag.moved; drag = null; if (moved) save(); }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* ---------- packet animation ---------- */
    function animatePath(ids, ok) {
        return new Promise((resolve) => {
            const pts = ids.map(id => net.dev(id)).filter(Boolean);
            if (pts.length < 2) { resolve(); return; }
            animating = true;
            const dot = svg('circle', { r: 7, class: 'pkt', cx: pts[0].x, cy: pts[0].y });
            wires.appendChild(dot);
            let i = 0, start = null;
            const segMs = 380;
            function frame(ts) {
                if (start === null) start = ts;
                const t = Math.min(1, (ts - start) / segMs);
                const a = pts[i], b = pts[i + 1];
                dot.setAttribute('cx', a.x + (b.x - a.x) * t);
                dot.setAttribute('cy', a.y + (b.y - a.y) * t);
                if (t >= 1) {
                    i++; start = null;
                    if (i >= pts.length - 1) {
                        dot.setAttribute('class', 'pkt ' + (ok ? 'ok' : 'fail'));
                        setTimeout(() => { dot.remove(); animating = false; resolve(); }, 350);
                        return;
                    }
                }
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        });
    }
    async function playEcho(r) {
        if (!r || !r.fwd) return;
        const out = r.fwd.hops.slice();
        // when the request never reached the target, show it stopping where it was dropped
        await animatePath(out, r.ok || r.fwd.status === 'delivered');
        if (r.ok && r.back) await animatePath(r.back.hops.slice(), true);
    }

    /* ---------- event log ---------- */
    function log(message, ok) {
        const list = $('logList');
        const empty = list.querySelector('.log-empty');
        if (empty) empty.remove();
        const row = document.createElement('div');
        row.className = ok ? 'ok' : 'bad';
        const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        row.innerHTML = '<b></b> <span></span>';
        row.querySelector('b').textContent = ok ? 'Success' : 'Failed';
        row.querySelector('span').textContent = t + '  ' + message;
        list.prepend(row);
    }
    $('logClear').addEventListener('click', () => { $('logList').innerHTML = '<div class="log-empty">Ping results appear here.</div>'; });

    function targetIp(dev) {
        const a = net.addresses(dev).find(x => net.portUp(dev, x.port)) || net.addresses(dev)[0];
        return a ? a.ip : '';
    }

    async function runPingTool(srcId, dstId) {
        const src = net.dev(srcId), dst = net.dev(dstId);
        if (src.type === 'switch') { log(src.name + ' is a switch. Choose a PC or router as the source.', false); return; }
        const ip = targetIp(dst);
        if (!ip) { log(dst.name + ' has no IP address to ping.', false); hint.textContent = dst.name + ' has no IP address yet.'; return; }
        if (src.type === 'pc' && !src.ip) { log(src.name + ' has no IP address yet.', false); return; }
        const r = net.echo(srcId, ip);
        track('ping');
        const reasons = { timeout: 'Request timed out.', unreachable: 'Destination host unreachable.', ttl: 'TTL expired in transit.', noip: 'No IP address.' };
        log(src.name + ' to ' + dst.name + ' (' + ip + '): ' + (r.ok ? 'reply received, TTL=' + r.ttl + ', time=' + r.time + 'ms' : reasons[r.reason] || 'Request timed out.'), r.ok);
        hint.textContent = r.ok ? 'Ping succeeded.' : 'Ping failed. Check IP addresses, gateways, cables, shut down ports and routes.';
        await playEcho(r);
    }

    /* ---------- inspector ---------- */
    function termFor(dev) {
        if (!terms[dev.id]) {
            terms[dev.id] = { lines: [{ t: dev.type === 'pc' ? 'MDW PC Command Line 1.0. Type help for commands.' : 'MDW Simulated IOS. Type ? for help.', c: '' }], hist: [], hi: 0 };
        }
        return terms[dev.id];
    }
    function paintTerm(dev) {
        const t = termFor(dev);
        const out = $('termOut');
        out.innerHTML = '';
        t.lines.forEach(l => {
            const div = document.createElement('div');
            if (l.c) div.className = l.c;
            div.textContent = l.t;
            out.appendChild(div);
        });
        out.scrollTop = out.scrollHeight;
        $('termPrompt').textContent = E.prompt(net, dev);
    }

    function statusOf(dev, p) {
        if (p.shutdown) return ['admin down', 'admin'];
        return net.portUp(dev, p) ? ['up', 'up'] : ['down', 'down'];
    }

    function renderPorts(dev) {
        const box = $('portTable');
        box.innerHTML = '';
        if (dev.type === 'pc') { box.hidden = true; return; }
        box.hidden = false;
        const head = document.createElement('div');
        head.className = 'port-row head';
        head.innerHTML = '<span>Port</span><span>IP</span><span>State</span><span></span>';
        box.appendChild(head);
        dev.ports.forEach(p => {
            const row = document.createElement('div');
            row.className = 'port-row';
            const [label, cls] = statusOf(dev, p);
            const name = document.createElement('b'); name.textContent = shortPort(p.name);
            const ip = document.createElement('span'); ip.textContent = dev.type === 'router' ? (p.ip ? p.ip + '/' + U.maskLen(p.mask) : '-') : (net.linkAt(dev.id, p.name) ? 'linked' : '-');
            const st = document.createElement('span'); st.className = 'st ' + cls; st.textContent = label;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = p.shutdown ? 'Enable' : 'Shut';
            btn.addEventListener('click', () => { p.shutdown = !p.shutdown; refresh(); });
            row.append(name, ip, st, btn);
            box.appendChild(row);
        });
    }

    function renderInspector() {
        const dev = selected && net.dev(selected);
        $('inspEmpty').hidden = Boolean(dev);
        $('inspBody').hidden = !dev;
        if (!dev) return;
        $('inspIcon').className = 'fa-solid ' + ICONS[dev.type];
        if (document.activeElement !== $('inspName')) $('inspName').value = dev.name;
        $('inspType').textContent = E.TYPES[dev.type].label;
        const isPc = dev.type === 'pc';
        $('pcForm').hidden = !isPc;
        if (isPc && !$('pcForm').contains(document.activeElement)) {
            $('fIp').value = dev.ip; $('fMask').value = dev.mask; $('fGw').value = dev.gw;
        }
        renderPorts(dev);
        if (dev.id !== renderInspector.last) { paintTerm(dev); renderInspector.last = dev.id; }
        else $('termPrompt').textContent = E.prompt(net, dev);
    }
    renderInspector.last = null;

    $('inspName').addEventListener('input', () => {
        const dev = net.dev(selected);
        if (!dev) return;
        dev.name = $('inspName').value.trim() || dev.name;
        if (dev.hostname !== undefined) dev.hostname = dev.name.replace(/\s+/g, '');
        drawNodes(); save();
    });

    $('fApply').addEventListener('click', () => {
        const dev = net.dev(selected);
        const msg = $('fMsg');
        msg.className = 'form-msg';
        const ip = $('fIp').value.trim(), mask = $('fMask').value.trim(), gw = $('fGw').value.trim();
        if (!ip && !mask && !gw) { dev.ip = ''; dev.mask = ''; dev.gw = ''; msg.textContent = 'IP settings cleared.'; msg.classList.add('ok'); refresh(); return; }
        const err = U.validHost(ip, mask);
        if (err) { msg.textContent = err; return; }
        if (gw && (U.ipToInt(gw) === null || !U.sameSubnet(ip, gw, mask))) { msg.textContent = 'The gateway must be an address in the same network as the PC.'; return; }
        dev.ip = ip; dev.mask = mask; dev.gw = gw;
        msg.textContent = 'Saved.'; msg.classList.add('ok');
        refresh();
    });

    /* ---------- terminal ---------- */
    const input = $('termInput');
    input.addEventListener('keydown', async (e) => {
        const dev = net.dev(selected);
        if (!dev) return;
        const t = termFor(dev);
        if (e.key === 'ArrowUp') { if (t.hi > 0) { t.hi--; input.value = t.hist[t.hi]; } e.preventDefault(); return; }
        if (e.key === 'ArrowDown') { if (t.hi < t.hist.length - 1) { t.hi++; input.value = t.hist[t.hi]; } else { t.hi = t.hist.length; input.value = ''; } e.preventDefault(); return; }
        if (e.key !== 'Enter') return;
        const line = input.value;
        input.value = '';
        if (line.trim()) { t.hist.push(line); t.hi = t.hist.length; }
        t.lines.push({ t: E.prompt(net, dev) + line, c: 'cmd' });
        const res = E.execute(net, dev.id, line) || { text: '' };
        if (res.clear) t.lines = [];
        if (res.text) t.lines.push({ t: res.text, c: '' });
        if (t.lines.length > 400) t.lines = t.lines.slice(-300);
        paintTerm(dev);
        if (res.changed !== undefined || res.text !== undefined) { drawNodes(); renderPorts(dev); if (dev.type === 'pc') { $('fIp').value = dev.ip; $('fMask').value = dev.mask; $('fGw').value = dev.gw; } save(); drawWires(); }
        if (res.animate) {
            if (/^\s*(ping|tracert|traceroute)/i.test(line)) track('ping');
            const a = res.animate;
            await playEcho(a.fwd && !a.back && a.ok === undefined ? { ok: a.fwd.status === 'delivered', fwd: a.fwd } : a);
        }
    });
    $('termOut').addEventListener('click', () => input.focus());
    $('termClear').addEventListener('click', () => {
        const dev = net.dev(selected);
        if (dev) { termFor(dev).lines = []; paintTerm(dev); }
    });

    /* ---------- presets, import/export ---------- */
    const presets = E.buildPresets();
    const sel = $('presetSelect');
    Object.keys(presets).forEach(k => {
        const o = document.createElement('option');
        o.value = k; o.textContent = presets[k].title;
        sel.appendChild(o);
    });
    function loadPreset(key) {
        const p = presets[key];
        if (!p) return;
        net.load(JSON.parse(JSON.stringify(p.data)));
        selected = null; renderInspector.last = null;
        Object.keys(terms).forEach(k => delete terms[k]);
        refresh();
        hint.textContent = p.note;
        log('Loaded sample lab: ' + p.title + '. ' + p.note, true);
    }
    sel.addEventListener('change', () => { if (sel.value) loadPreset(sel.value); sel.value = ''; });

    $('clearBtn').addEventListener('click', () => {
        if (net.devices.length && !confirm('Remove all devices and cables?')) return;
        net.load({ devices: [], links: [] });
        selected = null; renderInspector.last = null;
        Object.keys(terms).forEach(k => delete terms[k]);
        refresh();
    });
    $('exportBtn').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(net.toJSON(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mdw-topology.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('importFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 1024 * 1024) { alert('That file is too large to be a topology.'); return; }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data.devices) || !Array.isArray(data.links)) throw new Error('shape');
                const ok = data.devices.every(d => d && E.TYPES[d.type] && typeof d.id === 'string' && Array.isArray(d.ports) && isFinite(d.x) && isFinite(d.y));
                if (!ok) throw new Error('shape');
                net.load(data);
                selected = null; renderInspector.last = null;
                refresh();
                log('Imported ' + file.name, true);
            } catch (err) {
                alert('This file is not a valid MDW topology.');
            }
        };
        reader.readAsText(file);
    });

    $('logList').addEventListener('click', () => {});

    /* ---------- start ---------- */
    const wanted = new URLSearchParams(location.search).get('preset');
    if (wanted && presets[wanted]) loadPreset(wanted);
    else if (!restore() || !net.devices.length) loadPreset('routed_lans');
    else refresh();
    track('sim_open');
    setTool('select');
})();
