import {useRef,useState} from 'react';
import {AudioLines,Plus,Search,FileMusic,MoreHorizontal,Pencil,Trash2,Mic,PanelLeftClose,X} from 'lucide-react';
import type {ProjectSummary} from './projects';
type Props={projects:ProjectSummary[];active:string;tab:string;disabled:boolean;open:boolean;onClose:()=>void;onNew:()=>void;onImport:()=>void;onOpen:(id:string)=>void;onRename:(p:ProjectSummary,title:string)=>void;onDelete:(p:ProjectSummary)=>void;onTab:(tab:string)=>void};
export function ProjectSidebar(p:Props){
 const [query,setQuery]=useState(''),[menu,setMenu]=useState(''),[editing,setEditing]=useState(''),[name,setName]=useState('');
 const editingRef=useRef('');
 const today=new Date();today.setHours(0,0,0,0);const week=today.getTime()-6*86400000;
 const matches=p.projects.filter(s=>(s.title+' '+s.source).toLowerCase().includes(query.toLowerCase()));
 const groups=[{name:'今天',items:matches.filter(s=>Date.parse(s.updatedAt)>=today.getTime())},{name:'最近 7 天',items:matches.filter(s=>Date.parse(s.updatedAt)<today.getTime()&&Date.parse(s.updatedAt)>=week)},{name:'更早',items:matches.filter(s=>Date.parse(s.updatedAt)<week)}];
 function rename(project:ProjectSummary){if(editingRef.current!==project.id)return;editingRef.current='';const title=name.trim();if(title&&title!==project.title)p.onRename(project,title);setEditing('')}
 return <>{p.open&&<button className="sidebar-scrim" aria-label="关闭项目列表" onClick={p.onClose}/>}<aside className={`sidebar project-sidebar ${p.open?'is-open':''}`} aria-label="本地项目列表" inert={!p.open} aria-hidden={!p.open}>
  <div className="library-brand"><a className="brand" href="#"><span className="logo"><AudioLines size={25}/></span>DrumLab</a><button className="icon-button sidebar-collapse" onClick={p.onClose} aria-label="收起项目列表"><PanelLeftClose size={17}/></button></div>
  <div className="library-actions"><button className="button primary" onClick={p.onNew} disabled={p.disabled}><Plus size={17}/>新建项目</button><button className="button" onClick={p.onImport} disabled={p.disabled}><FileMusic size={16}/>导入鼓谱</button></div>
  <label className="project-search"><Search size={15}/><input aria-label="搜索本地项目" placeholder="搜索项目" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清除项目搜索" onClick={()=>setQuery('')}><X size={13}/></button>}</label>
  <div className="library-list">{groups.map(group=>group.items.length>0&&<section key={group.name}><h2>{group.name}</h2>{group.items.map(project=><div className={`history-project ${p.active===project.id?'active':''}`} key={project.id}>
   {editing===project.id?<input className="project-rename" aria-label="项目新名称" value={name} maxLength={200} autoFocus onChange={e=>setName(e.target.value)} onBlur={()=>rename(project)} onKeyDown={e=>{if(e.key==='Enter')rename(project);if(e.key==='Escape'){editingRef.current='';setEditing('')}}}/>:<button className="history-open" disabled={p.disabled} aria-label={`打开项目 ${project.title}`} aria-current={p.active===project.id?'page':undefined} onClick={()=>{setMenu('');p.onOpen(project.id)}}>{project.thumbnail?<img src={project.thumbnail} alt=""/>:<FileMusic size={22}/>}<span><strong>{project.title||'未命名项目'}</strong><small>{project.measures} 小节 · {project.hasPdf?'PDF':'鼓谱'}{project.hasAudio?' · 含录音':''}</small></span></button>}
   <button className="history-menu-button" aria-label={`管理项目 ${project.title}`} disabled={p.disabled} onClick={()=>setMenu(menu===project.id?'':project.id)}><MoreHorizontal size={17}/></button>
   {menu===project.id&&<div className="history-menu"><button disabled={p.disabled} onClick={()=>{setName(project.title);editingRef.current=project.id;setEditing(project.id);setMenu('')}}><Pencil size={14}/>重命名</button><button className="danger" disabled={p.disabled} onClick={()=>{setMenu('');p.onDelete(project)}}><Trash2 size={14}/>删除项目</button></div>}
  </div>)}</section>)}{!matches.length&&<p className="history-empty">{query?'没有找到匹配的项目':'导入或新建项目后，会保存在这里。'}</p>}</div>
  <nav className="library-navigation"><button className={p.tab==='score'?'active':''} onClick={()=>p.onTab('score')} disabled={p.disabled}><FileMusic size={18}/>功能鼓谱</button><button className={p.tab==='audio'?'active':''} onClick={()=>p.onTab('audio')} disabled={p.disabled}><Mic size={18}/>录音工作台</button></nav>
  <div className="library-local"><span className="online"/>保存在这台电脑<small>鼓谱 · PDF · 录音 · 练习设置</small></div>
 </aside></>;
}
