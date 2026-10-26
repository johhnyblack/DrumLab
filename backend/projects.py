"""Local single-user project library. Files remain under .local/projects."""
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import uuid
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import Response

router=APIRouter(prefix='/api/projects')
ROOT=Path(__file__).resolve().parents[1]
MAX_JSON=64*1024*1024


def validate_score(score, baseline=False):
    if not isinstance(score,dict) or not isinstance(score.get('title'),str): raise HTTPException(422,'项目标题无效')
    bpm=score.get('bpm',0)
    if not isinstance(bpm,(int,float)) or not math.isfinite(bpm) or not 20<=bpm<=300: raise HTTPException(422,'项目速度无效')
    measures=score.get('measures')
    if not isinstance(measures,list) or not 1<=len(measures)<=500: raise HTTPException(422,'项目小节无效')
    total=0
    for m in measures:
        if not isinstance(m,dict) or not isinstance(m.get('id'),str) or not isinstance(m.get('beats'),(int,float)) or not 0<m['beats']<=32 or not isinstance(m.get('notes'),list): raise HTTPException(422,'项目小节结构无效')
        total+=len(m['notes'])
        for n in m['notes']:
            if not isinstance(n,dict) or not isinstance(n.get('id'),str) or not isinstance(n.get('instrument'),str): raise HTTPException(422,'音符结构无效')
            for name in ['beat','duration','velocity']:
                if not isinstance(n.get(name),(int,float)) or not math.isfinite(n[name]): raise HTTPException(422,'音符数值无效')
            if not 0<=n['beat']<m['beats'] or n['duration']<0 or not 1<=n['velocity']<=127: raise HTTPException(422,'音符位置或力度无效')
    if total>200000: raise HTTPException(422,'单个项目音符过多')
    if not baseline and score.get('importedScore'): validate_score(score['importedScore'],True)
    try: json.dumps(score,allow_nan=False)
    except (TypeError,ValueError): raise HTTPException(422,'项目包含无效数据')


async def payload(request):
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>MAX_JSON: raise HTTPException(413,'项目文件超过 64 MB')
    try:
        result=json.loads(data)
        if not isinstance(result,dict): raise ValueError()
        return result
    except (ValueError,UnicodeDecodeError): raise HTTPException(422,'项目 JSON 无效')


