import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {ChevronLeft,ChevronRight,LocateFixed} from 'lucide-react';
import {pdfCursorX,type PdfRegion,type Score} from './model';
import type {Tick} from './engine';

type Props={score:Score;pdfUrl:string;selected:number;tick:Tick|null;running:boolean;onSelect:(index:number)=>void;onLocate:(index:number,region:PdfRegion)=>void};
export function PdfPlayer({score,pdfUrl,selected,tick,running,onSelect,onLocate}:Props){
 const [page,setPage]=useState(0),[follow,setFollow]=useState(true),[marking,setMarking]=useState(false),[draft,setDraft]=useState<{x:number;y:number;width:number;height:number}|null>(null),[preview,setPreview]=useState<{pdf:string;page:number;url:string;count:number}|null>(null),[error,setError]=useState('');
 const viewport=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),origin=useRef<{x:number;y:number;measure:number}|null>(null);
 const current=running&&tick?tick.measure:selected,measure=score.measures[current],region=measure?.pdfRegion;
 const count=preview&&preview.pdf===score.pdf?preview.count:score.pdfPageCount||1;
 const image=preview&&preview.pdf===score.pdf&&preview.page===page?preview.url:'';
 useEffect(()=>{setPage(0);setPreview(null);setError('');setMarking(false);setDraft(null)},[score.pdf]);
 useEffect(()=>{
  if(follow&&!marking&&region)setPage(region.page);
 },[current,region?.page,follow,marking]);
 useEffect(()=>{
  if(!score.pdf)return;
  const controller=new AbortController();let url='';setError('');
  const pdf=score.pdf;
  void (async()=>{try{
   const form=new FormData();form.append('file',new Blob([Uint8Array.from(atob(pdf),c=>c.charCodeAt(0))],{type:'application/pdf'}),'reference.pdf');form.append('page',String(page));
   const response=await fetch('/api/pdf-page',{method:'POST',body:form,signal:controller.signal});
   if(!response.ok)throw Error('原谱页面加载失败，请重试或独立打开 PDF');
   const blob=await response.blob();if(controller.signal.aborted)return;
   url=URL.createObjectURL(blob);setPreview({pdf,page,url,count:Number(response.headers.get('X-Page-Count'))||1});
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e))}})();
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url)};
 },[score.pdf,page]);
 function scrollToRegion(){
  const box=viewport.current,content=stage.current;if(!box||!content||!region||region.page!==page)return;
  const top=region.y*content.offsetHeight,bottom=(region.y+region.height)*content.offsetHeight;
  if(top<box.scrollTop+20||bottom>box.scrollTop+box.clientHeight-20)box.scrollTo({top:Math.max(0,top-box.clientHeight*.25),behavior:'auto'});
 }
 useEffect(()=>{if(follow&&!marking)scrollToRegion()},[current,page,image,follow,marking]);
 function point(e:PointerEvent<HTMLDivElement>){const r=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
 function down(e:PointerEvent<HTMLDivElement>){if(!marking||!image)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);origin.current={...point(e),measure:selected};setDraft({...point(e),width:0,height:0})}
 function move(e:PointerEvent<HTMLDivElement>){if(!origin.current)return;const p=point(e),o=origin.current;setDraft({x:Math.min(p.x,o.x),y:Math.min(p.y,o.y),width:Math.abs(p.x-o.x),height:Math.abs(p.y-o.y)})}
 function up(e:PointerEvent<HTMLDivElement>){if(!origin.current)return;const o=origin.current,p=point(e);origin.current=null;setDraft(null);const width=Math.abs(p.x-o.x),height=Math.abs(p.y-o.y);if(width<.01||height<.008)return;onLocate(o.measure,{page,x:Math.min(p.x,o.x),y:Math.min(p.y,o.y),width,height,anchors:[],source:'manual'});setMarking(false)}
 const cursor=region&&region.page===page?pdfCursorX(region,tick?.beat||0,measure.beats):0;
 return <section className="pdf-player" aria-label="原版 PDF 动态鼓谱">
  <div className="pdf-player-heading"><div><strong>原谱跟随播放</strong><small>{running?(tick?.counting?'预备拍…':`第 ${current+1} 小节 · 第 ${Math.floor(tick?.beat||0)+1} 拍`):`当前第 ${current+1} 小节`}</small></div><a href={pdfUrl} target="_blank" rel="noreferrer">独立打开 PDF ↗</a></div>
  <div className="pdf-player-tools"><div className="pdf-pages"><button type="button" className="icon-button" aria-label="原谱上一页" disabled={page===0} onClick={()=>{setFollow(false);setPage(page-1)}}><ChevronLeft size={16}/></button><span>第 {page+1} / {count} 页</span><button type="button" className="icon-button" aria-label="原谱下一页" disabled={page+1>=count} onClick={()=>{setFollow(false);setPage(page+1)}}><ChevronRight size={16}/></button></div><label className="checkbox"><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>自动跟随</label><button type="button" className={`button ${marking?'primary':''}`} onClick={()=>{setMarking(!marking);setDraft(null);origin.current=null}}><LocateFixed size={15}/>{marking?'取消框选':`定位第 ${selected+1} 小节`}</button></div>
  <p className="pdf-player-hint">{marking?`在本页拖动框选第 ${selected+1} 小节的完整范围，可先翻页。`:!region?'此小节尚无原稿位置：点击“定位”后框选，或重新导入 PDF 获取自动定位。':region.source==='manual'?'手动定位 · 拍线按时值比例移动，可重新框选。':'已关联原稿坐标 · 播放时高亮小节、移动拍线并自动翻页。'} 修改功能谱不会重绘原 PDF。</p>
  <div className="pdf-player-viewport" ref={viewport}>
   {error?<div className="notice error" role="alert">{error}</div>:!image?<div className="pdf-loading" role="status">正在加载原谱页面…</div>:<div ref={stage} className={`pdf-stage ${marking?'marking':''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{origin.current=null;setDraft(null)}}>
    <img src={image} alt={`原始 PDF 第 ${page+1} 页`} title="原始 PDF 鼓谱" draggable={false} onLoad={()=>{if(follow&&!marking)scrollToRegion()}}/>
    {score.measures.map((m,index)=>{const r=m.pdfRegion;if(!r||r.page!==page)return null;return <button type="button" key={m.id} aria-label={`原谱第 ${index+1} 小节`} data-active={index===current} className={`pdf-measure ${index===current?'active':''}`} style={{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`}} onClick={()=>{if(!marking)onSelect(index)}}><span>{index+1}</span></button>})}
    {region&&region.page===page&&running&&!tick?.counting&&!marking&&<div className="pdf-playhead" data-measure={current+1} data-beat={tick?.beat} style={{left:`${cursor*100}%`,top:`${region.y*100}%`,height:`${region.height*100}%`}}/>}
    {draft&&<div className="pdf-draft" style={{left:`${draft.x*100}%`,top:`${draft.y*100}%`,width:`${draft.width*100}%`,height:`${draft.height*100}%`}}/>}
   </div>}
  </div>
 </section>;
}
