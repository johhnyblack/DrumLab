import base64
import io
import zipfile
import numpy as np
import pytest
import soundfile as sf
from scipy import signal
import pymupdf as fitz
from fastapi.testclient import TestClient
from backend.main import app
from backend.score import parse_score
from backend.audio import repair_audio

client=TestClient(app)
XML=b'''<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Tuplet Pocket</work-title></work><part-list><score-part id="P1"><part-name>Drums</part-name><midi-instrument id="BD"><midi-channel>10</midi-channel><midi-unpitched>37</midi-unpitched></midi-instrument><midi-instrument id="SN"><midi-unpitched>39</midi-unpitched></midi-instrument><midi-instrument id="HH"><midi-unpitched>43</midi-unpitched></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="96"/></direction><note><unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched><duration>12</duration><instrument id="BD"/></note><note><chord/><unpitched/><duration>12</duration><instrument id="HH"/></note><note><rest/><duration>36</duration></note><backup><duration>48</duration></backup><note><rest/><duration>12</duration></note><note><unpitched/><duration>4</duration><instrument id="SN"/><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note><note><unpitched/><duration>4</duration><instrument id="SN"/></note><note><unpitched/><duration>4</duration><instrument id="SN"/></note><forward><duration>24</duration></forward></measure><measure number="2"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes><note><rest measure="yes"/><duration>36</duration></note></measure></part></score-partwise>'''

def test_chords_voices_tuplets_and_meter():
    score=parse_score(XML,'golden.musicxml')
    assert score['title']=='Tuplet Pocket' and score['bpm']==96
    assert [m['beats'] for m in score['measures']]==[4,3]
    notes=score['measures'][0]['notes']
    assert [(n['instrument'],n['beat']) for n in notes[:3]]==[('kick',0),('hihat',0),('snare',1)]
    assert notes[3]['beat']==pytest.approx(4/3)
    assert notes[4]['beat']==pytest.approx(5/3)
    assert notes[2]['duration']==pytest.approx(1/3)

def test_mxl_container_root_path():
    b=io.BytesIO()
    with zipfile.ZipFile(b,'w') as z:
        z.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="nested/score.musicxml"/></rootfiles></container>')
        z.writestr('nested/score.musicxml',XML)
    score=parse_score(b.getvalue(),'sample.mxl')
    assert len(score['measures'][0]['notes'])==5

def test_unknown_mapping_is_not_guessed():
    score=parse_score(XML.replace(b'midi-unpitched>43',b'midi-unpitched>100'),'unknown.xml')
    assert score['needsReview']
    assert score['measures'][0]['notes'][1]['instrument']=='unknown:99'

def test_namespace_and_pickup():
    score=parse_score(XML.replace(b'<score-partwise version="4.0">',b'<score-partwise xmlns="urn:test" version="4.0">').replace(b'<measure number="1">',b'<measure number="1" implicit="yes">'),'namespaced.xml')
    assert len(score['measures'])==2
    pickup=XML[:XML.index(b'<part id="P1">')]+b'<part id="P1"><measure number="0" implicit="yes"><attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><unpitched/><duration>12</duration><instrument id="BD"/></note></measure><measure number="1"><note><rest/><duration>48</duration></note></measure></part></score-partwise>'
    parsed=parse_score(pickup,'pickup.xml')
    assert [m['beats'] for m in parsed['measures']]==[1,4]
    assert parsed['measures'][0]['notes'][0]['beat']==0

def test_reject_entity_expansion():
    hostile=b'<!DOCTYPE score-partwise [<!ENTITY x "boom">]><score-partwise>&x;</score-partwise>'
    with pytest.raises(Exception):parse_score(hostile,'x.xml')

def test_reject_invalid_and_pitched_score():
    assert client.post('/api/import',files={'file':('bad.musicxml',b'invalid')}).status_code==422
    assert client.post('/api/import',files={'file':('bad.mxl',b'invalid')}).status_code==422
    assert client.post('/api/import',files={'file':('bad.txt',b'hi')}).status_code==422

def make_audio():
    sr=24000;t=np.arange(sr*2)/sr;rng=np.random.default_rng(45)
    # Transient drum-like pulses over a quiet noise floor plus DC.
    x=.06+rng.normal(0,.007,len(t))
    for at in [.25,.75,1.25,1.75]:
        q=t-at;x+=np.where(q>=0,.7*np.sin(2*np.pi*80*q)*np.exp(-np.maximum(q,0)*30),0)
    data=io.BytesIO();sf.write(data,np.column_stack([x,x*.7]),sr,format='WAV',subtype='FLOAT');return data.getvalue(),x,sr

