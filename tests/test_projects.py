import base64
import io
import json
import pytest
import pymupdf
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('DRUMLAB_PROJECTS_DIR',str(tmp_path))
    return TestClient(app)


def draft(title='First'):
    return {'score':{'title':title,'bpm':96,'source':'test.xml','warnings':[],'needsReview':False,'tempos':[],
        'measures':[{'id':'m1','number':1,'beats':4,'time':[4,4],'label':'','notes':[{'id':'n1','instrument':'kick','beat':0,'duration':1,'velocity':90,'hand':'RF'}]}]},'settings':{'bpm':72,'selected':0}}


def test_project_crud_and_revision_conflict(client):
    data=draft();r=client.post('/api/projects',json=data);assert r.status_code==200
    first=r.json();id=first['id'];assert first['title']=='First' and first['revision']==1
    loaded=client.get('/api/projects/'+id).json();assert loaded['settings']['bpm']==72
    data['score']['title']='Changed';data['revision']=1
    saved=client.put('/api/projects/'+id,json=data);assert saved.status_code==200 and saved.json()['revision']==2
    assert client.put('/api/projects/'+id,json=data).status_code==409
    renamed=client.patch('/api/projects/'+id,json={'title':'Renamed','revision':2}).json();assert renamed['revision']==3
    assert client.get('/api/projects/'+id).json()['score']['title']=='Renamed'
    assert client.delete('/api/projects/'+id).status_code==200
    assert client.get('/api/projects').json()==[]
    assert client.get('/api/projects/'+id).status_code==404


def test_pdf_audio_and_import_baseline_survive_server_clients(client):
    data=draft();pdf=pymupdf.open();pdf.new_page().insert_text((30,40),'Original PDF')
    raw=pdf.tobytes();data['score']['pdf']=base64.b64encode(raw).decode()
    data['score']['importedScore']=json.loads(json.dumps(data['score']))
    id=client.post('/api/projects',json=data).json()['id']
    sound=b'RIFF'+b'\0'*100
    assert client.put(f'/api/projects/{id}/audio/original',files={'file':('drum.wav',sound,'audio/wav')}).status_code==200
    assert client.put(f'/api/projects/{id}/audio/original',headers={'X-DrumLab-Revision':'0'},files={'file':('stale.wav',b'changed','audio/wav')}).status_code==409
    restored=client.get('/api/projects/'+id).json();assert base64.b64decode(restored['score']['pdf'])==raw
    assert restored['score']['importedScore']['measures']==data['score']['measures']
    assert restored['media']==['original']
    assert client.get(f'/api/projects/{id}/audio/original').content==sound
    # Subsequent autosaves omit the heavy PDF but must not erase it.
    updated=draft('Updated');updated['revision']=1
    assert client.put('/api/projects/'+id,json=updated).status_code==200
    assert base64.b64decode(client.get('/api/projects/'+id).json()['score']['pdf'])==raw
    assert client.get('/api/projects').json()[0]['hasAudio']
    client.delete('/api/projects/'+id)
    assert client.get(f'/api/projects/{id}/audio/original').status_code==404


def test_projects_are_isolated_and_invalid_payloads_rejected(client):
    id=client.post('/api/projects',json=draft()).json()['id']
    assert client.get('/api/projects',headers={'X-DrumLab-Workspace':'another'}).json()==[]
    assert client.get('/api/projects',headers={'X-DrumLab-Workspace':'../escape'}).status_code==422
    invalid=draft();invalid['score']['measures'][0]['notes'][0]['beat']=4
    assert client.post('/api/projects',json=invalid).status_code==422
    assert client.post('/api/projects',content=b'{not json').status_code==422
    assert client.patch('/api/projects/'+id,json={'title':'','revision':1}).status_code==422
