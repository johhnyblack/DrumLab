import React,{useEffect,useState} from 'react';

type Props={onClose:()=>void;onImport:(file:File)=>Promise<void>};
export function VideoPdf({onClose,onImport}:Props){
 const [url,setUrl]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Blob|null>(null),[preview,setPreview]=useState('');
 useEffect(()=>{if(!result){setPreview('');return}const address=URL.createObjectURL(result);setPreview(address);return()=>URL.revokeObjectURL(address)},[result]);
 async function generate(){
  setWorking(true);setError('');setResult(null);
  try{const form=new FormData();form.append('url',url);const response=await fetch('/api/video-pdf',{method:'POST',body:form});if(!response.ok){const data=await response.json();throw Error(data.detail||'生成失败')}setResult(await response.blob())}
  catch(e){setError(e instanceof Error?e.message:'生成失败')}finally{setWorking(false)}
 }
 return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="video-pdf-title" className="video-dialog">
  <header><div><h2 id="video-pdf-title">B 站动态鼓谱转 PDF</h2><p>输入公开的单个 B 站视频链接，将纵向滚动的谱面拼接为本地静态 PDF。</p></div><button className="button" onClick={onClose} disabled={working}>关闭</button></header>
  <label className="field-label" htmlFor="video-pdf-url">视频链接</label><input id="video-pdf-url" className="video-pdf-url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://www.bilibili.com/video/BV…" disabled={working}/>
  <p className="video-details">生成的 PDF 由视频画面组成，清晰度取决于视频；请检查是否有遗漏或拼接错误。仅支持连续纵向滚动的谱面，最长 15 分钟。</p>
  {working&&<p className="video-status" role="status">正在下载并拼接谱面，请稍候…</p>}{error&&<p className="notice error" role="alert">{error}</p>}
  {preview&&<iframe className="video-pdf-preview" src={preview} title="生成的鼓谱 PDF 预览"/>}
  <footer><button className="button primary" disabled={working||!url.trim()} onClick={()=>void generate()}>{result?'重新生成':'生成 PDF'}</button>{preview&&<a className="button" href={preview} download="DrumLab-video-score.pdf">下载 PDF</a>}{result&&<button className="button" disabled={working} onClick={()=>{onClose();void onImport(new File([result],'视频鼓谱.pdf',{type:'application/pdf'}))}}>导入 DrumLab</button>}</footer>
 </section></div>
}