class Library:
    def __init__(self,request):
        # Optional workspace header keeps automated browser runs out of real history.
        space=request.headers.get('X-DrumLab-Workspace','main')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',space): raise HTTPException(422,'项目空间标识无效')
        directory=Path(os.environ.get('DRUMLAB_PROJECTS_DIR',ROOT/'.local/projects'))
        directory.mkdir(parents=True,exist_ok=True)
        self.path=directory/(space+'.sqlite3')
    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=10)
        db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, score TEXT NOT NULL, settings TEXT NOT NULL,
            summary TEXT NOT NULL, pdf BLOB, created TEXT NOT NULL, updated TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS media (
            project TEXT REFERENCES projects(id) ON DELETE CASCADE, kind TEXT,
            mime TEXT, data BLOB, PRIMARY KEY(project,kind));''')
        try:
            with db: yield db
        finally: db.close()
    def row(self,db,id,full=False):
        fields='*' if full else 'id,score,settings,summary,created,updated,revision,pdf IS NOT NULL AS has_pdf'
        row=db.execute(f'SELECT {fields} FROM projects WHERE id=?',(id,)).fetchone()
        if row is None: raise HTTPException(404,'本地项目不存在')
        return row
    def summary(self,db,row):
        return {**json.loads(row['summary']),'id':row['id'],'createdAt':row['created'],'updatedAt':row['updated'],'revision':row['revision'],
                'hasPdf':bool(row['has_pdf']) if 'has_pdf' in row.keys() else row['pdf'] is not None,'hasAudio':bool(db.execute('SELECT 1 FROM media WHERE project=? LIMIT 1',(row['id'],)).fetchone())}
    def list(self):
        with self.connect() as db:
            # Do not read full PDF/audio or score payloads for the history list.
            rows=db.execute('SELECT id,summary,created,updated,revision,pdf IS NOT NULL AS has_pdf,EXISTS(SELECT 1 FROM media WHERE project=projects.id) AS has_audio FROM projects ORDER BY updated DESC').fetchall()
            return [{**json.loads(r['summary']),'id':r['id'],'createdAt':r['created'],'updatedAt':r['updated'],'revision':r['revision'],'hasPdf':bool(r['has_pdf']),'hasAudio':bool(r['has_audio'])} for r in rows]
    def save(self,data,id=None):
        score=data.get('score');validate_score(score)
        settings=data.get('settings',{})
        try:
            if not isinstance(settings,dict) or len(json.dumps(settings,allow_nan=False))>200000: raise ValueError()
        except (TypeError,ValueError): raise HTTPException(422,'项目设置无效')
        thumbnail=data.get('thumbnail','')
        if not isinstance(thumbnail,str) or len(thumbnail)>200000 or (thumbnail and not thumbnail.startswith('data:image/png;base64,')): raise HTTPException(422,'项目快照无效')
        pdf=None
        if score.get('pdf'):
            try: pdf=base64.b64decode(score.pop('pdf'),validate=True)
            except (ValueError,TypeError): raise HTTPException(422,'项目 PDF 无效')
            if len(pdf)>32*1024*1024 or not pdf.startswith(b'%PDF'): raise HTTPException(422,'项目 PDF 无效或过大')
        score.pop('pdf',None)
        if isinstance(score.get('importedScore'),dict): score['importedScore'].pop('pdf',None)
        summary=json.dumps({'title':score['title'],'source':score.get('source',''),'measures':len(score['measures']),'bpm':score['bpm'],'notes':sum(len(m['notes']) for m in score['measures']),'thumbnail':thumbnail},ensure_ascii=False)
        now=datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            if id:
                old=self.row(db,id)
                if data.get('revision')!=old['revision']: raise HTTPException(409,'此项目在另一个窗口有更新，请刷新页面，未保存快照将另存为项目')
                cursor=db.execute('UPDATE projects SET score=?,settings=?,summary=?,pdf=COALESCE(?,pdf),updated=?,revision=revision+1 WHERE id=? AND revision=?',
                                 (json.dumps(score,ensure_ascii=False),json.dumps(settings,allow_nan=False),summary,pdf,now,id,data['revision']))
                if cursor.rowcount!=1: raise HTTPException(409,'项目已在其他窗口更新')
            else:
                id=str(uuid.uuid4())
                db.execute('INSERT INTO projects VALUES (?,?,?,?,?,?,?,1)',(id,json.dumps(score,ensure_ascii=False),json.dumps(settings,allow_nan=False),summary,pdf,now,now))
            return self.summary(db,self.row(db,id))


@router.get('')
def list_projects(request:Request): return Library(request).list()


@router.post('')
async def create_project(request:Request): return Library(request).save(await payload(request))


@router.put('/{id}')
async def save_project(id:str,request:Request): return Library(request).save(await payload(request),id)


@router.get('/{id}')
def open_project(id:str,request:Request):
    library=Library(request)
    with library.connect() as db:
        row=library.row(db,id,full=True);score=json.loads(row['score'])
        if row['pdf'] is not None: score['pdf']=base64.b64encode(row['pdf']).decode()
        media=[r['kind'] for r in db.execute('SELECT kind FROM media WHERE project=?',(id,))]
        return {'project':library.summary(db,row),'score':score,'settings':json.loads(row['settings']),'media':media}


@router.patch('/{id}')
async def rename_project(id:str,request:Request):
    data=await payload(request);title=data.get('title')
    if not isinstance(title,str) or not title.strip() or len(title)>200: raise HTTPException(422,'项目名称须为 1–200 个字符')
    library=Library(request)
    with library.connect() as db:
        row=library.row(db,id)
        if data.get('revision')!=row['revision']: raise HTTPException(409,'项目已在其他窗口更新，请刷新列表')
        score=json.loads(row['score']);score['title']=title.strip();summary=json.loads(row['summary']);summary['title']=title.strip()
        changed=db.execute('UPDATE projects SET score=?,summary=?,updated=?,revision=revision+1 WHERE id=? AND revision=?',(json.dumps(score,ensure_ascii=False),json.dumps(summary,ensure_ascii=False),datetime.now(timezone.utc).isoformat(),id,data['revision']))
        if changed.rowcount!=1: raise HTTPException(409,'项目已在其他窗口更新，请刷新列表')
        return library.summary(db,library.row(db,id))


@router.delete('/{id}')
def delete_project(id:str,request:Request):
    library=Library(request)
    with library.connect() as db:
        library.row(db,id);db.execute('DELETE FROM projects WHERE id=?',(id,))
    return {'ok':True}


@router.put('/{id}/audio/{kind}')
async def save_audio(id:str,kind:str,request:Request,file:UploadFile=File(...)):
    if kind not in ('original','processed'): raise HTTPException(422,'未知录音类型')
    data=await file.read(32*1024*1024+1)
    if len(data)>32*1024*1024: raise HTTPException(413,'录音超过 32 MB')
    library=Library(request)
    mime=file.content_type if (file.content_type or '').startswith('audio/') else 'application/octet-stream'
    with library.connect() as db:
        row=library.row(db,id)
        if request.headers.get('X-DrumLab-Revision') not in (None,str(row['revision'])): raise HTTPException(409,'录音保存版本已过期，请刷新后恢复快照')
        db.execute('INSERT OR REPLACE INTO media VALUES (?,?,?,?)',(id,kind,mime,data))
    return {'ok':True}


@router.get('/{id}/audio/{kind}')
def get_audio(id:str,kind:str,request:Request):
    library=Library(request)
    with library.connect() as db:
        library.row(db,id);row=db.execute('SELECT mime,data FROM media WHERE project=? AND kind=?',(id,kind)).fetchone()
        if row is None: raise HTTPException(404,'本项目没有这份录音')
        return Response(bytes(row['data']),media_type=row['mime'],headers={'Cache-Control':'no-store'})


@router.delete('/{id}/audio/{kind}')
def delete_audio(id:str,kind:str,request:Request):
    library=Library(request)
    with library.connect() as db:
        row=library.row(db,id)
        if request.headers.get('X-DrumLab-Revision') not in (None,str(row['revision'])): raise HTTPException(409,'录音保存版本已过期')
        db.execute('DELETE FROM media WHERE project=? AND kind=?',(id,kind))
    return {'ok':True}
