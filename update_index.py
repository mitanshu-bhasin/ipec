import os
import re

file_path = r'c:\Users\mitan\Videos\Expense Tracker\index.html'

with open(file_path, 'r', encoding='utf-8') as f:
    html = f.read()

# Replace Tailwind config and style block
old_config = '''    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="theme.js"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: { sans: ['Inter', 'sans-serif'] },
                    colors: {
                        brand: { 50: '#ecfdf5', 100: '#d1fae5', 500: '#10b981', 600: '#059669', 900: '#064e3b' }
                    }
                }
            }
        }
    </script>
    <style>
        .glass-effect {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }

        .dark .glass-effect {
            background: rgba(15, 23, 42, 0.7);
            border-bottom-color: rgba(255, 255, 255, 0.1);
        }

        .hero-pattern {
            background-image: radial-gradient(#3b82f6 1px, transparent 1px);
            background-size: 24px 24px;
            opacity: 0.1;
        }
    </style>'''

new_config = '''    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="theme.js"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: { sans: ['Inter', 'sans-serif'] },
                    colors: {
                        ipec: {
                            red: '#D93025',
                            green: '#1E8E3E',
                            blue: '#1A73E8',
                            dark: '#0F172A'
                        }
                    }
                }
            }
        }
    </script>
    <style>
        .glass-effect {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }

        .dark .glass-effect {
            background: rgba(15, 23, 42, 0.7);
            border-bottom-color: rgba(255, 255, 255, 0.1);
        }

        .hero-pattern {
            background-image: radial-gradient(#1A73E8 1px, transparent 1px);
            background-size: 24px 24px;
            opacity: 0.1;
        }

        /* Logo Gradient Text Effect */
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
        }
    </style>'''

html = html.replace(old_config, new_config)

# Update body tag to have hero-bg and remove background div layer
body_regex = re.compile(r'<body[^>]*>.*?<!-- Unified Deep Background Layer -->.*?</div>\s*</div>', re.DOTALL)
new_body = '''<body
    class="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans antialiased transition-colors duration-300 relative hero-bg flex flex-col min-h-screen">'''
html = body_regex.sub(new_body, html)

# Replace 'text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-amber-500' with 'gradient-text'
html = html.replace('text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-amber-500', 'gradient-text')

# Replace specific employee portal button classes mapping from index.html -> i2.html styling
html = html.replace('bg-gradient-to-r from-brand-600 to-brand-500', 'bg-gradient-to-r from-blue-700 to-green-600')
html = html.replace('shadow-[0_8px_30px_rgb(16,185,129,0.3)] hover:shadow-[0_8px_40px_rgb(16,185,129,0.4)]', 'shadow-lg shadow-blue-500/20')
html = html.replace('border-brand-400/30', 'border-blue-400/30')

# General specific replacements instead of replacing all `brand-*` randomly
html = html.replace('text-brand-600', 'text-blue-600')
html = html.replace('text-brand-700', 'text-blue-700')
html = html.replace('text-brand-500', 'text-blue-500')
html = html.replace('text-brand-400', 'text-blue-400')
html = html.replace('bg-brand-50', 'bg-blue-50')
html = html.replace('bg-brand-100', 'bg-blue-100')
html = html.replace('bg-brand-500', 'bg-blue-500')
html = html.replace('bg-brand-600', 'bg-blue-600')
html = html.replace('border-brand-100', 'border-blue-100')
html = html.replace('border-brand-200', 'border-blue-200')
html = html.replace('border-brand-500', 'border-blue-500')
html = html.replace('from-brand-', 'from-blue-')
html = html.replace('to-brand-', 'to-blue-')

# Also, emerald is used in some spots (emerald-600 etc.) Let's map emerald to ipec's blue / green approach
html = html.replace('bg-emerald-600', 'bg-blue-600')
html = html.replace('hover:bg-emerald-700', 'hover:bg-blue-700')
html = html.replace('shadow-emerald-200', 'shadow-blue-200')
html = html.replace('text-emerald-500', 'text-blue-500')
html = html.replace('emerald-400', 'blue-400')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(html)

print("done")
