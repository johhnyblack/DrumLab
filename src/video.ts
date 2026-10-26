import {Transport,type Tick,type TransportOptions} from './engine';
import {kit,pdfCursorX,starts} from './model';
import {soundKits} from './sounds';
export type VideoMode='pdf'|'grid';
export const videoFormats=()=>!('VideoEncoder' in globalThis)||!('AudioEncoder' in globalThis)?[]:[
 {id:'mp4',name:'MP4',mime:'video/mp4'},
 {id:'webm',name:'WebM',mime:'video/webm'}
];
export function videoSeconds(o:TransportOptions,cycles:number){return ((o.countIn?o.score.measures[o.from].beats:0)+o.score.measures.slice(o.from,o.to+1).reduce((n,m)=>n+m.beats,0)*cycles)*60/o.bpm+.5}
export function videoTick(o:TransportOptions,seconds:number,cycles:number):Tick {
 const offsets=starts(o.score),first=offsets[o.from],beats=offsets[o.to]+o.score.measures[o.to].beats-first,spb=60/o.bpm,count=o.countIn?o.score.measures[o.from].beats*spb:0;
 if(seconds<count)return {measure:o.from,beat:0,cycle:0,counting:true};
 const elapsed=seconds-count;
 if(elapsed>=beats*spb*cycles)return {measure:o.to,beat:o.score.measures[o.to].beats-.0001,cycle:cycles-1,counting:false};
 const cycle=Math.floor(elapsed/(beats*spb)),beat=(elapsed%(beats*spb))/spb+first;let measure=o.from;
 while(measure<o.to&&beat>=offsets[measure+1]-1e-8)measure++;
 return {measure,beat:Math.max(0,beat-offsets[measure]),cycle,counting:false};
}
export function canExportPdf(o:TransportOptions){return !!o.score.pdf&&o.score.measures.slice(o.from,o.to+1).every(m=>!!m.pdfRegion)}

