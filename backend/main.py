import base64
import io
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile
import pymupdf as fitz
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from .score import parse_score
from .audio import repair_audio

app=FastAPI(title='DrumLab',version='0.1.0')
MAX_UPLOAD=32*1024*1024
async def read_upload(file):
    data=await file.read(MAX_UPLOAD+1)
    if len(data)>MAX_UPLOAD: raise HTTPException(413,'文件超过 32 MB')
    return data

@app.get('/api/health')
def health(): return {'ok':True,'omr':bool(os.environ.get('AUDIVERIS_BIN'))}

@app.post('/api/import')
async def import_score(file: UploadFile=File(...)):
    data=await read_upload(file)
    name=file.filename or 'score.xml'
    try:
        if name.lower().endswith('.pdf'):
            with fitz.open(stream=data,filetype='pdf') as pdf:
                if pdf.is_encrypted: raise ValueError('PDF 已加密，请先解锁')
                if len(pdf)>40: raise ValueError('PDF 最多 40 页')
                # Some publishers attach the authoritative XML to the PDF.
                for attachment in pdf.embfile_names():
                    if attachment.lower().endswith(('.xml','.musicxml','.mxl')):
                        score=parse_score(pdf.embfile_get(attachment),attachment)
                        score['warnings'].append('已读取 PDF 内嵌 MusicXML；请与原谱核对')
                        score['pdf']=base64.b64encode(data).decode(); return score
                pages=len(pdf)
            reason='未配置本机光学识谱引擎。'
            command=os.environ.get('AUDIVERIS_BIN')
            if command:
                with tempfile.TemporaryDirectory() as tmp:
                    source=Path(tmp)/'score.pdf'; source.write_bytes(data)
                    try:
                        result=subprocess.run([command,'-batch','-export','-output',tmp,'--',str(source)],capture_output=True,timeout=120)
                        candidates=list(Path(tmp).rglob('*.mxl'))+list(Path(tmp).rglob('*.musicxml'))
                        if result.returncode==0 and candidates:
                            score=parse_score(candidates[0].read_bytes(),candidates[0].name)
                            score['needsReview']=True
                            score['warnings'].append('PDF 光学识谱结果必须逐小节核对；未提供经数据集校准的置信度')
                            score['pdf']=base64.b64encode(data).decode(); return score
                        reason='光学识谱引擎未产出可用 MusicXML。'
                    except Exception:
                        reason='光学识谱引擎不可用、超时或产出无效，已切换为人工校正。'
            return {'title':name,'bpm':100,'measures':[{'id':'m1','number':1,'beats':4,'time':[4,4],'label':'待人工录入','notes':[]}], 'warnings':[f'PDF 共 {pages} 页。{reason}未获得可用自动识谱结果，当前为空白校正谱，绝非识别出的音符。可对照左侧原谱手动录入，或先从 Audiveris 导出 MXL 再导入。'],'needsReview':True,'source':name,'pdf':base64.b64encode(data).decode(),'tempos':[]}
        if not name.lower().endswith(('.xml','.musicxml','.mxl')): raise ValueError('请选择 PDF / MusicXML / MXL')
        return parse_score(data,name)
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(422, '鼓谱导入失败：'+str(e)[:250]) from e

@app.post('/api/pdf-page')
async def pdf_page(file:UploadFile=File(...),page:int=Form(0)):
    data=await read_upload(file)
    try:
        with fitz.open(stream=data,filetype='pdf') as doc:
            if page<0 or page>=len(doc): raise ValueError('页码越界')
            rect=doc[page].rect
            scale=min(1.25,1800/max(rect.width,1),2400/max(rect.height,1))
            pix=doc[page].get_pixmap(matrix=fitz.Matrix(scale,scale))
            return Response(pix.tobytes('png'),media_type='image/png',headers={'X-Page-Count':str(len(doc))})
    except Exception as e: raise HTTPException(422,str(e)) from e

@app.post('/api/audio/repair')
async def repair(file: UploadFile=File(...),reduction:float=Form(0.5),normalize:bool=Form(True)):
    data=await read_upload(file)
    if not 0<=reduction<=1: raise HTTPException(422,'降噪强度须为 0–1')
    try:
        wav,stats=repair_audio(data,reduction,normalize)
        return {'wav':base64.b64encode(wav).decode(),'stats':stats}
    except Exception as e: raise HTTPException(422,'音频解码失败，请使用 WAV / FLAC / OGG：'+str(e)[:160]) from e

DIST=Path(__file__).resolve().parents[1]/'dist'
if DIST.exists():
    app.mount('/assets',StaticFiles(directory=DIST/'assets'),name='assets')
    @app.get('/')
    def index(): return FileResponse(DIST/'index.html')
