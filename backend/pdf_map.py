"""Read original page coordinates from Audiveris OMR, never from reflowed XML."""
from fractions import Fraction
from pathlib import Path
import re
import zipfile
from defusedxml import ElementTree as ET


def attach_pdf_regions(score, omr_file: Path):
    regions=[]
    with zipfile.ZipFile(omr_file) as archive:
        sheets=[]
        for info in archive.infolist():
            match=re.fullmatch(r'sheet#(\d+)/sheet#\1\.xml',info.filename)
            if match:
                if info.file_size>20_000_000: raise ValueError('OMR 坐标文件过大')
                sheets.append((int(match[1]),info.filename))
        for page,filename in sorted(sheets):
            sheet=ET.fromstring(archive.read(filename))
            picture=sheet.find('picture')
            width,height=float(picture.get('width')),float(picture.get('height'))
            if width<=0 or height<=0 or not 1<=page<=40: raise ValueError('无效 OMR 页面')
            interline=sheet.find('scale/interline')
            pad=float(interline.get('main','10'))*3 if interline is not None else 30
            for system in sheet.findall('page/system'):
                ys=[float(p.get('y')) for p in system.findall('part/staff/lines/line/point')]
                if not ys: raise ValueError('OMR 缺少谱线坐标')
                top=max(0,min(ys)-pad);bottom=min(height,max(ys)+pad)
                for stack in system.findall('stack'):
                    left=max(0,float(stack.get('left')));right=min(width,float(stack.get('right')))
                    if right<=left or bottom<=top: raise ValueError('无效 OMR 小节范围')
                    anchors=[]
                    for slot in stack.findall('slot'):
                        if slot.get('time-offset') is not None:
                            beat=float(Fraction(slot.get('time-offset'))*4)
                            x=(left+float(slot.get('x-offset')))/width
                            if beat>=0 and left/width<=x<=right/width:
                                anchors.append({'beat':beat,'x':x})
                    regions.append({'page':page-1,'x':left/width,'y':top/height,
                                    'width':(right-left)/width,'height':(bottom-top)/height,
                                    'anchors':sorted(anchors,key=lambda a:a['beat']),'source':'omr'})
    # Do not silently associate the wrong printed bars when an export splits scores.
    if len(regions)!=len(score['measures']): return False
    for measure,region in zip(score['measures'],regions): measure['pdfRegion']=region
    return bool(regions)
