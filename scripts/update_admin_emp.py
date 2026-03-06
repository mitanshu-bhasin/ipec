import os
import re

files_to_update = [
    r'c:\Users\mitan\Videos\Expense Tracker\admin.html',
    r'c:\Users\mitan\Videos\Expense Tracker\emp.html'
]

old_hero_bg = re.compile(r'\.hero-bg\s*\{\s*background:\s*linear-gradient\([^}]+\);\s*\}\s*\.dark\s*\.hero-bg\s*\{\s*background:\s*linear-gradient\([^}]+\);\s*\}', re.DOTALL)

new_hero_bg = '''/* Logo Gradient Text Effect */
        .gradient-text {
            background: linear-gradient(to right, #D93025, #1E8E3E, #1A73E8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        /* Subtle Gradient Background for Hero */
        .hero-bg {
            background: linear-gradient(135deg, rgba(255, 255, 255, 1) 0%, rgba(240, 249, 255, 1) 100%);
        }

        .dark .hero-bg {
            background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
        }'''

# Also add the unified deep background layer removal
body_regex = re.compile(r'<body[^>]*>.*?<!-- Unified Deep Background Layer -->.*?</div>\s*</div>\s*</div>', re.DOTALL)
# It might have varying numbers of divs inside. So let's be safe:
background_div_regex = re.compile(r'<!-- Unified Deep Background Layer -->.*?</div>\s*</div>', re.DOTALL)


def process_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. Update css styles
    if old_hero_bg.search(html):
        html = old_hero_bg.sub(new_hero_bg, html)
    else:
        # If it wasn't there, append it before </style>
        html = html.replace('</style>', new_hero_bg + '\n    </style>')

    # 2. Add hero-bg to body class
    body_tag_regex = re.compile(r'<body\s+class="([^"]+)"')
    def body_repl(match):
        classes = match.group(1)
        if 'hero-bg' not in classes:
            classes += ' hero-bg'
        return f'<body\n    class="{classes}"'
    html = body_tag_regex.sub(body_repl, html)

    # 3. Remove Unified Deep Background Layer
    # Let's find <!-- Unified Deep Background Layer --> and remove the div follows it
    def remove_bg_layer(t):
        start_idx = t.find('<!-- Unified Deep Background Layer -->')
        if start_idx == -1: return t
        # Find next <div
        div_start = t.find('<div', start_idx)
        # Find corresponding </div>
        depth = 0
        i = div_start
        while i < len(t):
            if t.startswith('<div', i):
                depth += 1
            elif t.startswith('</div', i):
                depth -= 1
                if depth == 0:
                    end_idx = i + 6
                    return t[:start_idx] + t[end_idx:]
            i += 1
        return t
    
    html = remove_bg_layer(html)

    # 4. Color replacements
    html = html.replace('text-brand-600', 'text-blue-600')
    html = html.replace('text-brand-700', 'text-blue-700')
    html = html.replace('text-brand-500', 'text-blue-500')
    html = html.replace('text-brand-400', 'text-blue-400')
    html = html.replace('bg-brand-50', 'bg-blue-50')
    html = html.replace('bg-brand-100', 'bg-blue-100')
    html = html.replace('bg-brand-500', 'bg-blue-500')
    html = html.replace('bg-brand-600', 'bg-blue-600')
    html = html.replace('border-brand-', 'border-blue-')
    html = html.replace('shadow-brand-', 'shadow-blue-')
    html = html.replace('from-brand-', 'from-blue-')
    html = html.replace('to-brand-', 'to-blue-')

    html = html.replace('bg-emerald-600', 'bg-blue-600')
    html = html.replace('hover:bg-emerald-700', 'hover:bg-blue-700')
    html = html.replace('shadow-emerald-200', 'shadow-blue-200')
    html = html.replace('text-emerald-500', 'text-blue-500')
    html = html.replace('text-emerald-600', 'text-blue-600')
    html = html.replace('emerald-400', 'blue-400')
    html = html.replace('emerald-500', 'blue-500')
    html = html.replace('emerald-600', 'blue-600')
    html = html.replace('emerald-700', 'blue-700')
    html = html.replace('teal-600', 'green-600')
    html = html.replace('teal-700', 'green-700')
    html = html.replace('teal-800', 'green-800')

    html = html.replace('text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-600', 'gradient-text')
    html = html.replace('text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-green-600', 'gradient-text')

    # Fix primary buttons specifically
    # Admin btn-primary css modification
    admin_btn_primary_old = r'''.btn-primary {
            background: linear-gradient(to right, #2563eb, #1d4ed8);'''
    admin_btn_primary_new = r'''.btn-primary {
            background: linear-gradient(to right, #1A73E8, #1E8E3E);'''
    html = html.replace(admin_btn_primary_old, admin_btn_primary_new)

    admin_btn_primary_hover_old = r'''.btn-primary:hover {
            background: linear-gradient(to right, #1d4ed8, #1e40af);'''
    admin_btn_primary_hover_new = r'''.btn-primary:hover {
            background: linear-gradient(to right, #1557B0, #137333);'''
    html = html.replace(admin_btn_primary_hover_old, admin_btn_primary_hover_new)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(html)


for fp in files_to_update:
    process_file(fp)

print("Updates applied.")
