import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {Transport} from './engine';
import {velocityLayer} from './sounds';
import {videoSeconds,videoTick,canExportPdf} from './video';
import {demo,starts,validateScore,toWav,rememberImport,resetImportedScore,pdfCursorX} from './model';
class Param {value=0;setValueAtTime(){}exponentialRampToValueAtTime(){}}
let started:any[]=[],stopped=0;
class Node {gain=new Param();frequency=new Param();playbackRate=new Param();buffer:any;loop=false;loopStart=0;loopEnd=0;onended:any;connect(){return this}start(...args:any[]){started.push({args,buffer:this.buffer,rate:this.playbackRate.value,loop:this.loop,from:this.loopStart,to:this.loopEnd})}stop(){stopped++}}
class Context {currentTime=0;sampleRate=1000;destination={};decodeAudioData(){return Promise.resolve({duration:1} as AudioBuffer)}resume(){return Promise.resolve()}createGain(){return new Node()}createOscillator(){return new Node()}createBufferSource(){return new Node()}createBuffer(_:number,length:number){return {getChannelData:()=>new Float32Array(length)}}}
let t:Transport;
beforeEach(()=>{vi.useFakeTimers();started=[];stopped=0;vi.stubGlobal('AudioContext',Context);vi.stubGlobal('window',globalThis);vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});t=new Transport()});afterEach(()=>{t.stop();vi.useRealTimers();vi.unstubAllGlobals()});
describe('sample-clock transport',()=>{
 it('schedules coincident kick, hat and click at exactly the same timestamp',async()=>{const s=demo();await t.start({score:s,bpm:120,from:0,to:0,loop:true,click:true,drums:true,countIn:false,buffer:null,audioBpm:96,offset:0,volume:.5},()=>{},()=>{},()=>{});expect(started.filter(e=>e.args[0]===.12)).toHaveLength(3)});
 it('uses original BPM offsets and practice BPM rate on one looping audio source',async()=>{const buffer={duration:30} as AudioBuffer;await t.start({score:demo(),bpm:48,from:1,to:2,loop:true,click:false,drums:false,countIn:true,buffer,audioBpm:96,offset:.3,volume:.5},()=>{},()=>{},()=>{});expect(started.filter(e=>e.buffer===buffer)).toHaveLength(1);expect(started[0].rate).toBe(.5);expect(started[0].from).toBe(2.8);expect(started[0].to).toBe(7.8);expect(started[0].args[0]).toBeCloseTo(5.12);t.stop();expect(t.sources.size).toBe(0);expect(stopped).toBeGreaterThanOrEqual(2)});
 it('uses denominator beats for a 6/8 count-in while retaining exact bar length',async()=>{const score=demo();score.measures[0]={...score.measures[0],beats:3,time:[6,8],notes:[]};await t.start({score,bpm:120,from:0,to:0,loop:true,click:false,drums:false,countIn:true,buffer:null,audioBpm:96,offset:0,volume:.5},()=>{},()=>{},()=>{});for(let i=1;i<=55;i++){(t.context as unknown as Context).currentTime=i*.025;vi.advanceTimersByTime(25)}expect(started.map(e=>e.args[0])).toEqual([.12,.37,.62,.87,1.12,1.37])});
 it('rejects a recording too short for the requested loop',async()=>{await expect(t.start({score:demo(),bpm:96,from:0,to:3,loop:true,click:true,drums:true,countIn:false,buffer:{duration:1} as AudioBuffer,audioBpm:96,offset:0,volume:1},()=>{},()=>{},()=>{})).rejects.toThrow('录音长度不足')});
 it('schedules next-cycle notes at the exact loop boundary',async()=>{await t.start({score:demo(),bpm:120,from:0,to:0,loop:true,click:true,drums:true,countIn:false,buffer:null,audioBpm:96,offset:0,volume:.5},()=>{},()=>{},()=>{});for(let i=1;i<=82;i++){(t.context as unknown as Context).currentTime=i*.025;vi.advanceTimersByTime(25)}expect(started.filter(e=>Math.abs(e.args[0]-2.12)<1e-8)).toHaveLength(3)});
 it('stops with a clear error after a scheduler stall',async()=>{const error=vi.fn();await t.start({score:demo(),bpm:96,from:0,to:0,loop:true,click:true,drums:true,countIn:false,buffer:null,audioBpm:96,offset:0,volume:.5},()=>{},()=>{},error);(t.context as unknown as Context).currentTime=4;vi.advanceTimersByTime(25);expect(error).toHaveBeenCalledOnce();expect(t.running).toBe(false)});
});
describe('project model',()=>{
 it('encodes browser recordings as float WAV without destroying clipped headroom',()=>{const data=toWav({numberOfChannels:1,length:3,sampleRate:48000,getChannelData:()=>new Float32Array([1.2,-1.1,.12345])} as unknown as AudioBuffer),view=new DataView(data);expect(view.getUint16(20,true)).toBe(3);expect(view.getUint32(24,true)).toBe(48000);expect(view.getUint16(34,true)).toBe(32);expect(view.getFloat32(44,true)).toBeCloseTo(1.2);expect(view.getFloat32(48,true)).toBeCloseTo(-1.1)});

 it('computes variable-length measure offsets without 4/4 assumptions',()=>{const s=demo();s.measures[0].beats=3;s.measures[1].beats=3.5;expect(starts(s).slice(0,3)).toEqual([0,3,6.5])});
 it('rejects empty projects and out-of-measure notes',()=>{expect(()=>validateScore({...demo(),measures:[]})).toThrow();const s=demo();s.measures[0].notes[0].beat=4;expect(()=>validateScore(s)).toThrow()});
});

