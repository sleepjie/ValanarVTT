"""Roll20 'legacy' sheets write class names without the sheet- prefix; Roll20 adds it when it loads them.
This does the same once, so the sheet's CSS (.sheet-row etc.) matches. Usage: legacy_prefix.py in.html out.html"""
import re, sys
def fix_classes(html):
    def cls(m):
        q, v = m.group(1), m.group(2)
        out = ' '.join(c if (c.startswith('sheet-') or c.startswith('repeating_') or not c) else 'sheet-' + c for c in v.split())
        return f'class={q}{out}{q}'
    return re.sub(r'class=(["\'])(.*?)\1', cls, html)
def run(src):
    parts = re.split(r'(<script[\s\S]*?</script>)', src)
    return ''.join(p if p.startswith('<script') else fix_classes(p) for p in parts)
if __name__ == '__main__':
    s = open(sys.argv[1], encoding='utf-8').read()
    open(sys.argv[2], 'w', encoding='utf-8').write(run(s))
