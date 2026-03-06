import re
with open('emp.html', 'r', encoding='utf-8') as f:
    text = f.read()

for m in re.finditer(r'<select[^>]+id=[\'"]([^\'"]+)[\'"][^>]*>', text):
    print("ID:", m.group(1))