describe('import baseline and PDF cursor',()=>{
 it('restores imported notes, deleted measures and metadata after project serialization',()=>{
  const original=rememberImport(demo()),s=structuredClone(original);
  s.measures[0].notes[0].velocity=1;s.measures[0].notes=[];s.measures.splice(1,1);s.title='Changed';
  const restored=resetImportedScore(validateScore(JSON.parse(JSON.stringify(s))));
  expect(restored.measures).toEqual(original.measures);expect(restored.title).toBe(original.title);
  restored.measures[0].notes=[];expect(restored.importedScore!.measures[0].notes.length).toBeGreaterThan(0);
 });
 it('uses actual PDF rhythm anchors rather than uniform spacing',()=>{
  const region={page:0,x:.1,y:.2,width:.8,height:.1,anchors:[{beat:0,x:.2},{beat:1,x:.3},{beat:3,x:.8}],source:'omr' as const};
  expect(pdfCursorX(region,0,4)).toBe(.2);expect(pdfCursorX(region,2,4)).toBeCloseTo(.55);expect(pdfCursorX(region,4,4)).toBeCloseTo(.9);
  expect(pdfCursorX({...region,anchors:[]},2,4)).toBeCloseTo(.5);
 });
 it('rejects out-of-page imported PDF positions',()=>{
  const s=demo();s.measures[0].pdfRegion={page:0,x:.9,y:0,width:.4,height:.1,anchors:[],source:'manual'};
  expect(()=>validateScore(s)).toThrow('原谱定位');
 });
});

describe('sampled kits and export timeline',()=>{
 it('matches the original five AVL velocity boundaries',()=>{
  expect([1,26,27,52,53,77,78,102,103,127].map(velocityLayer)).toEqual([1,1,2,2,3,3,4,4,5,5]);
 });
 it('uses the same imported range, count-in and repeated meters for video timing',()=>{
  const score=demo();score.measures[1].beats=3;score.measures[1].time=[6,8];
  const o={score,bpm:120,from:1,to:2,loop:true,click:true,drums:true,countIn:true,buffer:null,audioBpm:96,offset:0,volume:.5};
  expect(videoSeconds(o,2)).toBe(9);
  expect(videoTick(o,1,2)).toMatchObject({measure:1,counting:true});
  expect(videoTick(o,1.5,2)).toMatchObject({measure:1,beat:0,cycle:0});
  expect(videoTick(o,3,2)).toMatchObject({measure:2,beat:0,cycle:0});
  expect(videoTick(o,5,2)).toMatchObject({measure:1,beat:0,cycle:1});
  expect(videoTick(o,8.7,2)).toMatchObject({measure:2,cycle:1,counting:false});
 });
 it('does not allow PDF video when a selected measure lacks a location',()=>{
  const o={score:demo(),bpm:96,from:0,to:1,loop:false,click:true,drums:true,countIn:false,buffer:null,audioBpm:96,offset:0,volume:.5};
  o.score.pdf='encoded';o.score.measures[0].pdfRegion={page:0,x:0,y:0,width:.5,height:.1,anchors:[],source:'manual'};
  expect(canExportPdf(o)).toBe(false);o.to=0;expect(canExportPdf(o)).toBe(true);
 });
});

it('does not start delayed samples after playback has been stopped',async()=>{
 let ready!:()=>void;vi.spyOn(t,'prepare').mockImplementation(()=>new Promise<void>(resolve=>{ready=resolve}));
 const pending=t.start({score:demo(),bpm:96,from:0,to:0,loop:false,click:true,drums:true,countIn:false,buffer:null,audioBpm:96,offset:0,volume:.5},()=>{},()=>{},()=>{});
 t.stop();ready();await pending;expect(t.running).toBe(false);expect(started).toHaveLength(0);
});

it('restores audio buffers without waiting for browser autoplay permission',async()=>{
 const resume=vi.spyOn(Context.prototype,'resume');const buffer=await t.decode(new ArrayBuffer(4));
 expect(buffer.duration).toBe(1);expect(resume).not.toHaveBeenCalled();resume.mockRestore();
});