def test_audio_preserves_frames_channels_and_peak():
    data,x,sr=make_audio();out,stats=repair_audio(data,.5)
    y,rate=sf.read(io.BytesIO(out),always_2d=True)
    assert rate==sr and y.shape==(len(x),2)
    assert np.max(np.abs(y))<=10**(-1/20)+1e-6
    assert abs(np.mean(y))<.002
    assert not np.allclose(y[:,0],x)
    # Attack sample alignment, measured within a 100ms window after each hit.
    for at in [.25,.75,1.25,1.75]:
        a,b=int(at*sr),int((at+.1)*sr)
        corr=signal.correlate(y[a:b,0],x[a:b]-.06,mode='full')
        lag=np.argmax(corr)-(b-a-1)
        assert abs(lag)<=2
    assert stats['frames']==len(x) and len(stats['waveform'])==320

def test_api_real_audio_and_invalid_file():
    data,_,_=make_audio()
    r=client.post('/api/audio/repair',files={'file':('x.wav',data)},data={'reduction':'.3'})
    assert r.status_code==200
    assert base64.b64decode(r.json()['wav'])[:4]==b'RIFF'
    assert client.post('/api/audio/repair',files={'file':('x.wav',b'broken')}).status_code==422
    assert client.post('/api/audio/repair',files={'file':('x.wav',data)},data={'reduction':'2'}).status_code==422

def test_pdf_manual_fallback_and_page(monkeypatch):
    monkeypatch.delenv('AUDIVERIS_BIN',raising=False)
    doc=fitz.open();doc.new_page().insert_text((50,60),'Drum score reference');data=doc.tobytes()
    r=client.post('/api/import',files={'file':('reference.pdf',data)})
    assert r.status_code==200
    s=r.json();assert s['needsReview'] and s['measures'][0]['notes']==[]
    assert '空白校正谱' in s['warnings'][0]
    r=client.post('/api/pdf-page',files={'file':('reference.pdf',data)},data={'page':'0'})
    assert r.status_code==200 and r.content.startswith(b'\x89PNG')
    assert client.post('/api/pdf-page',files={'file':('reference.pdf',data)},data={'page':'9'}).status_code==422

def test_pdf_embedded_authoritative_xml():
    doc=fitz.open();doc.new_page();doc.embfile_add('score.musicxml',XML);data=doc.tobytes()
    s=client.post('/api/import',files={'file':('reference.pdf',data)}).json()
    assert len(s['measures'][0]['notes'])==5 and s['pdf']


def test_denoising_reduces_quiet_noise_without_normalization():
    data,x,sr=make_audio();out,_=repair_audio(data,.6,False)
    y,_=sf.read(io.BytesIO(out),always_2d=True)
    quiet=slice(int(.1*sr),int(.2*sr))
    assert np.std(y[quiet,0])<np.std(x[quiet])
    assert np.max(np.abs(y[:,0]))>.3


def test_broken_omr_engine_preserves_manual_fallback(monkeypatch):
    monkeypatch.setenv('AUDIVERIS_BIN','/nonexistent/drumlab-omr')
    doc=fitz.open();doc.new_page();data=doc.tobytes()
    response=client.post('/api/import',files={'file':('score.pdf',data)})
    assert response.status_code==200
    assert response.json()['needsReview']
    assert response.json()['measures'][0]['notes']==[]
    assert '人工校正' in response.json()['warnings'][0]


def test_invalid_omr_output_preserves_manual_fallback(monkeypatch):
    from pathlib import Path
    import backend.main as main
    monkeypatch.setenv('AUDIVERIS_BIN','test-engine')
    def invalid_output(args,**kwargs):
        Path(args[args.index('-output')+1],'invalid.musicxml').write_bytes(b'invalid xml')
        return 0
    monkeypatch.setattr(main,'run_omr',invalid_output)
    doc=fitz.open();doc.new_page()
    response=client.post('/api/import',files={'file':('score.pdf',doc.tobytes())})
    assert response.status_code==200 and response.json()['needsReview']
    assert response.json()['measures'][0]['notes']==[]


def test_pdf_omr_success_uses_percussion_switches(monkeypatch):
    from pathlib import Path
    import backend.main as main
    monkeypatch.setenv('AUDIVERIS_BIN','test-engine')
    def recognized_output(args,**kwargs):
        assert 'org.audiveris.omr.sheet.ProcessingSwitches.drumNotation=true' in args
        assert 'org.audiveris.omr.sheet.ProcessingSwitches.oneLineStaves=true' in args
        Path(args[args.index('-output')+1],'recognized.musicxml').write_bytes(XML)
        return 0
    monkeypatch.setattr(main,'run_omr',recognized_output)
    doc=fitz.open();doc.new_page()
    response=client.post('/api/import',files={'file':('score.pdf',doc.tobytes())})
    assert response.status_code==200
    score=response.json()
    assert len(score['measures'])==2
    assert len(score['measures'][0]['notes'])==5
    assert score['needsReview'] and score['pdf']
    assert score['source']=='score.pdf'
    assert any('光学识谱' in w for w in score['warnings'])


