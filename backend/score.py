"""MusicXML quarter-note timeline. Never quantizes imported notes."""
import io
import zipfile
from fractions import Fraction
from defusedxml import ElementTree as ET

GM_NAMES = {'Acoustic_Bass_Drum':35,'Bass_Drum_1':36,'Side_Stick':37,'Acoustic_Snare':38,'Electric_Snare':40,'Low_Floor_Tom':41,'Closed_Hi_Hat':42,'High_Floor_Tom':43,'Pedal_Hi_Hat':44,'Low_Tom':45,'Open_Hi_Hat':46,'Low_Mid_Tom':47,'Hi_Mid_Tom':48,'Crash_Cymbal_1':49,'High_Tom':50,'Ride_Cymbal_1':51,'Crash_Cymbal_2':57,'Ride_Cymbal_2':59}

GM = {35:'kick',36:'kick',37:'snare',38:'snare',40:'snare',42:'hihat',44:'hihat',46:'openhat',41:'floor',43:'floor',45:'tom',47:'tom',48:'tom',50:'tom',49:'crash',57:'crash',51:'ride',59:'ride'}

def xml_payload(data: bytes, filename: str) -> bytes:
    if len(data) > 20_000_000: raise ValueError('鼓谱超过 20 MB')
    if filename.lower().endswith('.mxl'):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > 40_000_000: raise ValueError('MXL 解压后过大')
            if 'META-INF/container.xml' not in z.namelist(): raise ValueError('MXL 缺少 container.xml')
            root = ET.fromstring(z.read('META-INF/container.xml'))
            files = [e.get('full-path') for e in root.iter() if e.tag.split('}')[-1]=='rootfile']
            if not files or files[0] not in z.namelist(): raise ValueError('MXL 主谱文件不存在')
            data = z.read(files[0])
    return data

def parse_score(data: bytes, filename: str):
    root = ET.fromstring(xml_payload(data, filename))
    # Namespace independent, safe XML parser rejects entity expansion.
    for e in root.iter(): e.tag = e.tag.split('}')[-1]
    if root.tag != 'score-partwise': raise ValueError('MVP 支持 score-partwise MusicXML；请从制谱软件导出此格式')
    instruments = {}
    names = {}
    warnings = []
    audiveris = any((e.text or '').startswith('Audiveris ') for e in root.findall('./identification/encoding/software'))
    for part in root.findall('./part-list/score-part'):
        names[part.get('id')] = part.findtext('part-name','Part')
        # Some Audiveris/ProxyMusic exports use zero-based MIDI keys instead of
        # MusicXML's one-based values. Require provenance plus consistent named
        # instrument evidence; never shift ordinary MusicXML by guessing.
        named = {e.get('id'): GM_NAMES.get(e.findtext('instrument-name','')) for e in part.findall('score-instrument')}
        evidence = [(int(e.findtext('midi-unpitched','0')),named[e.get('id')]) for e in part.findall('midi-instrument') if named.get(e.get('id')) is not None and e.find('midi-unpitched') is not None]
        zero_based = audiveris and len(evidence)>=2 and all(raw==gm for raw,gm in evidence)
        if zero_based:
            warnings.append('已兼容 Audiveris 零起算打击乐编号；依据导出软件和鼓件名称校验，仍请核对原谱')
        for inst in part.findall('midi-instrument'):
            midi = int(inst.findtext('midi-unpitched','0'))-(0 if zero_based else 1)
            instruments[inst.get('id')] = GM.get(midi, 'unknown:'+str(midi))
    parts = root.findall('part')
    drum_parts = [p for p in parts if p.find('.//unpitched') is not None or any(si.get('id')==p.get('id') and si.find('.//midi-unpitched') is not None for si in root.findall('./part-list/score-part'))]
    if not drum_parts: raise ValueError('未找到打击乐声部；需要 unpitched 或 midi-unpitched 信息')
    measures = []
    tempos = []
    for part in drum_parts:
        divisions = 1
        numerator, denominator = 4,4
        start = Fraction(0)
        for idx, m in enumerate(part.findall('measure')):
            div = m.findtext('attributes/divisions')
            if div: divisions = int(div)
            if divisions <= 0: raise ValueError('无效 divisions')
            time = m.find('attributes/time')
            if time is not None:
                try: numerator = sum(int(x) for x in time.findtext('beats','4').split('+')); denominator = int(time.findtext('beat-type','4'))
                except ValueError: raise ValueError('不支持的拍号')
                if numerator<=0 or denominator<=0: raise ValueError('无效拍号')
            nominal = Fraction(numerator*4,denominator)
            cursor=Fraction(0); last=Fraction(0); maximum=Fraction(0); notes=[]
            for el in m:
                if el.tag=='backup': cursor -= Fraction(int(el.findtext('duration','0')),divisions)
                elif el.tag=='forward': cursor += Fraction(int(el.findtext('duration','0')),divisions)
                elif el.tag=='note':
                    dur = Fraction(int(el.findtext('duration','0')),divisions)
                    chord = el.find('chord') is not None
                    onset = last if chord else cursor
                    if el.find('grace') is not None:
                        warnings.append(f'小节 {idx+1} 有装饰音，请人工核对')
                        continue
                    if el.find('rest') is None:
                        iid = el.find('instrument')
                        key = instruments.get(iid.get('id') if iid is not None else '', '')
                        if not key:
                            # Display positions vary by publisher; do not silently guess.
                            step=el.findtext('unpitched/display-step','?'); octave=el.findtext('unpitched/display-octave','?')
                            key='unknown:'+step+octave
                        ties=[t.get('type') for t in el.findall('tie')]
                        if 'stop' not in ties:
                            notes.append({'id':f'{part.get("id")}-{idx}-{len(notes)}','beat':float(onset),'duration':float(dur),'instrument':key,'velocity':90,'hand':'','source':'MusicXML','originalInstrument':iid.get('id') if iid is not None else None})
                    if not chord: last=onset; cursor+=dur
                    maximum=max(maximum,onset+dur)
                elif el.tag=='direction':
                    sound=el.find('sound')
                    bpm=sound.get('tempo') if sound is not None else None
                    if bpm:
                        tempos.append({'beat':float(start+cursor),'bpm':float(bpm)})
            if maximum>nominal and m.get('implicit')!='yes':
                warnings.append(f'小节 {idx+1} 音符时值超出拍号（{float(maximum):g} / {float(nominal):g} 个四分音符），请人工校正节奏')
            length=maximum if m.get('implicit')=='yes' and maximum>0 else max(nominal,maximum)
            if idx>=len(measures):
                measures.append({'id':f'm{idx+1}','number':idx+1,'beats':float(length),'time':[numerator,denominator],'label':'','notes':notes})
            else: measures[idx]['notes'].extend(notes)
            if m.find('.//repeat') is not None: warnings.append(f'小节 {idx+1} 有反复记号：MVP 保留书写顺序，请使用循环区间')
            start+=length
    unknown=sorted({n['instrument'] for m in measures for n in m['notes'] if n['instrument'].startswith('unknown:')})
    if unknown: warnings.append('存在未映射鼓件，请先在“鼓件映射”中确认：'+', '.join(unknown))
    if len(tempos)>1: warnings.append('发现速度变化：练习使用固定 BPM，原速度变化保存在导出文件 tempos 中')
    title=root.findtext('work/work-title') or root.findtext('movement-title') or filename
    return {'title':title,'bpm':tempos[0]['bpm'] if tempos else 100,'measures':measures,'warnings':list(dict.fromkeys(warnings)),'tempos':tempos,'needsReview':bool(unknown or warnings),'source':filename}
