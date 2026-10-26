import {kit,starts,type Score} from './model';
export type TransportOptions={score:Score;bpm:number;from:number;to:number;loop:boolean;click:boolean;drums:boolean;countIn:boolean;buffer:AudioBuffer|null;audioBpm:number;offset:number;volume:number};
export type Tick={measure:number;beat:number;cycle:number;counting:boolean};
export class Transport {
 context:AudioContext|null=null; master:GainNode|null=null; timer=0; frame=0; running=false;
 sources=new Set<AudioScheduledSourceNode>(); samples=new Map<string,AudioBuffer>();
 async init(){if(!this.context){this.context=new AudioContext({latencyHint:'interactive'});this.master=this.context.createGain();this.master.connect(this.context.destination)} await this.context.resume();return this.context}
 stop(){this.running=false;window.clearInterval(this.timer);cancelAnimationFrame(this.frame);for(const s of this.sources){try{s.stop()}catch{ /* already ended */ }}this.sources.clear()}
 async decode(data:ArrayBuffer){const c=await this.init();return c.decodeAudioData(data.slice(0))}
 sample(instrument:string){
 const c=this.context!;if(this.samples.has(instrument))return this.samples.get(instrument)!;
 const dur=instrument==='openhat'||instrument==='crash'||instrument==='ride'?.7:instrument==='kick'?.28:.17;
 const b=c.createBuffer(1,Math.ceil(dur*c.sampleRate),c.sampleRate),d=b.getChannelData(0);let seed=113,prev=0;
 for(let i=0;i<d.length;i++){
 const t=i/c.sampleRate;seed=(seed*16807)%2147483647;const noise=seed/1073741824-1;const hi=noise-prev;prev=noise;
 d[i]=instrument==='kick'?Math.sin(2*Math.PI*(48*t+1.3*(1-Math.exp(-t*38))))*Math.exp(-t*20):instrument==='snare'?(noise*.65+Math.sin(2*Math.PI*180*t)*.35)*Math.exp(-t*28):instrument==='tom'||instrument==='floor'?Math.sin(2*Math.PI*(instrument==='floor'?90:145)*t)*Math.exp(-t*22):hi*.3*Math.exp(-t/(dur/5));
 }this.samples.set(instrument,b);return b;
 }
 playSample(id:string,at:number,velocity=90){
 const c=this.context!;const source=c.createBufferSource(),gain=c.createGain();source.buffer=this.sample(id);gain.gain.value=velocity/127*.55;source.connect(gain).connect(this.master!);this.track(source);source.start(at);
 }
 track(source:AudioScheduledSourceNode){this.sources.add(source);source.onended=()=>this.sources.delete(source)}
 click(at:number,accent:boolean){const c=this.context!,o=c.createOscillator(),g=c.createGain();o.frequency.value=accent?1450:950;g.gain.setValueAtTime(.15,at);g.gain.exponentialRampToValueAtTime(.0001,at+.045);o.connect(g).connect(this.master!);this.track(o);o.start(at);o.stop(at+.05)}
 async start(o:TransportOptions,onTick:(t:Tick)=>void,onEnd:()=>void,onError:(e:string)=>void){
 this.stop();const c=await this.init();this.master!.gain.value=o.volume;
 const offsets=starts(o.score),first=offsets[o.from],last=offsets[o.to]+o.score.measures[o.to].beats,beats=last-first,spb=60/o.bpm;
 const count=o.countIn?o.score.measures[o.from].beats:0,countUnit=4/o.score.measures[o.from].time[1],countClicks=Math.ceil(count/countUnit),epoch=c.currentTime+.12,start=epoch+count*spb,duration=beats*spb;
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
 a.playbackRate.value=ratio;a.loop=o.loop;a.loopStart=from;a.loopEnd=to;a.connect(this.master!);this.track(a);a.start(start,from);if(!o.loop)a.stop(start+duration);
 }
 let cycle=0,index=0,countIndex=0;this.running=true;
 const schedule=()=>{
 if(!this.running)return;const now=c.currentTime,horizon=now+.18;
 // A sleeping/backgrounded main thread cannot safely keep scheduling notes.
 const next=cycle*duration+(events[index]?.time??duration)+start;
 if(events.length&&next<now-.08&&now>start){this.stop();onError('播放调度被系统暂停，请保持练习页在前台后重新播放');return}
 while(countIndex<countClicks){const t=epoch+countIndex*countUnit*spb;if(t>horizon)break;this.click(t,countIndex===0);countIndex++}
 while(events.length){const e=events[index],t=start+cycle*duration+e.time;if(t>horizon)break;if(!o.loop&&cycle>0)break;
 if(e.id)this.playSample(e.id,t,e.velocity);else this.click(t,!!e.accent);
 index++;if(index===events.length){index=0;cycle++}if(cycle>100000)break;
 }
 };
 const animate=()=>{
 if(!this.running)return;const elapsed=c.currentTime-start;
 if(!o.loop&&elapsed>=duration){this.stop();onEnd();return}
 const beat=elapsed<0?0:((elapsed%duration)/spb)+first;
 let measure=o.from;while(measure<o.to&&beat>=offsets[measure+1])measure++;
 onTick({measure,beat:beat-offsets[measure],cycle:Math.max(0,Math.floor(elapsed/duration)),counting:elapsed<0});this.frame=requestAnimationFrame(animate)
 };
 schedule();this.timer=window.setInterval(schedule,25);animate();
 }
}
