"""Rebuild the OFL-licensed UI font after adding Chinese UI text.
Development only: pip install fonttools brotli
"""
from pathlib import Path
import urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'.tools/fonts/NotoSansCJKsc-Regular.otf'
source.parent.mkdir(parents=True,exist_ok=True)
if not source.exists():
    urllib.request.urlretrieve('https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',source)
target=ROOT/'src/assets/drumlab-sc.woff2'
chars=set(TTFont(target).getBestCmap())|set(range(32,127))
# Project names are user-entered: include common Chinese beyond source-code labels.
for lead in range(0xb0,0xf8):
    for trail in range(0xa1,0xff):
        try: chars.update(map(ord,bytes([lead,trail]).decode('gb2312')))
        except UnicodeDecodeError: pass
for folder,patterns in [('src',['*.ts','*.tsx']),('backend',['*.py'])]:
    for pattern in patterns:
        for file in (ROOT/folder).glob(pattern):chars.update(map(ord,file.read_text()))
font=TTFont(source)
for record in font['name'].names:
    if record.nameID in [1,4,6,16]:record.string=('DrumLabSC' if record.nameID==6 else 'DrumLab SC').encode(record.getEncoding())
options=subset.Options();subsetter=subset.Subsetter(options=options);subsetter.populate(unicodes=chars);subsetter.subset(font);font.flavor='woff2';font.save(target)
print('Updated offline UI font:',target.stat().st_size,'bytes')
