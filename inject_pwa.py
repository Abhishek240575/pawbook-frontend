# inject_pwa.py — run from inside pawbook_v2 folder

import os
import glob

MANIFEST_TAG = '<link rel="manifest" href="manifest.json">'
SW_SCRIPT = """<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('service-worker.js')
      .then(function(reg) { console.log('[SW] Registered:', reg.scope); })
      .catch(function(err) { console.warn('[SW] Registration failed:', err); });
  });
}
</script>"""

THEME_TAG = '<meta name="theme-color" content="#1877F2">'
APPLE_TAG = '<meta name="apple-mobile-web-app-capable" content="yes">'
APPLE_TITLE = '<meta name="apple-mobile-web-app-title" content="PawBook">'

html_files = glob.glob('*.html')
html_files.sort()

updated = 0
skipped = 0

for fname in html_files:
    with open(fname, 'r', encoding='utf-8') as f:
        content = f.read()

    changed = False

    # 1. Inject manifest link into <head> (after last <meta> tag or after <head>)
    if 'manifest.json' not in content:
        # Insert after the viewport meta tag if present, else after <head>
        if 'name="viewport"' in content:
            insert_after = content.find('\n', content.find('name="viewport"')) + 1
            content = content[:insert_after] + MANIFEST_TAG + '\n' + content[insert_after:]
        elif '<head>' in content:
            pos = content.find('<head>') + len('<head>')
            content = content[:pos] + '\n' + MANIFEST_TAG + content[pos:]
        changed = True

    # 2. Inject theme-color meta if missing
    if 'theme-color' not in content and '<head>' in content:
        if 'name="viewport"' in content:
            insert_after = content.find('\n', content.find('name="viewport"')) + 1
            content = content[:insert_after] + THEME_TAG + '\n' + APPLE_TAG + '\n' + APPLE_TITLE + '\n' + content[insert_after:]
        changed = True

    # 3. Inject SW registration before </body>
    if 'serviceWorker' not in content and '</body>' in content:
        content = content.replace('</body>', SW_SCRIPT + '\n</body>')
        changed = True

    if changed:
        with open(fname, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  ✅ Updated: {fname}')
        updated += 1
    else:
        print(f'  ⏭  Skipped (already has PWA tags): {fname}')
        skipped += 1

print(f'\nDone. {updated} files updated, {skipped} already had PWA tags.')