export async function recordScoreVideo(canvas:HTMLCanvasElement,o:TransportOptions,mode:VideoMode,cycles:number,mime:string,signal:AbortSignal,onProgress:(value:number)=>void){
 if(!('VideoEncoder' in globalThis)||!('AudioEncoder' in globalThis))throw Error('当前浏览器不支持此视频格式，请使用新版 Chrome 或 Edge');
 if(!Number.isInteger(cycles)||cycles<1||cycles>8)throw Error('视频循环次数须为 1–8');
 if(mode==='pdf'&&!canExportPdf(o))throw Error('请先导入 PDF 并定位所选范围的全部小节，或改用功能谱画面');
 if(videoSeconds(o,cycles)>600)throw Error('视频最长 10 分钟，请缩短区间或减少循环次数');
 if(o.score.measures.slice(o.from,o.to+1).some(m=>m.notes.some(n=>!kit.some(k=>k.id===n.instrument))))throw Error('请先确认未映射鼓件');
 const transport=new Transport(),pages=new Map<number,ImageBitmap>();
 let cancelOutput:(()=>Promise<void>)|undefined;
 try{
  signal.throwIfAborted();await transport.prepare(o.soundKit||'synthetic');signal.throwIfAborted();
  if(mode==='pdf'){
   const pdf=new Blob([Uint8Array.from(atob(o.score.pdf!),c=>c.charCodeAt(0))],{type:'application/pdf'});
   const numbers=[...new Set(o.score.measures.slice(o.from,o.to+1).map(m=>m.pdfRegion!.page))];
   for(const page of numbers){
    const form=new FormData();form.append('file',pdf,'score.pdf');form.append('page',String(page));
    const response=await fetch('/api/pdf-page',{method:'POST',body:form,signal});
    if(!response.ok)throw Error('视频所需的 PDF 页面载入失败');
    pages.set(page,await createImageBitmap(await response.blob()));signal.throwIfAborted();
   }
  }
  await document.fonts.ready;signal.throwIfAborted();
  canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建视频画面');
  const offsets=starts(o.score),rangeBeats=offsets[o.to]+o.score.measures[o.to].beats-offsets[o.from];
  const kitName=soundKits.find(k=>k.id===o.soundKit)?.name||'原版合成';
  function draw(t:Tick,finished=false){
   const m=o.score.measures[t.measure],progress=finished?1:t.counting?0:Math.max(0,Math.min(1,((offsets[t.measure]-offsets[o.from]+t.beat)+rangeBeats*t.cycle)/(rangeBeats*cycles)));
   ctx!.fillStyle='#101713';ctx!.fillRect(0,0,1280,720);
   ctx!.font='bold 28px "DrumLab SC", sans-serif';ctx!.fillStyle='#e9f0eb';ctx!.fillText(o.score.title.slice(0,50),40,48,1000);
   ctx!.font='16px "DrumLab SC", sans-serif';ctx!.fillStyle='#a9bfaf';ctx!.fillText(`${o.bpm} BPM  ·  ${kitName}`,40,82);
   ctx!.textAlign='right';ctx!.fillStyle='#b6e4c8';ctx!.fillText(t.counting?'预备拍':finished?'播放完成':`第 ${t.measure+1} 小节 · 第 ${Math.floor(t.beat)+1} 拍`,1240,82);ctx!.textAlign='left';
   if(mode==='pdf'){
    const r=m.pdfRegion!,img=pages.get(r.page)!;
    const cropHeight=Math.min(1,Math.max(.15,r.height*2.3)),top=Math.max(0,Math.min(1-cropHeight,r.y-r.height*.6));
    const sy=top*img.height,sh=cropHeight*img.height,scale=Math.min(1200/img.width,420/sh),w=img.width*scale,h=sh*scale,x=(1280-w)/2,y=140+(420-h)/2;
    ctx!.fillStyle='#fff';ctx!.fillRect(x,y,w,h);ctx!.drawImage(img,0,sy,img.width,sh,x,y,w,h);
    if(!t.counting){
     const rx=x+r.x*img.width*scale,ry=y+(r.y*img.height-sy)*scale,rw=r.width*img.width*scale,rh=r.height*img.height*scale;
     ctx!.fillStyle='#27865226';ctx!.fillRect(rx,ry,rw,rh);ctx!.strokeStyle='#278652';ctx!.lineWidth=3;ctx!.strokeRect(rx,ry,rw,rh);
     const cursor=x+pdfCursorX(r,t.beat,m.beats)*img.width*scale;
     ctx!.strokeStyle='#e16a31';ctx!.beginPath();ctx!.moveTo(cursor,ry);ctx!.lineTo(cursor,ry+rh);ctx!.stroke();
    }
    ctx!.fillStyle='#a9bfaf';ctx!.fillText(`原始 PDF · 第 ${r.page+1} 页`,40,600);
   }else{
    const x=180,y=140,w=1060,row=49;
    ctx!.font='15px "DrumLab SC", sans-serif';
    for(let b=0;b<=m.beats;b+=.25){const bx=x+w*b/m.beats;ctx!.strokeStyle=Number.isInteger(b)?'#53675a':'#263c2e';ctx!.lineWidth=1;ctx!.beginPath();ctx!.moveTo(bx,y);ctx!.lineTo(bx,y+8*row);ctx!.stroke();if(Number.isInteger(b)&&b<m.beats){ctx!.fillStyle='#a9bfaf';ctx!.fillText(String(b+1),bx+5,y-12)}}
    kit.forEach((k,i)=>{ctx!.fillStyle=k.color;ctx!.fillText(k.name,40,y+i*row+30);ctx!.strokeStyle='#2a3c30';ctx!.beginPath();ctx!.moveTo(x,y+(i+1)*row);ctx!.lineTo(x+w,y+(i+1)*row);ctx!.stroke();for(const n of m.notes.filter(n=>n.instrument===k.id)){ctx!.beginPath();ctx!.arc(x+w*n.beat/m.beats,y+i*row+row/2,5+n.velocity/127*5,0,Math.PI*2);ctx!.fill()}});
    if(!t.counting){ctx!.fillStyle='#f69d62';ctx!.fillRect(x+w*t.beat/m.beats-1,y,3,8*row)}
    ctx!.fillStyle='#a9bfaf';ctx!.fillText('功能鼓谱 · 按当前编辑内容播放',40,600);
   }
   ctx!.fillStyle='#263c2e';ctx!.fillRect(40,638,1200,7);ctx!.fillStyle='#a9dfbd';ctx!.fillRect(40,638,1200*progress,7);
   ctx!.font='15px "DrumLab SC", sans-serif';ctx!.fillStyle='#a9bfaf';ctx!.fillText(`小节 ${o.from+1}–${o.to+1}  ·  第 ${Math.min(t.cycle+1,cycles)} / ${cycles} 遍`,40,685);ctx!.textAlign='right';ctx!.fillText('DrumLab',1240,685);ctx!.textAlign='left';
   // Frames use explicit media timestamps; preview speed does not affect export timing.
  }
  const {Output,Mp4OutputFormat,WebMOutputFormat,BufferTarget,CanvasSource,AudioBufferSource,Quality,getFirstEncodableVideoCodec,getFirstEncodableAudioCodec}=await import('mediabunny');
  const mp4=mime.includes('mp4'),quality=new Quality({bitrate:3_000_000});
  const videoCodec=await getFirstEncodableVideoCodec(mp4?['avc','vp9','av1']:['vp9','vp8'],{width:1280,height:720,frameRate:30,quality});
  const audioCodec=await getFirstEncodableAudioCodec(mp4?['aac','opus']:['opus'],{sampleRate:48000,numberOfChannels:2});
  if(!videoCodec||!audioCodec)throw Error('浏览器不支持此视频格式的编码，请换一种格式或使用新版 Chrome/Edge');
  signal.throwIfAborted();
  const frames=Math.ceil(videoSeconds(o,cycles)*30),duration=frames/30;
  onProgress(.03);const audioBuffer=await transport.renderOffline(o,cycles,duration,signal);onProgress(.1);
  const target=new BufferTarget(),output=new Output({format:mp4?new Mp4OutputFormat():new WebMOutputFormat(),target});
  cancelOutput=async()=>{if(output.state!=='finalized'&&output.state!=='canceled')await output.cancel()};
  const video=new CanvasSource(canvas,{codec:videoCodec,quality,keyFrameInterval:1}),audio=new AudioBufferSource({codec:audioCodec,quality:new Quality({bitrate:192_000})});
  output.addVideoTrack(video,{frameRate:30});output.addAudioTrack(audio);output.setMetadataTags({title:o.score.title});
  await output.start();await audio.add(audioBuffer);audio.close();
  for(let frame=0;frame<frames;frame++){
   signal.throwIfAborted();const seconds=frame/30,t=videoTick(o,seconds,cycles);draw(t,seconds>=videoSeconds(o,cycles)-.5);
   await video.add(seconds,1/30);onProgress(.1+.85*(frame+1)/frames);
   if(frame%15===0)await new Promise(resolve=>window.setTimeout(resolve,0));
  }
  video.close();signal.throwIfAborted();await output.finalize();signal.throwIfAborted();
  if(!target.buffer?.byteLength)throw Error('未生成有效视频');if(target.buffer.byteLength>256*1024*1024)throw Error('视频超过 256 MB，请缩短区间');
  onProgress(1);return {blob:new Blob([target.buffer],{type:mime}),extension:mp4?'mp4':'webm'};
 }finally{
  try{await cancelOutput?.()}finally{pages.forEach(image=>image.close());await transport.close()}
 }
}
