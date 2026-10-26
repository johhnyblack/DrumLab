export const kit = [
 {id:'crash',name:'吊镲',short:'CR',color:'#ddb76a'}, {id:'ride',name:'叮叮镲',short:'RD',color:'#cabb8b'},
 {id:'hihat',name:'闭踩镲',short:'HH',color:'#a8cba0'}, {id:'openhat',name:'开踩镲',short:'OH',color:'#85aa83'},
 {id:'tom',name:'通鼓',short:'TM',color:'#c5acd8'}, {id:'snare',name:'军鼓',short:'SN',color:'#ee9b83'},
 {id:'floor',name:'落地鼓',short:'FT',color:'#b6a0c9'}, {id:'kick',name:'底鼓',short:'BD',color:'#8abcc9'}];
export type Note={id:string;beat:number;duration:number;instrument:string;velocity:number;hand:string;source?:string};
export type Measure={id:string;number:number;beats:number;time:[number,number];label:string;notes:Note[]};
export type Score={title:string;bpm:number;measures:Measure[];warnings:string[];needsReview:boolean;source:string;tempos:{beat:number;bpm:number}[];pdf?:string};
export const uid=()=>crypto.randomUUID();
export function demo():Score {
 return {title:'Pocket Session',bpm:96,source:'DrumLab 示例 · 8 小节 Funk',warnings:[],needsReview:false,tempos:[],measures:Array.from({length:8},(_,m)=>({id:uid(),number:m+1,beats:4,time:[4,4],label:m===0?'A · 建立律动':m===4?'B · 加入变化':'',notes:[...Array.from({length:8},(_,i)=>({id:uid(),beat:i/2,duration:.5,instrument:'hihat',velocity:i%2?60:82,hand:i%2?'L':'R'})),...[0,2,...(m>=4?[2.75]:[])].map(beat=>({id:uid(),beat,duration:.25,instrument:'kick',velocity:100,hand:'RF'})),...[1,3].map(beat=>({id:uid(),beat,duration:.25,instrument:'snare',velocity:100,hand:'L'}))]}))};
}
export function starts(score:Score){let beat=0;return score.measures.map(m=>{const b=beat;beat+=m.beats;return b})}
export function validateScore(value:unknown):Score {
 const s=value as Score;
 if(!s||typeof s.title!=='string'||!Number.isFinite(s.bpm)||s.bpm<20||s.bpm>300||!Array.isArray(s.measures)||!s.measures.length||s.measures.length>500)throw Error('项目结构或 BPM 无效');
 for(const m of s.measures){
 if(typeof m.id!=='string'||!Number.isFinite(m.beats)||m.beats<=0||m.beats>32||!Array.isArray(m.time)||m.time.length!==2||!Array.isArray(m.notes)||m.notes.length>10000)throw Error('小节结构无效');
 for(const n of m.notes)if(typeof n.id!=='string'||!Number.isFinite(n.beat)||n.beat<0||n.beat>=m.beats||!Number.isFinite(n.velocity)||n.velocity<1||n.velocity>127||!Number.isFinite(n.duration)||n.duration<0||typeof n.instrument!=='string')throw Error('音符位置或力度无效');
 }
 return {...s,warnings:s.warnings||[],tempos:s.tempos||[],needsReview:!!s.needsReview};
}
export function toWav(buffer:AudioBuffer):ArrayBuffer {
 // Float WAV preserves headroom and decoded precision before backend repair.
 const channels=buffer.numberOfChannels,frames=buffer.length;
 const out=new ArrayBuffer(44+frames*channels*4),v=new DataView(out);
 const str=(o:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
 str(0,'RIFF');v.setUint32(4,out.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*4,true);v.setUint16(32,channels*4,true);v.setUint16(34,32,true);str(36,'data');v.setUint32(40,frames*channels*4,true);
 for(let f=0;f<frames;f++)for(let c=0;c<channels;c++)v.setFloat32(44+(f*channels+c)*4,buffer.getChannelData(c)[f],true);
 return out;
}
