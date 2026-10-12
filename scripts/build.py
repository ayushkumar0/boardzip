from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import shutil
root = Path(__file__).resolve().parents[1]
core = (root / 'extension/core.js').read_text().replace('export function ', 'function ').replace('export class ', 'class ')
ui = (root / 'figma-plugin/src/ui.template.html').read_text().replace('/* BOARDZIP_CORE */', core).replace('/* BOARDZIP_UI */', (root / 'figma-plugin/src/ui.js').read_text())
(root / 'figma-plugin/ui.html').write_text(ui)
with ZipFile(root / 'BoardZip-Chrome-Extension.zip', 'w', ZIP_DEFLATED) as z:
    for p in sorted((root / 'extension').rglob('*')):
        if p.is_file() and p.name != 'package.json' and not p.name.startswith('._'):
            z.write(p, str(p.relative_to(root / 'extension')))
    z.write(root / 'README.md', 'README.md')
    z.write(root / 'LICENSE', 'LICENSE')
# Keep the user's already-extracted extension folder in sync without removing other files.
if (root / 'BoardZip-Chrome-Extension').is_dir():
    for p in (root / 'extension').rglob('*'):
        if p.is_file() and p.name != 'package.json' and not p.name.startswith('._'):
            destination = root / 'BoardZip-Chrome-Extension' / p.relative_to(root / 'extension')
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, destination)
    shutil.copy2(root / 'README.md', root / 'BoardZip-Chrome-Extension/README.md')
with ZipFile(root / 'BoardZip-Pinterest-Figma-Kit.zip', 'w', ZIP_DEFLATED) as z:
    for folder in ['extension', 'figma-plugin']:
        for p in sorted((root / folder).rglob('*')):
            if p.is_file() and p.name != 'package.json' and not any(part.startswith('._') for part in p.relative_to(root / folder).parts) and 'src' not in p.relative_to(root / folder).parts:
                z.write(p, str(p.relative_to(root)))
    z.write(root / 'README.md', 'README.md')
    z.write(root / 'LICENSE', 'LICENSE')
for name in ['BoardZip-Chrome-Extension.zip','BoardZip-Pinterest-Figma-Kit.zip']:
    with ZipFile(root / name) as z:
        assert z.testzip() is None
        print(name, ':', len(z.namelist()), 'files; integrity verified')

# Self-contained Pages downloads, generated during local and CI builds.
downloads = root / 'docs/downloads'
downloads.mkdir(parents=True, exist_ok=True)
for name in ['BoardZip-Chrome-Extension.zip','BoardZip-Pinterest-Figma-Kit.zip']:
    shutil.copy2(root / name, downloads / name)
with ZipFile(downloads / 'Sample-board.zip', 'w', ZIP_DEFLATED) as z:
    for name in ['field-notes','form-study','after-hours','type-specimen']:
        z.write(root / 'docs/assets' / (name + '.svg'), name + '.svg')