def audiveris_xml(zero_based):
    xml=XML.replace(b'<work>',b'<identification><encoding><software>Audiveris 5.11.0</software></encoding></identification><work>',1)
    names=b'<score-instrument id="BD"><instrument-name>Bass_Drum_1</instrument-name></score-instrument><score-instrument id="SN"><instrument-name>Acoustic_Snare</instrument-name></score-instrument><score-instrument id="HH"><instrument-name>Closed_Hi_Hat</instrument-name></score-instrument>'
    xml=xml.replace(b'<part-name>Drums</part-name>',b'<part-name>Drums</part-name>'+names)
    if zero_based:
        for old,new in [(37,36),(39,38),(43,42)]:
            xml=xml.replace(f'<midi-unpitched>{old}</midi-unpitched>'.encode(),f'<midi-unpitched>{new}</midi-unpitched>'.encode())
    return xml


@pytest.mark.parametrize('zero_based',[False,True])
def test_audiveris_midi_numbering_with_named_evidence(zero_based):
    score=parse_score(audiveris_xml(zero_based),'audiveris.musicxml')
    assert [n['instrument'] for n in score['measures'][0]['notes'][:3]]==['kick','hihat','snare']
    assert any('零起算' in w for w in score['warnings'])==zero_based


def test_other_exporters_are_not_shifted_from_instrument_names():
    score=parse_score(audiveris_xml(True).replace(b'Audiveris 5.11.0',b'Other exporter'),'other.musicxml')
    assert score['measures'][0]['notes'][1]['instrument']=='floor'


def test_overfull_measure_warns_without_discarding_notes():
    score=parse_score(XML.replace(b'<duration>36</duration>',b'<duration>60</duration>',1),'overfull.musicxml')
    assert any('超出拍号' in w for w in score['warnings'])
    assert len(score['measures'][0]['notes'])==5


def make_omr(path,stacks=2):
    with zipfile.ZipFile(path,'w') as z:
        xml='<sheet><picture width="1000" height="2000"/><scale><interline main="10"/></scale><page><system>'
        for i in range(stacks):
            xml+=f'<stack left="{100+i*400}" right="{500+i*400}"><slot x-offset="20" time-offset="0"/><slot x-offset="200" time-offset="1/4"/></stack>'
        xml+='<part><staff><lines><line><point x="100" y="200"/><point x="900" y="240"/></line></lines></staff></part></system></page></sheet>'
        z.writestr('sheet#1/sheet#1.xml',xml)


def test_omr_original_coordinates_and_quarter_note_anchors(tmp_path):
    from backend.pdf_map import attach_pdf_regions
    p=tmp_path/'score.omr';make_omr(p)
    score=parse_score(XML,'score.xml')
    assert attach_pdf_regions(score,p)
    r=score['measures'][0]['pdfRegion']
    assert r['page']==0 and r['x']==.1 and r['width']==.4
    assert r['y']==.085 and r['height']==.05
    assert r['anchors']==[{'beat':0,'x':.12},{'beat':1,'x':.3}]


def test_omr_measure_mismatch_does_not_assign_wrong_positions(tmp_path):
    from backend.pdf_map import attach_pdf_regions
    p=tmp_path/'score.omr';make_omr(p,stacks=1)
    score=parse_score(XML,'score.xml')
    assert not attach_pdf_regions(score,p)
    assert all('pdfRegion' not in m for m in score['measures'])


def test_bundled_real_drum_samples_have_five_layers_and_valid_audio():
    from pathlib import Path
    import json,hashlib
    root=Path(__file__).resolve().parents[1]/'public/sounds'
    manifest=json.loads((root/'manifest.json').read_text())
    assert len(manifest)==80
    for kit in ['black-pearl','red-zeppelin']:
        for instrument in ['kick','snare','hihat','openhat','tom','floor','crash','ride']:
            assert {m['layer'] for m in manifest if m['kit']==kit and m['instrument']==instrument}=={1,2,3,4,5}
    for entry in manifest:
        file=root/entry['file'];info=sf.info(file)
        assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['sha256']
        assert info.frames==entry['frames'] and info.samplerate==entry['sampleRate']
        assert info.channels==entry['channels'] and info.frames>1000
