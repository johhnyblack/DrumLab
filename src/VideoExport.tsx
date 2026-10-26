import {useEffect,useRef,useState} from 'react';
import {Download,Video} from 'lucide-react';
import {canExportPdf,recordScoreVideo,videoFormats,videoSeconds,type VideoMode} from './video';
import type {TransportOptions} from './engine';

type Props={options:TransportOptions;onClose:()=>void};
export function VideoExport({options,onClose}:Props){
 const settings=useRef(options).current,dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),controller=useRef<AbortController|null>(null),resultUrl=useRef('');
 const formats=useRef(videoFormats()).current;
 const [format,setFormat]=useState(formats[0]?.id||''),[mode,setMode]=useState<VideoMode>(canExportPdf(settings)?'pdf':'grid'),[cycles,setCycles]=useState(1),[working,setWorking]=useState(false),[progress,setProgress]=useState(0),[status,setStatus]=useState(''),[result,setResult]=useState<{url:string;name:string}|null>(null);
 const seconds=videoSeconds(settings,cycles);
 useEffect(()=>{dialog.current?.showModal();return()=>{controller.current?.abort();if(resultUrl.current)URL.revokeObjectURL(resultUrl.current)}},[]);
 async function begin(){
  const selected=formats.find(f=>f.id===format);if(!selected||!canvas.current)return;
  const abort=new AbortController();controller.current=abort;setWorking(true);setProgress(0);setStatus('正在载入音色和画面…');
  if(resultUrl.current){URL.revokeObjectURL(resultUrl.current);resultUrl.current=''}setResult(null);
  try{
   const exported=await recordScoreVideo(canvas.current,settings,mode,cycles,selected.mime,abort.signal,p=>{setProgress(Math.floor(p*100));setStatus('正在逐帧生成视频…')});
   const url=URL.createObjectURL(exported.blob);resultUrl.current=url;
   const title=settings.score.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)||'DrumLab';
   setResult({url,name:`${title}-${settings.from+1}-${settings.to+1}.${exported.extension}`});setStatus('视频已生成，可预览或下载。');
  }catch(e){setStatus(e instanceof DOMException&&e.name==='AbortError'?'已取消，未生成视频。':e instanceof Error?e.message:String(e))}
  finally{controller.current=null;setWorking(false)}
 }
 return <dialog ref={dialog} className="video-dialog" aria-labelledby="video-title" onCancel={e=>{e.preventDefault();if(working)controller.current?.abort();else onClose()}}>
  <header><div><h2 id="video-title"><Video size={21}/>导出动态鼓谱视频</h2><p>原谱或功能谱画面，与当前音色、节拍器和同步录音一起导出。</p></div><button className="button" disabled={working} onClick={onClose}>关闭</button></header>
  <fieldset disabled={working} className="video-options"><label>画面<select aria-label="视频画面" value={mode} onChange={e=>setMode(e.target.value as VideoMode)}><option value="pdf" disabled={!canExportPdf(settings)}>原版 PDF · 跟随谱行</option><option value="grid">功能鼓谱 · 动态拍线</option></select></label><label>视频格式<select aria-label="视频格式" value={format} onChange={e=>setFormat(e.target.value)}>{formats.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>播放遍数<input aria-label="视频播放遍数" type="number" min={1} max={8} value={cycles} onChange={e=>setCycles(Math.max(1,Math.min(8,+e.target.value||1)))}/></label></fieldset>
  <p className="video-details">1280 × 720 · 30 帧/秒 · 小节 {settings.from+1}–{settings.to+1} · 预计 {Math.ceil(seconds)} 秒。本机逐帧生成，最长 10 分钟。</p>
  {!canExportPdf(settings)&&<p className="video-details">导出原版 PDF 需要载入 PDF 并定位范围内的全部小节；目前可导出功能谱画面。</p>}
  <p className="video-details">声音：{settings.drums?'所选鼓音色':'无鼓声'} · {settings.click?'含节拍器':'不含节拍器'} · {settings.buffer?'含同步录音':'不含录音'}{settings.countIn?' · 含预备拍':''}</p>
  <canvas ref={canvas} width={1280} height={720} className={`video-canvas ${working?'visible':''}`} aria-label="视频导出画面"/>
  {result&&<video controls src={result.url} className="video-result" aria-label="导出视频预览"/>}
  {working&&<progress max={100} value={progress} aria-label="视频导出进度"/>}
  {status&&<p role="status" className="video-status">{status}{working?` ${progress}%`:''}</p>}
  <footer>{working?<button className="button" onClick={()=>controller.current?.abort()}>取消导出</button>:<><button className="button primary" disabled={!formats.length||seconds>600} onClick={()=>void begin()}><Video size={16}/>{result?'重新生成':'开始导出'}</button>{result&&<a className="button" href={result.url} download={result.name}><Download size={16}/>下载视频</a>}</>}
  {!formats.length&&<span>此浏览器不支持视频编码，请使用新版 Chrome 或 Edge。</span>}</footer>
 </dialog>;
}
