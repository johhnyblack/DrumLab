import {kit,starts,type Score} from './model';
import {velocityLayer,type SoundKitId} from './sounds';
export type TransportOptions={score:Score;bpm:number;from:number;to:number;loop:boolean;click:boolean;drums:boolean;countIn:boolean;buffer:AudioBuffer|null;audioBpm:number;offset:number;volume:number;soundKit?:SoundKitId;cycles?:number};
export type Tick={measure:number;beat:number;cycle:number;counting:boolean};
export class Transport {
 context:AudioContext|null=null; master:GainNode|null=null; timer=0; frame=0; running=false;
 generation=0; soundKit:SoundKitId='synthetic'; openHats=new Set<AudioScheduledSourceNode>();
 sources=new Set<AudioScheduledSourceNode>(); samples=new Map<string,AudioBuffer>();
 async init(resume=true){if(!this.context){this.context=new AudioContext({latencyHint:'interactive'});this.master=this.context.createGain();this.master.connect(this.context.destination)} if(resume)await this.context.resume();return this.context}
 stop(){this.generation++;this.running=false;window.clearInterval(this.timer);cancelAnimationFrame(this.frame);for(const s of this.sources){try{s.stop()}catch{ /* already ended */ }}this.sources.clear();this.openHats.clear()}
 async decode(data:ArrayBuffer){const c=await this.init(false);return c.decodeAudioData(data.slice(0))}
 async prepare(id:SoundKitId){
 const c=await this.init();
 if(id!=='synthetic'){
  const missing=kit.flatMap(k=>[1,2,3,4,5].map(layer=>({key:`${id}/${k.id}/${layer}`,url:`/sounds/${id}/${k.id}-${layer}.ogg`}))).filter(f=>!this.samples.has(f.key));
  await Promise.all(missing.map(async f=>{const response=await fetch(f.url);if(!response.ok)throw Error('鼓采样载入失败，请刷新后重试');this.samples.set(f.key,await c.decodeAudioData(await response.arrayBuffer()))}));
 }
 this.soundKit=id;
 }
 async renderOffline(o:TransportOptions,cycles:number,duration:number,signal:AbortSignal){
 await this.prepare(o.soundKit||'synthetic');signal.throwIfAborted();
 const c=new OfflineAudioContext(2,Math.ceil(duration*48000),48000),master=c.createGain();master.gain.value=o.volume;master.connect(c.destination);
 const offsets=starts(o.score),first=offsets[o.from],beats=offsets[o.to]+o.score.measures[o.to].beats-first,spb=60/o.bpm,count=o.countIn?o.score.measures[o.from].beats:0;
 const events:{at:number;id?:string;velocity?:number;accent?:boolean}[]=[];
 const unit=4/o.score.measures[o.from].time[1];
 for(let b=0;b<count-1e-8;b+=unit)events.push({at:b*spb,accent:b===0});
 for(let cycle=0;cycle<cycles;cycle++)for(let m=o.from;m<=o.to;m++){
  signal.throwIfAborted();const bar=o.score.measures[m],base=count+cycle*beats+offsets[m]-first;
  if(o.drums)for(const n of bar.notes)if(kit.some(k=>k.id===n.instrument))events.push({at:(base+n.beat)*spb,id:n.instrument,velocity:n.velocity});
  if(o.click){const unit=4/bar.time[1];for(let b=0;b<bar.beats-1e-8;b+=unit)events.push({at:(base+b)*spb,accent:b===0})}
 }
 if(events.length>100000)throw Error('所选音符过多，请缩短视频区间');
 const hats=new Set<AudioBufferSourceNode>();
 for(const e of events.sort((a,b)=>a.at-b.at)){
  if(e.id){
   const source=c.createBufferSource(),gain=c.createGain();source.buffer=this.sample(e.id,e.velocity);gain.gain.value=(e.velocity||90)/127*.55;source.connect(gain).connect(master);
   if(e.id==='hihat'){for(const hat of hats)hat.stop(e.at+.005);hats.clear()}if(e.id==='openhat')hats.add(source);source.start(e.at);
  }else{
   const oscillator=c.createOscillator(),gain=c.createGain();oscillator.frequency.value=e.accent?1450:950;gain.gain.setValueAtTime(.15,e.at);gain.gain.exponentialRampToValueAtTime(.0001,e.at+.045);oscillator.connect(gain).connect(master);oscillator.start(e.at);oscillator.stop(e.at+.05);
  }
 }
 if(o.buffer){
  const from=o.offset+first*60/o.audioBpm,to=o.offset+(first+beats)*60/o.audioBpm;
  if(from<0||to>o.buffer.duration+.001)throw Error('录音长度不足以覆盖导出区间，请调整录音对齐或小节范围');
  const source=c.createBufferSource();source.buffer=o.buffer;source.playbackRate.value=o.bpm/o.audioBpm;source.loop=cycles>1;source.loopStart=from;source.loopEnd=to;source.connect(master);source.start(count*spb,from);source.stop((count+beats*cycles)*spb);
 }
 const buffer=await c.startRendering();signal.throwIfAborted();return buffer;
 }
 async close(){this.stop();await this.context?.close();this.context=null;this.master=null;this.samples.clear()}
 sample(instrument:string,velocity=90){
 if(this.soundKit!=='synthetic'){
  const sample=this.samples.get(`${this.soundKit}/${instrument}/${velocityLayer(velocity)}`);
  if(!sample)throw Error('鼓采样尚未载入');return sample;
 }

 const c=this.context!,key=`synthetic/${instrument}`;if(this.samples.has(key))return this.samples.get(key)!;
 const dur=instrument==='openhat'||instrument==='crash'||instrument==='ride'?.7:instrument==='kick'?.28:.17;
 const b=c.createBuffer(1,Math.ceil(dur*c.sampleRate),c.sampleRate),d=b.getChannelData(0);let seed=113,prev=0;
 for(let i=0;i<d.length;i++){
 const t=i/c.sampleRate;seed=(seed*16807)%2147483647;const noise=seed/1073741824-1;const hi=noise-prev;prev=noise;
 d[i]=instrument==='kick'?Math.sin(2*Math.PI*(48*t+1.3*(1-Math.exp(-t*38))))*Math.exp(-t*20):instrument==='snare'?(noise*.65+Math.sin(2*Math.PI*180*t)*.35)*Math.exp(-t*28):instrument==='tom'||instrument==='floor'?Math.sin(2*Math.PI*(instrument==='floor'?90:145)*t)*Math.exp(-t*22):hi*.3*Math.exp(-t/(dur/5));
 }this.samples.set(key,b);return b;
 }
 playSample(id:string,at:number,velocity=90){
 const c=this.context!;const source=c.createBufferSource(),gain=c.createGain();source.buffer=this.sample(id,velocity);if(id==='hihat'){for(const hat of this.openHats){try{hat.stop(at+.005)}catch{}}this.openHats.clear()}if(id==='openhat')this.openHats.add(source);gain.gain.value=velocity/127*.55;source.connect(gain).connect(this.master!);this.track(source);source.start(at);
 }
 track(source:AudioScheduledSourceNode){this.sources.add(source);source.onended=()=>{this.sources.delete(source);this.openHats.delete(source)}}
 click(at:number,accent:boolean){const c=this.context!,o=c.createOscillator(),g=c.createGain();o.frequency.value=accent?1450:950;g.gain.setValueAtTime(.15,at);g.gain.exponentialRampToValueAtTime(.0001,at+.045);o.connect(g).connect(this.master!);this.track(o);o.start(at);o.stop(at+.05)}
 async start(o:TransportOptions,onTick:(t:Tick)=>void,onEnd:()=>void,onError:(e:string)=>void){
 this.stop();const generation=this.generation;await this.prepare(o.soundKit||'synthetic');if(generation!==this.generation)return;const c=this.context!;this.master!.gain.value=o.volume;
 const offsets=starts(o.score),first=offsets[o.from],last=offsets[o.to]+o.score.measures[o.to].beats,beats=last-first,spb=60/o.bpm;
 const count=o.countIn?o.score.measures[o.from].beats:0,countUnit=4/o.score.measures[o.from].time[1],countClicks=Math.ceil(count/countUnit),epoch=c.currentTime+.12,start=epoch+count*spb,duration=beats*spb,limit=o.loop?(o.cycles??Infinity):1;
 const events:{time:number;id?:string;velocity?:number;accent?:boolean}[]=[];
 for(let m=o.from;m<=o.to;m++){
 const bar=o.score.measures[m],base=offsets[m]-first;
 if(o.drums)for(const n of bar.notes)if(kit.some(k=>k.id===n.instrument))events.push({time:(base+n.beat)*spb,id:n.instrument,velocity:n.velocity});
 if(o.click){const unit=4/bar.time[1];for(let b=0;b<bar.beats-1e-8;b+=unit)events.push({time:(base+b)*spb,accent:b===0})}
 }events.sort((a,b)=>a.time-b.time);
 // The recording is scheduled once and loops inside the audio renderer.
 if(o.buffer){
 const a=c.createBufferSource();a.buffer=o.buffer;const ratio=o.bpm/o.audioBpm,from=o.offset+first*60/o.audioBpm,to=o.offset+last*60/o.audioBpm;
 if(from<0||to>o.buffer.duration+.001){this.stop();throw Error('录音长度不足以覆盖循环区间，请调整原录音 BPM、起点偏移或循环范围')}
 a.playbackRate.value=ratio;a.loop=o.loop;a.loopStart=from;a.loopEnd=to;a.connect(this.master!);this.track(a);a.start(start,from);if(Number.isFinite(limit))a.stop(start+duration*limit);
 }
 let cycle=0,index=0,countIndex=0;this.running=true;
 const schedule=()=>{
 if(!this.running)return;const now=c.currentTime,horizon=now+.18;
 // A sleeping/backgrounded main thread cannot safely keep scheduling notes.
 const next=cycle*duration+(events[index]?.time??duration)+start;
 if(events.length&&next<now-.08&&now>start){this.stop();onError('播放调度被系统暂停，请保持练习页在前台后重新播放');return}
 while(countIndex<countClicks){const t=epoch+countIndex*countUnit*spb;if(t>horizon)break;this.click(t,countIndex===0);countIndex++}
 while(events.length){const e=events[index],t=start+cycle*duration+e.time;if(t>horizon)break;if(cycle>=limit)break;
 if(e.id)this.playSample(e.id,t,e.velocity);else this.click(t,!!e.accent);
 index++;if(index===events.length){index=0;cycle++}if(cycle>100000)break;
 }
 };
 const animate=()=>{
 if(!this.running)return;const elapsed=c.currentTime-start;
 if(elapsed>=duration*limit){this.stop();onEnd();return}
 const beat=elapsed<0?0:((elapsed%duration)/spb)+first;
 let measure=o.from;while(measure<o.to&&beat>=offsets[measure+1])measure++;
 onTick({measure,beat:beat-offsets[measure],cycle:Math.max(0,Math.floor(elapsed/duration)),counting:elapsed<0});this.frame=requestAnimationFrame(animate)
 };
 schedule();this.timer=window.setInterval(schedule,25);animate();
 }
}
