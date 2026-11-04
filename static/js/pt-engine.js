/* MDW Network Simulator engine: devices, links, L2 reachability, static routing, ping/tracert and an IOS-style CLI.
   Pure logic, no DOM, so it can be unit-tested in Node. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PTEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ---------------- IP helpers ---------------- */
    function ipToInt(ip) {
        const p = String(ip || '').trim().split('.');
        if (p.length !== 4) return null;
        let n = 0;
        for (const part of p) {
            if (!/^\d{1,3}$/.test(part)) return null;
            const v = Number(part);
            if (v > 255) return null;
            n = n * 256 + v;
        }
        return n;
    }
    function intToIp(n) {
        return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
    function maskLen(mask) {
        const n = ipToInt(mask);
        if (n === null) return null;
        let bits = 0, seenZero = false;
        for (let i = 31; i >= 0; i--) {
            if ((n >>> i) & 1) { if (seenZero) return null; bits++; } else seenZero = true;
        }
        return bits;
    }
    function lenToMask(len) {
        return len === 0 ? '0.0.0.0' : intToIp((0xFFFFFFFF << (32 - len)) >>> 0);
    }
    function netOf(ip, mask) {
        return ((ipToInt(ip) & ipToInt(mask)) >>> 0);
    }
    function sameSubnet(ipA, ipB, mask) {
        return netOf(ipA, mask) === netOf(ipB, mask);
    }
    function validHost(ip, mask) {
        const i = ipToInt(ip), m = ipToInt(mask);
        if (i === null || m === null || maskLen(mask) === null) return 'Invalid address or mask.';
        const len = maskLen(mask);
        if (len >= 31) return null;
        const net = (i & m) >>> 0;
        const bcast = (net | (~m >>> 0)) >>> 0;
        if (i === net) return 'That is the network address, not a host address.';
        if (i === bcast) return 'That is the broadcast address, not a host address.';
        return null;
    }

    /* ---------------- Devices ---------------- */
    const TYPES = {
        pc: { label: 'PC', ttl: 128, ports: () => [{ name: 'Ethernet0' }] },
        router: { label: 'Router', ttl: 255, ports: () => ['0/0', '0/1', '0/2'].map(n => ({ name: 'GigabitEthernet' + n, shutdown: true, ip: '', mask: '', desc: '' })) },
        switch: { label: 'Switch', ttl: 255, ports: () => [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ name: 'FastEthernet0/' + n, shutdown: false, desc: '' })) }
    };

    function createDevice(type, id, name, x, y) {
        const t = TYPES[type];
        const dev = { id, type, name, x, y, ports: t.ports() };
        if (type === 'pc') { dev.ip = ''; dev.mask = ''; dev.gw = ''; }
        if (type === 'router' || type === 'switch') { dev.hostname = name; dev.routes = []; }
        return dev;
    }

    function Network(data) {
        this.devices = [];
        this.links = [];
        this.nextId = 1;
        this.nextLink = 1;
        this.cli = {};
        if (data) this.load(data);
    }

    Network.prototype.load = function (data) {
        this.devices = JSON.parse(JSON.stringify(data.devices || []));
        this.links = JSON.parse(JSON.stringify(data.links || []));
        this.nextId = this.devices.reduce((m, d) => Math.max(m, Number(String(d.id).replace(/\D/g, '')) || 0), 0) + 1;
        this.nextLink = this.links.reduce((m, l) => Math.max(m, Number(String(l.id).replace(/\D/g, '')) || 0), 0) + 1;
        this.cli = {};
    };
    Network.prototype.toJSON = function () {
        return { devices: this.devices, links: this.links };
    };
    Network.prototype.dev = function (id) {
        return this.devices.find(d => d.id === id) || null;
    };
    Network.prototype.addDevice = function (type, x, y) {
        const count = this.devices.filter(d => d.type === type).length + 1;
        const prefix = { pc: 'PC', router: 'Router', switch: 'Switch' }[type];
        const dev = createDevice(type, 'd' + this.nextId++, prefix + count, x, y);
        this.devices.push(dev);
        return dev;
    };
    Network.prototype.removeDevice = function (id) {
        this.devices = this.devices.filter(d => d.id !== id);
        this.links = this.links.filter(l => l.a.d !== id && l.b.d !== id);
        delete this.cli[id];
    };
    Network.prototype.portOf = function (dev, name) {
        return dev.ports.find(p => p.name === name) || null;
    };
    Network.prototype.linkAt = function (devId, portName) {
        return this.links.find(l => (l.a.d === devId && l.a.p === portName) || (l.b.d === devId && l.b.p === portName)) || null;
    };
    Network.prototype.freePort = function (dev) {
        return dev.ports.find(p => !this.linkAt(dev.id, p.name)) || null;
    };
    Network.prototype.connect = function (idA, idB, portA, portB) {
        const a = this.dev(idA), b = this.dev(idB);
        if (!a || !b || a === b) return { error: 'Choose two different devices.' };
        const pa = portA ? this.portOf(a, portA) : this.freePort(a);
        const pb = portB ? this.portOf(b, portB) : this.freePort(b);
        if (!pa) return { error: a.name + ' has no free port.' };
        if (!pb) return { error: b.name + ' has no free port.' };
        if (this.linkAt(a.id, pa.name) || this.linkAt(b.id, pb.name)) return { error: 'That port is already in use.' };
        const link = { id: 'l' + this.nextLink++, a: { d: a.id, p: pa.name }, b: { d: b.id, p: pb.name } };
        this.links.push(link);
        return { link };
    };
    Network.prototype.removeLink = function (id) {
        this.links = this.links.filter(l => l.id !== id);
    };
    Network.prototype.peer = function (devId, portName) {
        const l = this.linkAt(devId, portName);
        if (!l) return null;
        return l.a.d === devId && l.a.p === portName ? l.b : l.a;
    };
    Network.prototype.portUp = function (dev, port) {
        if (port.shutdown) return false;
        const far = this.peer(dev.id, port.name);
        if (!far) return false;
        const farDev = this.dev(far.d);
        const farPort = farDev && this.portOf(farDev, far.p);
        return Boolean(farPort && !farPort.shutdown);
    };

    /* Addresses a device answers to, as [{port, ip, mask}] */
    Network.prototype.addresses = function (dev) {
        if (dev.type === 'pc') return dev.ip && dev.mask ? [{ port: dev.ports[0], ip: dev.ip, mask: dev.mask }] : [];
        if (dev.type === 'router') return dev.ports.filter(p => p.ip && p.mask).map(p => ({ port: p, ip: p.ip, mask: p.mask }));
        return [];
    };

    /* Routing table of a router: connected + installed static routes */
    Network.prototype.routingTable = function (dev) {
        const table = [];
        dev.ports.forEach(p => {
            if (p.ip && p.mask && this.portUp(dev, p)) {
                table.push({ code: 'C', net: netOf(p.ip, p.mask), len: maskLen(p.mask), port: p });
            }
        });
        (dev.routes || []).forEach(r => {
            const via = table.find(t => t.code === 'C' && netOf(r.nh, lenToMask(t.len)) === t.net);
            if (via) table.push({ code: 'S', net: netOf(r.net, r.mask), len: maskLen(r.mask), nh: r.nh, port: via.port });
        });
        return table;
    };

    /* Layer 2: find the device holding `ip` that is reachable from (devId, portName) through switches. */
    Network.prototype.resolve = function (devId, portName, ip) {
        const start = this.dev(devId);
        const sPort = this.portOf(start, portName);
        if (!sPort || !this.portUp(start, sPort)) return null;
        const far = this.peer(devId, portName);
        const seen = new Set([devId]);
        const queue = [{ d: far.d, p: far.p, path: [devId] }];
        while (queue.length) {
            const cur = queue.shift();
            if (seen.has(cur.d)) continue;
            seen.add(cur.d);
            const dev = this.dev(cur.d);
            const path = cur.path.concat(dev.id);
            if (dev.type === 'switch') {
                dev.ports.forEach(p => {
                    if (p.name === cur.p || !this.portUp(dev, p)) return;
                    const next = this.peer(dev.id, p.name);
                    if (next) queue.push({ d: next.d, p: next.p, path });
                });
                continue;
            }
            const inPort = this.portOf(dev, cur.p);
            if (inPort.shutdown) continue;
            const hit = this.addresses(dev).find(a => a.port === inPort && a.ip === ip);
            if (hit) return { dev, port: inPort, path };
        }
        return null;
    };

    /* Send one packet from `src` to `dstIp`. Returns the outcome and the device path walked. */
    Network.prototype.send = function (srcId, dstIp, ttl) {
        const src = this.dev(srcId);
        const out = { status: 'timeout', hops: [srcId], srcIp: '', routers: 0 };
        let cur = src;
        let ttlLeft = ttl || TYPES[src.type].ttl;
        let inIp = '';
        for (let guard = 0; guard < 40; guard++) {
            if (cur.type === 'pc') {
                if (!cur.ip || !cur.mask) { out.status = 'noip'; return out; }
                if (cur === src) out.srcIp = cur.ip;
                if (dstIp === cur.ip) { out.status = 'delivered'; out.dst = cur; out.ttlLeft = ttlLeft; return out; }
                let nextHop;
                if (sameSubnet(cur.ip, dstIp, cur.mask)) nextHop = dstIp;
                else if (cur.gw) nextHop = cur.gw;
                else { out.status = 'unreachable'; out.by = cur; out.replyIp = cur.ip; return out; }
                const hit = this.resolve(cur.id, cur.ports[0].name, nextHop);
                if (!hit) { out.status = 'timeout'; return out; }
                hit.path.slice(1).forEach(id => out.hops.push(id));
                if (hit.dev.type === 'pc') {
                    if (hit.dev.ip === dstIp) { out.status = 'delivered'; out.dst = hit.dev; out.ttlLeft = ttlLeft; return out; }
                    out.status = 'timeout'; return out;
                }
                cur = hit.dev; inIp = hit.port.ip; continue;
            }
            if (cur.type === 'router') {
                const own = this.addresses(cur).find(a => a.ip === dstIp && this.portUp(cur, a.port));
                if (own) { out.status = 'delivered'; out.dst = cur; out.ttlLeft = ttlLeft; return out; }
                if (cur !== src) {
                    ttlLeft -= 1;
                    out.routers += 1;
                    if (ttlLeft <= 0) { out.status = 'ttl'; out.by = cur; out.replyIp = inIp; return out; }
                }
                const table = this.routingTable(cur).filter(r => netOf(dstIp, lenToMask(r.len)) === r.net);
                table.sort((a, b) => b.len - a.len || (a.code === 'C' ? -1 : 1));
                const route = table[0];
                if (!route) { out.status = 'unreachable'; out.by = cur; out.replyIp = inIp || (this.addresses(cur)[0] || {}).ip || ''; return out; }
                if (cur === src) out.srcIp = route.port.ip;
                const nextHop = route.code === 'C' ? dstIp : route.nh;
                const hit = this.resolve(cur.id, route.port.name, nextHop);
                if (!hit) { out.status = cur === src ? 'timeout' : 'unreachable'; out.by = cur; out.replyIp = inIp; if (cur === src) out.status = 'timeout'; return out; }
                hit.path.slice(1).forEach(id => out.hops.push(id));
                if (hit.dev.type === 'pc') {
                    if (hit.dev.ip === dstIp) { out.status = 'delivered'; out.dst = hit.dev; out.ttlLeft = ttlLeft; return out; }
                    out.status = 'timeout'; return out;
                }
                cur = hit.dev; inIp = hit.port.ip; continue;
            }
            out.status = 'timeout'; return out;
        }
        out.status = 'ttl'; out.by = cur; out.replyIp = inIp;
        return out;
    };

    /* Full echo: request + reply. */
    Network.prototype.echo = function (srcId, dstIp, ttl) {
        const fwd = this.send(srcId, dstIp, ttl);
        if (fwd.status !== 'delivered') return { ok: false, fwd, reason: fwd.status };
        const back = this.send(fwd.dst.id, fwd.srcIp);
        if (back.status !== 'delivered') return { ok: false, fwd, back, reason: 'timeout' };
        const hopsCount = fwd.hops.length + back.hops.length;
        return { ok: true, fwd, back, ttl: back.ttlLeft, time: Math.max(1, Math.round(hopsCount * 1.5)) };
    };

    /* ---------------- Formatting helpers ---------------- */
    function pad(s, n) { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); }

    function pcPing(net, pc, target) {
        const lines = ['', 'Pinging ' + target + ' with 32 bytes of data:', ''];
        let animate = null, sent = 0, got = 0;
        for (let i = 0; i < 4; i++) {
            const r = net.echo(pc.id, target);
            sent++;
            if (i === 0) animate = r;
            if (r.ok) {
                got++;
                lines.push('Reply from ' + target + ': bytes=32 time=' + r.time + 'ms TTL=' + r.ttl);
            } else if (r.reason === 'noip') {
                lines.push('Ping request could not find host. This PC has no IP address.');
                break;
            } else if (r.reason === 'unreachable') {
                lines.push('Reply from ' + (r.fwd.replyIp || pc.ip) + ': Destination host unreachable.');
            } else if (r.reason === 'ttl') {
                lines.push('Reply from ' + (r.fwd.replyIp || '?') + ': TTL expired in transit.');
            } else lines.push('Request timed out.');
        }
        if (sent) {
            lines.push('', 'Ping statistics for ' + target + ':',
                '    Packets: Sent = ' + sent + ', Received = ' + got + ', Lost = ' + (sent - got) + ' (' + Math.round((sent - got) / sent * 100) + '% loss)');
        }
        return { text: lines.join('\n'), animate };
    }

    function ciscoPing(net, dev, target) {
        let line = '', got = 0, animate = null;
        for (let i = 0; i < 5; i++) {
            const r = net.echo(dev.id, target);
            if (i === 0) animate = r;
            if (r.ok) { got++; line += '!'; } else line += r.reason === 'unreachable' ? 'U' : '.';
        }
        const text = 'Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ' + target + ', timeout is 2 seconds:\n' + line +
            '\nSuccess rate is ' + Math.round(got / 5 * 100) + ' percent (' + got + '/5)' + (got ? ', round-trip min/avg/max = 1/2/4 ms' : '');
        return { text, animate };
    }

    function tracert(net, dev, target, windows) {
        const lines = windows ? ['', 'Tracing route to ' + target + ' over a maximum of 30 hops:', ''] : ['Type escape sequence to abort.', 'Tracing the route to ' + target, ''];
        let animate = null;
        for (let ttl = 1; ttl <= 30; ttl++) {
            const r = net.send(dev.id, target, ttl + (dev.type === 'pc' ? 0 : 0));
            if (!animate || r.status === 'delivered') animate = { ok: r.status === 'delivered', fwd: r };
            let who = '';
            if (r.status === 'delivered') who = target;
            else if (r.status === 'ttl' || r.status === 'unreachable') who = r.replyIp || '*';
            else who = '*';
            const stamp = who === '*' ? '*' : '<1 ms';
            lines.push(windows ? ('  ' + pad(ttl, 4) + pad(stamp, 8) + (who === '*' ? 'Request timed out.' : who)) : (' ' + pad(ttl, 3) + (who === '*' ? '* * *' : who + '  ' + stamp)));
            if (r.status === 'delivered') { lines.push('', windows ? 'Trace complete.' : ''); break; }
            if (r.status !== 'ttl') { if (who === '*') lines.push(''); break; }
        }
        return { text: lines.join('\n'), animate };
    }

    /* ---------------- PC command line ---------------- */
    function pcCommand(net, dev, line) {
        const t = line.trim().split(/\s+/);
        const cmd = (t[0] || '').toLowerCase();
        if (!cmd) return { text: '' };
        if (cmd === 'help' || cmd === '?') {
            return { text: 'Commands:\n  ipconfig                       show the IP settings\n  ip <ip> <mask> [gateway]       set the IP settings\n  ping <ip>                      send 4 echo requests\n  tracert <ip>                   trace the route to a host\n  hostname <name>                rename this PC\n  cls                            clear the screen' };
        }
        if (cmd === 'cls' || cmd === 'clear') return { clear: true };
        if (cmd === 'ipconfig') {
            if (!dev.ip) return { text: '\nEthernet adapter Ethernet0:\n\n   IPv4 Address. . . . . . . . . . : (not set)\n   Subnet Mask . . . . . . . . . . : (not set)\n   Default Gateway . . . . . . . . : (not set)' };
            return { text: '\nEthernet adapter Ethernet0:\n\n   IPv4 Address. . . . . . . . . . : ' + dev.ip + '\n   Subnet Mask . . . . . . . . . . : ' + dev.mask + '\n   Default Gateway . . . . . . . . : ' + (dev.gw || '(not set)'), changed: false };
        }
        if (cmd === 'ip') {
            const err = validHost(t[1], t[2]);
            if (!t[1] || !t[2]) return { text: 'Usage: ip <ip> <mask> [gateway]' };
            if (err) return { text: err };
            if (t[3] && (ipToInt(t[3]) === null || !sameSubnet(t[1], t[3], t[2]))) return { text: 'The gateway must be an address in the same network.' };
            dev.ip = t[1]; dev.mask = t[2]; dev.gw = t[3] || '';
            return { text: 'IP address set to ' + dev.ip + ' ' + dev.mask + (dev.gw ? ' gateway ' + dev.gw : ''), changed: true };
        }
        if (cmd === 'hostname' && t[1]) { dev.name = t[1].slice(0, 20); return { text: '', changed: true }; }
        if (cmd === 'ping' || cmd === 'tracert') {
            if (!t[1] || ipToInt(t[1]) === null) return { text: 'Usage: ' + cmd + ' <ip address>' };
            if (!dev.ip) return { text: 'This PC has no IP address yet. Use: ip <ip> <mask> [gateway]' };
            return cmd === 'ping' ? pcPing(net, dev, t[1]) : tracert(net, dev, t[1], true);
        }
        return { text: "'" + t[0] + "' is not recognized. Type help for the list of commands." };
    }

    /* ---------------- IOS-style command line ---------------- */
    const IFACE_TYPES = { gigabitethernet: 'GigabitEthernet', gi: 'GigabitEthernet', gig: 'GigabitEthernet', g: 'GigabitEthernet', fastethernet: 'FastEthernet', fa: 'FastEthernet', f: 'FastEthernet', ethernet: 'FastEthernet' };

    function findInterface(dev, tokens) {
        const joined = tokens.join('').toLowerCase();
        const m = joined.match(/^([a-z]+)(\d+\/\d+)$/);
        if (!m || !IFACE_TYPES[m[1]]) return null;
        const full = IFACE_TYPES[m[1]] + m[2];
        return dev.ports.find(p => p.name === full) || null;
    }

    function kw(tok, word, min) {
        if (!tok) return false;
        tok = tok.toLowerCase();
        return tok.length >= (min || 1) && word.indexOf(tok) === 0;
    }

    function shortName(name) {
        return name.replace('GigabitEthernet', 'Gi').replace('FastEthernet', 'Fa');
    }

    function ifaceStatus(net, dev, p) {
        if (p.shutdown) return ['administratively down', 'down'];
        return net.portUp(dev, p) ? ['up', 'up'] : ['down', 'down'];
    }

    function showIpIntBrief(net, dev) {
        const rows = ['Interface              IP-Address      OK? Method Status                Protocol'];
        dev.ports.forEach(p => {
            const [st, pr] = ifaceStatus(net, dev, p);
            const ip = p.ip || 'unassigned';
            rows.push(pad(p.name, 23) + pad(ip, 16) + 'YES ' + pad(p.ip ? 'manual' : 'unset', 7) + pad(st, 22) + pr);
        });
        return rows.join('\n');
    }

    function showIpRoute(net, dev) {
        const rows = ['Codes: C - connected, S - static', '', 'Gateway of last resort is not set', ''];
        const table = net.routingTable(dev).sort((a, b) => a.net - b.net);
        if (!table.length) rows.push('(the routing table is empty)');
        table.forEach(r => {
            const cidr = intToIp(r.net) + '/' + r.len;
            if (r.code === 'C') rows.push('C    ' + cidr + ' is directly connected, ' + r.port.name);
            else rows.push('S    ' + cidr + ' [1/0] via ' + r.nh);
        });
        return rows.join('\n');
    }

    function runningConfig(dev) {
        const out = ['Building configuration...', '', 'hostname ' + dev.hostname, '!'];
        dev.ports.forEach(p => {
            out.push('interface ' + p.name);
            if (p.desc) out.push(' description ' + p.desc);
            if (dev.type === 'router') out.push(p.ip ? ' ip address ' + p.ip + ' ' + p.mask : ' no ip address');
            out.push(p.shutdown ? ' shutdown' : ' no shutdown');
            out.push('!');
        });
        (dev.routes || []).forEach(r => out.push('ip route ' + r.net + ' ' + r.mask + ' ' + r.nh));
        out.push('!', 'end');
        return out.join('\n');
    }

    function cliState(net, dev) {
        if (!net.cli[dev.id]) net.cli[dev.id] = { mode: 'user', iface: null };
        return net.cli[dev.id];
    }

    function prompt(net, dev) {
        if (dev.type === 'pc') return 'C:\\>';
        const st = cliState(net, dev);
        const h = dev.hostname;
        return { user: h + '>', priv: h + '#', config: h + '(config)#', if: h + '(config-if)#' }[st.mode];
    }

    function iosCommand(net, dev, line) {
        const st = cliState(net, dev);
        const raw = line.trim();
        if (!raw) return { text: '' };
        const t = raw.split(/\s+/);
        const c0 = t[0].toLowerCase();
        const isRouter = dev.type === 'router';
        const incomplete = '% Incomplete command.';
        const invalid = "% Invalid input detected. Type '?' for the list of commands.";

        if (c0 === '?' || c0 === 'help') {
            const help = {
                user: 'Exec commands:\n  enable    Turn on privileged commands\n  ping      Send echo messages\n  show      Show running system information\n  exit      Exit from the EXEC',
                priv: 'Exec commands:\n  configure   Enter configuration mode\n  disable     Turn off privileged commands\n  ping        Send echo messages\n  show        Show running system information\n  traceroute  Trace route to destination\n  write       Save the configuration\n  exit        Exit from the EXEC',
                config: 'Configure commands:\n  hostname    Set the system name\n  interface   Select an interface to configure\n  ip          Global IP configuration (ip route)\n  no          Negate a command\n  end         Return to privileged mode\n  exit        Exit from configure mode',
                if: 'Interface commands:\n  description  Interface description\n  ip           Interface IP configuration (ip address)\n  shutdown     Shut down the interface\n  no           Negate a command\n  exit         Exit from interface mode\n  end          Return to privileged mode'
            };
            return { text: help[st.mode] };
        }

        /* navigation */
        if (kw(c0, 'exit', 2) || c0 === 'end' || c0 === 'logout') {
            if (c0 === 'end') { if (st.mode === 'config' || st.mode === 'if') st.mode = 'priv'; return { text: '' }; }
            if (st.mode === 'if') st.mode = 'config';
            else if (st.mode === 'config') st.mode = 'priv';
            else if (st.mode === 'priv') st.mode = 'user';
            return { text: '' };
        }
        if (st.mode === 'user') {
            if (kw(c0, 'enable', 2)) { st.mode = 'priv'; return { text: '' }; }
        }
        if (st.mode === 'priv' || st.mode === 'user') {
            if (kw(c0, 'disable', 4) && st.mode === 'priv') { st.mode = 'user'; return { text: '' }; }
            if (kw(c0, 'configure', 4) && st.mode === 'priv') {
                if (t[1] && !kw(t[1], 'terminal', 1)) return { text: invalid };
                st.mode = 'config';
                return { text: 'Enter configuration commands, one per line.  End with CNTL/Z.' };
            }
            if (kw(c0, 'ping', 2)) {
                if (!t[1]) return { text: incomplete };
                if (ipToInt(t[1]) === null) return { text: '% Unrecognized host or address, or protocol not running.' };
                if (!isRouter) return { text: 'Ping from a switch needs a management IP (not supported here). Use a PC or router.' };
                return ciscoPing(net, dev, t[1]);
            }
            if (kw(c0, 'traceroute', 5)) {
                if (!t[1] || ipToInt(t[1]) === null) return { text: incomplete };
                if (!isRouter) return { text: 'Traceroute from a switch is not supported here. Use a PC or router.' };
                return tracert(net, dev, t[1], false);
            }
            if (kw(c0, 'write', 1) || kw(c0, 'copy', 2)) {
                return { text: 'Building configuration...\n[OK]' };
            }
            if (kw(c0, 'show', 2)) {
                if (kw(t[1], 'running-config', 1) && st.mode === 'priv') return { text: runningConfig(dev) };
                if (kw(t[1], 'ip', 2) && kw(t[2], 'interface', 1) && kw(t[3], 'brief', 1)) return { text: showIpIntBrief(net, dev) };
                if (kw(t[1], 'ip', 2) && kw(t[2], 'route', 1)) {
                    if (!isRouter) return { text: '% This switch does not route. Use a router.' };
                    return { text: showIpRoute(net, dev) };
                }
                if (kw(t[1], 'interfaces', 1) && (!t[2] || kw(t[2], 'status', 1))) {
                    const rows = ['Port      Status        Description'];
                    dev.ports.forEach(p => {
                        const [st1] = ifaceStatus(net, dev, p);
                        rows.push(pad(shortName(p.name), 10) + pad(st1 === 'up' ? 'connected' : st1 === 'down' ? 'notconnect' : 'disabled', 14) + (p.desc || ''));
                    });
                    return { text: rows.join('\n') };
                }
                if (kw(t[1], 'version', 1)) return { text: 'MDW Simulated IOS, ' + (isRouter ? 'Router' : 'Switch') + ' ' + dev.hostname };
                if (!t[1]) return { text: incomplete };
                return { text: invalid };
            }
            return { text: st.mode === 'user' ? invalid : invalid };
        }

        if (st.mode === 'config') {
            if (kw(c0, 'hostname', 1)) {
                if (!t[1]) return { text: incomplete };
                dev.hostname = t[1].slice(0, 20);
                dev.name = dev.hostname;
                return { text: '', changed: true };
            }
            if (kw(c0, 'interface', 3)) {
                const p = findInterface(dev, t.slice(1));
                if (!t[1]) return { text: incomplete };
                if (!p) return { text: "% Invalid interface. Example: interface " + shortName(dev.ports[0].name).toLowerCase() };
                st.mode = 'if'; st.iface = p.name;
                return { text: '' };
            }
            if (kw(c0, 'no', 2) && kw(t[1], 'ip', 2) && kw(t[2], 'route', 1)) {
                if (!isRouter) return { text: invalid };
                if (ipToInt(t[3]) === null || maskLen(t[4]) === null || ipToInt(t[5]) === null) return { text: incomplete };
                const before = dev.routes.length;
                dev.routes = dev.routes.filter(r => !(r.net === t[3] && r.mask === t[4] && r.nh === t[5]));
                return { text: before === dev.routes.length ? '% No matching route to delete' : '', changed: true };
            }
            if (kw(c0, 'ip', 2) && kw(t[1], 'route', 1)) {
                if (!isRouter) return { text: '% This switch does not route.' };
                if (t.length < 5) return { text: incomplete };
                if (ipToInt(t[2]) === null || maskLen(t[3]) === null || ipToInt(t[4]) === null) return { text: '% Invalid network, mask or next hop.' };
                const netAddr = intToIp(netOf(t[2], t[3]));
                if (netAddr !== t[2]) return { text: '% Inconsistent address and mask' };
                if (!dev.routes.some(r => r.net === t[2] && r.mask === t[3] && r.nh === t[4])) dev.routes.push({ net: t[2], mask: t[3], nh: t[4] });
                return { text: '', changed: true };
            }
            if (c0 === 'enable' || c0 === 'service' || c0 === 'banner' || c0 === 'line' || (c0 === 'no' && kw(t[1], 'ip', 2))) return { text: '' };
            return { text: invalid };
        }

        if (st.mode === 'if') {
            const p = dev.ports.find(x => x.name === st.iface);
            if (kw(c0, 'interface', 3)) {
                const q = findInterface(dev, t.slice(1));
                if (!q) return { text: '% Invalid interface.' };
                st.iface = q.name;
                return { text: '' };
            }
            if (kw(c0, 'shutdown', 2)) { p.shutdown = true; return { text: '%LINK-5-CHANGED: Interface ' + p.name + ', changed state to administratively down', changed: true }; }
            if (c0 === 'no' && kw(t[1], 'shutdown', 2)) {
                p.shutdown = false;
                const up = net.portUp(dev, p);
                return { text: up ? '%LINK-5-CHANGED: Interface ' + p.name + ', changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ' + p.name + ', changed state to up' : '%LINK-5-CHANGED: Interface ' + p.name + ', changed state to down', changed: true };
            }
            if (kw(c0, 'description', 1)) { p.desc = t.slice(1).join(' ').slice(0, 60); return { text: '', changed: true }; }
            if (kw(c0, 'ip', 2) && kw(t[1], 'address', 1)) {
                if (!isRouter) return { text: '% This switch port is layer 2; configure the IP on a router interface.' };
                if (t.length < 4) return { text: incomplete };
                const err = validHost(t[2], t[3]);
                if (err) return { text: '% ' + err };
                const clash = dev.ports.find(x => x !== p && x.ip && x.mask && netOf(x.ip, x.mask) === netOf(t[2], t[3]));
                if (clash) return { text: '% ' + t[2] + ' overlaps with ' + clash.name };
                p.ip = t[2]; p.mask = t[3];
                return { text: '', changed: true };
            }
            if (c0 === 'no' && kw(t[1], 'ip', 2) && kw(t[2], 'address', 1)) { p.ip = ''; p.mask = ''; return { text: '', changed: true }; }
            if (c0 === 'switchport' || c0 === 'duplex' || c0 === 'speed' || (c0 === 'no' && kw(t[1], 'description', 1))) {
                if (c0 === 'no') p.desc = '';
                return { text: '' };
            }
            return { text: invalid };
        }
        return { text: invalid };
    }

    function execute(net, devId, line) {
        const dev = net.dev(devId);
        if (!dev) return { text: '' };
        return dev.type === 'pc' ? pcCommand(net, dev, line) : iosCommand(net, dev, line);
    }

    /* ---------------- Sample labs ---------------- */
    function buildPresets() {
        function mk(type, id, name, x, y) { return createDevice(type, id, name, x, y); }
        function up(dev, portIdx, ip, mask) { const p = dev.ports[portIdx]; p.ip = ip; p.mask = mask; p.shutdown = false; }
        function pc(id, name, x, y, ip, mask, gw) { const d = mk('pc', id, name, x, y); d.ip = ip; d.mask = mask; d.gw = gw; return d; }
        function ln(id, a, ap, b, bp) { return { id, a: { d: a, p: ap }, b: { d: b, p: bp } }; }
        const G = n => 'GigabitEthernet0/' + n, F = n => 'FastEthernet0/' + n;

        /* 1. One switch, two PCs: same subnet */
        const lan = {
            devices: [pc('d1', 'PC1', 160, 200, '192.168.1.10', '255.255.255.0', ''), pc('d2', 'PC2', 520, 200, '192.168.1.20', '255.255.255.0', ''), mk('switch', 'd3', 'Switch1', 340, 200)],
            links: [ln('l1', 'd1', 'Ethernet0', 'd3', F(1)), ln('l2', 'd2', 'Ethernet0', 'd3', F(2))]
        };

        /* 2. Two LANs joined by one router */
        const r1 = mk('router', 'd5', 'R1', 360, 190); up(r1, 0, '192.168.1.1', '255.255.255.0'); up(r1, 1, '192.168.2.1', '255.255.255.0');
        const twoLans = {
            devices: [pc('d1', 'PC1', 80, 90, '192.168.1.10', '255.255.255.0', '192.168.1.1'), pc('d2', 'PC2', 80, 300, '192.168.1.11', '255.255.255.0', '192.168.1.1'),
                mk('switch', 'd3', 'SW-A', 220, 190), mk('switch', 'd4', 'SW-B', 500, 190), r1,
                pc('d6', 'PC3', 640, 90, '192.168.2.10', '255.255.255.0', '192.168.2.1'), pc('d7', 'PC4', 640, 300, '192.168.2.11', '255.255.255.0', '192.168.2.1')],
            links: [ln('l1', 'd1', 'Ethernet0', 'd3', F(1)), ln('l2', 'd2', 'Ethernet0', 'd3', F(2)), ln('l3', 'd3', F(3), 'd5', G(0)),
                ln('l4', 'd5', G(1), 'd4', F(3)), ln('l5', 'd4', F(1), 'd6', 'Ethernet0'), ln('l6', 'd4', F(2), 'd7', 'Ethernet0')]
        };

        /* 3. Two routers with static routes (routes still missing: students add them) */
        const ra = mk('router', 'd3', 'R1', 220, 190); up(ra, 0, '192.168.1.1', '255.255.255.0'); up(ra, 1, '10.0.0.1', '255.255.255.252');
        const rb = mk('router', 'd4', 'R2', 440, 190); up(rb, 0, '192.168.2.1', '255.255.255.0'); up(rb, 1, '10.0.0.2', '255.255.255.252');
        const routed = {
            devices: [pc('d1', 'PC1', 60, 190, '192.168.1.10', '255.255.255.0', '192.168.1.1'), pc('d2', 'PC2', 600, 190, '192.168.2.10', '255.255.255.0', '192.168.2.1'), ra, rb],
            links: [ln('l1', 'd1', 'Ethernet0', 'd3', G(0)), ln('l2', 'd3', G(1), 'd4', G(1)), ln('l3', 'd4', G(0), 'd2', 'Ethernet0')]
        };
        return {
            lan: { title: 'One switch, two PCs', note: 'PC1 and PC2 share a subnet. Try: ping 192.168.1.20 from PC1.', data: lan },
            routed_lans: { title: 'Two LANs and one router', note: 'The router joins 192.168.1.0/24 and 192.168.2.0/24. Ping PC3 from PC1.', data: twoLans },
            static_routes: { title: 'Two routers, static routes', note: 'Pings fail until you add the routes. On R1: ip route 192.168.2.0 255.255.255.0 10.0.0.2. On R2: ip route 192.168.1.0 255.255.255.0 10.0.0.1.', data: routed }
        };
    }

    return {
        Network, createDevice, execute, prompt, buildPresets, TYPES,
        util: { ipToInt, intToIp, maskLen, lenToMask, netOf, sameSubnet, validHost }
    };
});
