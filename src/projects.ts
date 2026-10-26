import {kit,validateScore,type Score} from './model';
export type ProjectSettings={bpm:number;selected:number;from:number;to:number;loop:boolean;click:boolean;drums:boolean;countIn:boolean;division:number;volume:number;audioBpm:number;offset:number;reduction:number;normalize:boolean;useFixed:boolean;includeAudio:boolean;tab:string;audioName:string;wave:number[];stats:unknown};
export type ProjectSummary={id:string;title:string;source:string;measures:number;bpm:number;notes:number;thumbnail:string;createdAt:string;updatedAt:string;revision:number;hasPdf:boolean;hasAudio:boolean};
export type ProjectDraft={score:Score;settings:ProjectSettings;original:Blob|null;processed:Blob|null};
export type OpenProject={project:ProjectSummary;score:Score;settings:Partial<ProjectSettings>;media:string[];original:Blob|null;processed:Blob|null};
export function projectDefaults(s:Score):ProjectSettings{return {bpm:s.bpm,selected:0,from:0,to:Math.min(3,s.measures.length-1),loop:true,click:true,drums:true,countIn:true,division:4,volume:.65,audioBpm:s.bpm,offset:0,reduction:.35,normalize:true,useFixed:true,includeAudio:false,tab:'score',audioName:'',wave:[],stats:null}}
export function normalizeSettings(s:Score,value:Partial<ProjectSettings>):ProjectSettings{
 const defaults=projectDefaults(s),result={...defaults};
 for(const key of Object.keys(defaults) as (keyof ProjectSettings)[]){const v=value[key];if(typeof v===typeof defaults[key]&&typeof v!=='object'&&typeof v!=='undefined')(result as Record<string,unknown>)[key]=v}
 const index=(v:number)=>Math.max(0,Math.min(s.measures.length-1,Number.isInteger(v)?v:0));
 result.selected=index(result.selected);result.from=index(result.from);result.to=Math.max(result.from,index(result.to));
 for(const key of ['bpm','audioBpm'] as const)result[key]=Number.isFinite(result[key])?Math.max(20,Math.min(300,result[key])):s.bpm;
 result.volume=Math.max(0,Math.min(1,result.volume));result.reduction=Math.max(0,Math.min(1,result.reduction));result.offset=Math.max(0,Number.isFinite(result.offset)?result.offset:0);
 if(![2,3,4,8].includes(result.division))result.division=4;
 result.tab=result.tab==='audio'?'audio':'score';result.wave=Array.isArray(value.wave)?value.wave.filter(Number.isFinite).slice(0,320):[];result.stats=value.stats||null;
 return result;
}
function thumbnail(score:Score){
 const canvas=document.createElement('canvas');canvas.width=280;canvas.height=160;const g=canvas.getContext('2d');if(!g)return '';
 g.fillStyle='#162019';g.fillRect(0,0,280,160);g.font='13px "DrumLab SC",sans-serif';g.fillStyle='#d5eadc';g.fillText(score.title.slice(0,25),12,23,255);
 const bar=score.measures[0];
 kit.forEach((k,i)=>{g.fillStyle='#2b4031';g.fillRect(12,38+i*13,256,1);g.fillStyle=k.color;for(const n of bar.notes.filter(n=>n.instrument===k.id)){g.beginPath();g.arc(16+n.beat/bar.beats*246,42+i*13,2.5,0,Math.PI*2);g.fill()}});
 return canvas.toDataURL('image/png');
}
const stripped=(s:Score)=>({...s,pdf:undefined,importedScore:s.importedScore?{...s.importedScore,pdf:undefined}:undefined});
const keyOf=(d:ProjectDraft)=>JSON.stringify({score:stripped(d.score),settings:d.settings});
async function json<T>(url:string,options?:RequestInit):Promise<T>{
 const response=await fetch(url,options),data=await response.json();if(!response.ok)throw Error(data.detail||'本地项目保存失败');return data;
}
export class ProjectLibrary{
 private serial=0; private tail:Promise<unknown>=Promise.resolve();private timer=0;private pending:{id:string;draft:ProjectDraft;serial:number}|null=null;
 private revisions=new Map<string,number>();private saved=new Map<string,string>();private media=new Map<string,{original:Blob|null;processed:Blob|null}>();private jobs=0;
 constructor(private onSaved:(p:ProjectSummary)=>void,private onStatus:(s:'saving'|'saved'|'error')=>void,private onError:(message:string)=>void){}
 private queue<T>(fn:()=>Promise<T>):Promise<T>{const next=this.tail.then(fn);this.tail=next.catch(()=>{});return next}
 list(){return json<ProjectSummary[]>('/api/projects')}
 schedule(id:string,draft:ProjectDraft){
  const media=this.media.get(id);if(this.saved.get(id)===keyOf(draft)&&media?.original===draft.original&&media?.processed===draft.processed&&!this.pending)return;
  this.pending={id,draft,serial:++this.serial};
  try{localStorage.setItem('drumlab-project-recovery',JSON.stringify({id,score:stripped(draft.score),settings:draft.settings,key:keyOf(draft),revision:this.revisions.get(id)}))}catch{}
this.onStatus('saving');window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>{void this.flush().catch(()=>{})},450);
 }
 async flush(){
  window.clearTimeout(this.timer);const pending=this.pending;this.pending=null;this.jobs++;
  return this.queue(async()=>{
   try{if(pending)await this.write(pending.id,pending.draft)}
   catch(e){if(!this.pending&&pending?.serial===this.serial)this.pending=pending;this.onStatus('error');this.onError(e instanceof Error?e.message:String(e));throw e}
   finally{this.jobs--;if(!this.pending&&!this.jobs)this.onStatus('saved')}
  });
 }
 private async saveMedia(id:string,d:ProjectDraft){
  const old=this.media.get(id)||{original:null,processed:null};
  for(const kind of ['original','processed'] as const){
   if(old[kind]===d[kind])continue;
   if(d[kind]){const form=new FormData();form.append('file',d[kind]!,kind==='processed'?'processed.wav':d.settings.audioName||'recording.wav');await json(`/api/projects/${id}/audio/${kind}`,{method:'PUT',headers:{'X-DrumLab-Revision':String(this.revisions.get(id))},body:form})}
   else await json(`/api/projects/${id}/audio/${kind}`,{method:'DELETE',headers:{'X-DrumLab-Revision':String(this.revisions.get(id))}});
   old[kind]=d[kind];this.media.set(id,{...old});
  }
  this.media.set(id,{...old});
 }
 private async write(id:string,d:ProjectDraft){
  const project=await json<ProjectSummary>(`/api/projects/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({score:stripped(d.score),settings:d.settings,thumbnail:thumbnail(d.score),revision:this.revisions.get(id)})});
  this.revisions.set(id,project.revision);await this.saveMedia(id,d);this.saved.set(id,keyOf(d));
  try{const pending=JSON.parse(localStorage.getItem('drumlab-project-recovery')||'null');if(pending?.id===id&&pending.key===keyOf(d))localStorage.removeItem('drumlab-project-recovery')}catch{}
  this.onSaved({...project,hasAudio:!!(d.original||d.processed)});
 }
 async create(d:ProjectDraft){
  await this.flush();return this.queue(async()=>{
   const project=await json<ProjectSummary>('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score:d.score,settings:d.settings,thumbnail:thumbnail(d.score)})});
   this.revisions.set(project.id,project.revision);await this.saveMedia(project.id,d);this.saved.set(project.id,keyOf(d));
   const updated={...project,hasAudio:!!(d.original||d.processed)};this.onSaved(updated);return updated;
  });
 }
 async open(id:string){
  await this.flush();return this.queue(async()=>{
   const data=await json<OpenProject>(`/api/projects/${id}`);data.score=validateScore(data.score);
   const fetchAudio=async(kind:string)=>{if(!data.media.includes(kind))return null;const r=await fetch(`/api/projects/${id}/audio/${kind}`);if(!r.ok)throw Error('本地录音载入失败');return r.blob()};
   [data.original,data.processed]=await Promise.all([fetchAudio('original'),fetchAudio('processed')]);
   this.revisions.set(id,data.project.revision);this.media.set(id,{original:data.original,processed:data.processed});this.saved.set(id,keyOf({score:data.score,settings:normalizeSettings(data.score,data.settings),original:data.original,processed:data.processed}));return data;
  });
 }
 recovery(){try{const data=JSON.parse(localStorage.getItem('drumlab-project-recovery')||'null');if(data&&typeof data.id==='string'&&typeof data.key==='string')return {...data,score:validateScore(data.score)} as {id:string;score:Score;settings:ProjectSettings;key:string;revision:number}}catch{}return null}
 markLoaded(id:string,d:ProjectDraft){this.saved.set(id,keyOf(d));this.media.set(id,{original:d.original,processed:d.processed})}
 async rename(id:string,title:string){await this.flush();return this.queue(async()=>{const p=await json<ProjectSummary>(`/api/projects/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,revision:this.revisions.get(id)})});this.revisions.set(id,p.revision);this.onSaved(p);return p})}
 async remove(id:string){await this.flush();await this.queue(()=>json(`/api/projects/${id}`,{method:'DELETE'}));this.revisions.delete(id);this.saved.delete(id);this.media.delete(id)}
 rememberSummaries(projects:ProjectSummary[]){projects.forEach(p=>{if(!this.revisions.has(p.id))this.revisions.set(p.id,p.revision)})}
}
