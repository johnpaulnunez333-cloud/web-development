PALETTES = [
    ("#0066ff", "#38bdf8"),
    ("#7c3aed", "#ec4899"),
    ("#059669", "#34d399"),
    ("#ea580c", "#fbbf24"),
    ("#dc2626", "#f97316"),
    ("#0891b2", "#6366f1"),
    ("#be123c", "#fb7185"),
    ("#4338ca", "#22d3ee"),
    ("#0f766e", "#a3e635"),
    ("#9333ea", "#3b82f6"),
    ("#b45309", "#facc15"),
    ("#1d4ed8", "#a78bfa"),
]

GLYPHS = [
    ("Terminal", '<polyline points="32,38 47,50 32,62"/><line x1="54" y1="64" x2="70" y2="64"/>'),
    ("Code", '<polyline points="38,34 24,50 38,66"/><polyline points="62,34 76,50 62,66"/><line x1="55" y1="30" x2="45" y2="70"/>'),
    ("Shield", '<path d="M50 24 L72 32 V50 C72 64 62 72 50 78 C38 72 28 64 28 50 V32 Z"/><polyline points="40,50 47,58 61,42"/>'),
    ("Signal", '<path d="M26 44 A34 34 0 0 1 74 44"/><path d="M34 53 A22 22 0 0 1 66 53"/><path d="M42 62 A10 10 0 0 1 58 62"/><circle cx="50" cy="71" r="2.5" fill="#fff"/>'),
    ("Chip", '<rect x="34" y="34" width="32" height="32" rx="5"/><rect x="43" y="43" width="14" height="14" rx="2"/><path d="M42 27V34M50 27V34M58 27V34M42 66V73M50 66V73M58 66V73M27 42H34M27 50H34M27 58H34M66 42H73M66 50H73M66 58H73"/>'),
    ("Debugger", '<ellipse cx="50" cy="56" rx="14" ry="18"/><circle cx="50" cy="35" r="7"/><path d="M36 48H24M36 58H24M36 68L26 74M64 48H76M64 58H76M64 68L74 74M50 38V74"/>'),
    ("Launch", '<path d="M50 22 C61 32 63 48 59 64 H41 C37 48 39 32 50 22 Z"/><circle cx="50" cy="42" r="5"/><path d="M41 58 L32 68 L42 66M59 58 L68 68 L58 66M46 72 L50 80 L54 72"/>'),
    ("Lock", '<rect x="32" y="47" width="36" height="28" rx="6"/><path d="M40 47 V40 C40 28 60 28 60 40 V47"/><circle cx="50" cy="61" r="3" fill="#fff"/>'),
    ("Cloud", '<path d="M36 68 C24 68 22 51 35 49 C37 35 60 33 64 47 C78 47 80 68 66 68 Z"/>'),
    ("Database", '<ellipse cx="50" cy="34" rx="20" ry="8"/><path d="M30 34 V66 C30 75 70 75 70 66 V34"/><path d="M30 50 C30 59 70 59 70 50"/>'),
    ("Network", '<line x1="50" y1="34" x2="32" y2="66"/><line x1="50" y1="34" x2="68" y2="66"/><line x1="32" y1="66" x2="68" y2="66"/><circle cx="50" cy="34" r="7" fill="#fff"/><circle cx="32" cy="66" r="7" fill="#fff"/><circle cx="68" cy="66" r="7" fill="#fff"/>'),
    ("Gear", '<circle cx="50" cy="50" r="24" stroke-width="9" stroke-dasharray="9.4 9.4"/><circle cx="50" cy="50" r="15"/><circle cx="50" cy="50" r="5" fill="#fff"/>'),
]

AVATAR_KEYS = [f"a{i + 1}" for i in range(len(GLYPHS))]
AVATAR_LABELS = {key: GLYPHS[i][0] for i, key in enumerate(AVATAR_KEYS)}


def render_avatar(key):
    if key not in AVATAR_KEYS:
        key = AVATAR_KEYS[0]
    index = AVATAR_KEYS.index(key)
    start, end = PALETTES[index]
    glyph = GLYPHS[index][1]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{start}"/><stop offset="1" stop-color="{end}"/>'
        '</linearGradient></defs>'
        '<rect width="100" height="100" fill="url(#g)"/>'
        '<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">'
        f'{glyph}</g></svg>'
    )
