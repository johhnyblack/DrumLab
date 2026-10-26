import {test,expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'X-DrumLab-Workspace':'e2e-'+crypto.randomUUID()})});
const sample=(name:string)=>path.resolve('samples',name);
test('edit precise note, save, reload, export and restore project',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.getByRole('heading',{name:'把鼓谱，变成你的练习。'})).toBeVisible();
 await page.getByRole('button',{name:'吊镲 第1.25拍',exact:true}).click();await page.getByLabel('音符力度',{exact:true}).fill('64');await page.getByLabel('音符手脚',{exact:true}).selectOption('R');
 await page.getByLabel('音符拍点',{exact:true}).fill('1.3333333333');
 await page.reload();await page.getByLabel('选择音符',{exact:true}).selectOption({label:'吊镲 · 1.333拍'});await expect(page.getByLabel('音符力度',{exact:true})).toHaveValue('64');
 const waitDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目',exact:true}).click();const d=await waitDownload;const contents=JSON.parse(await fs.readFile((await d.path())!,'utf8'));expect(contents.measures[0].notes.find((n:any)=>n.instrument==='crash').beat).toBeCloseTo(1/3);
 await page.getByLabel('鼓谱标题').fill('Edited');await page.locator('input[type=file]').nth(2).setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(contents))});await expect(page.getByLabel('鼓谱标题')).toHaveValue('Pocket Session');expect(errors).toEqual([]);
});
test('MusicXML and MXL import preserve tuplets and simultaneous hits',async({page})=>{
 await page.goto('/');for(const name of ['Tuplet-Pocket.musicxml','Tuplet-Pocket.mxl']){
 await page.locator('input[type=file]').nth(0).setInputFiles(sample(name));await expect(page.getByLabel('鼓谱标题')).toHaveValue('Tuplet Pocket');
 await expect(page.getByLabel('选择音符').locator('option')).toHaveCount(6);await page.getByLabel('网格细分').selectOption('3');await expect(page.getByRole('button',{name:'军鼓 第2.33拍 已有音符',exact:true})).toBeVisible();
 }
});
test('PDF failure is explicit and manual correction is editable',async({page})=>{
 await page.goto('/');await page.locator('input[type=file]').nth(0).setInputFiles(sample('Manual-reference.pdf'));await expect(page.getByText(/当前为空白校正谱/)).toBeVisible();await expect(page.getByTitle('原始 PDF 鼓谱')).toBeVisible();await expect(page.getByLabel('选择音符').locator('option')).toHaveCount(1);
 await page.getByRole('button',{name:'底鼓 第1.00拍',exact:true}).click();await page.getByLabel('音符鼓件').selectOption('snare');await page.getByRole('button',{name:'已对照原谱，确认校正'}).click();await expect(page.getByRole('button',{name:'军鼓 第1.00拍 已有音符',exact:true})).toBeVisible();
});
test('real audio repair, WAV download, and synchronized loop playback',async({page})=>{
 await page.addInitScript(()=>{
  (window as any).__audioStarts=[];
  const original=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args:any[]){(window as any).__audioStarts.push({when:args[0],offset:args[1],rate:this.playbackRate.value,loop:this.loop,from:this.loopStart,to:this.loopEnd});return original.apply(this,args as [number,number,number])};
 });
 await page.goto('/');await page.getByRole('button',{name:/录音工作台/}).first().click();await page.locator('input[type=file]').nth(1).setInputFiles(sample('Pocket-96.wav'));await expect(page.getByText('Pocket-96.wav',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'处理真实音频',exact:true}).click();await expect(page.getByText(/处理完成。/)).toBeVisible({timeout:45000});await expect(page.locator('audio')).toHaveCount(2);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载修复 WAV（24-bit）'}).click();const download=await pending;const data=await fs.readFile((await download.path())!);expect(data.subarray(0,4).toString()).toBe('RIFF');expect(data.readUInt16LE(34)).toBe(24);expect(data.readUInt32LE(24)).toBe(24000);
 await page.getByLabel('录音首拍偏移').fill('0.2');await page.getByRole('button',{name:'返回鼓谱并同步练习 →'}).click();await page.getByText('一小节预备拍',{exact:true}).locator('input').uncheck();
 await page.getByLabel('循环终点').selectOption('0');await page.getByLabel('练习 BPM',{exact:true}).fill('120');await page.bringToFront();await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.getByRole('button',{name:'停止练习',exact:true})).toBeVisible();await expect(page.getByText(/循环 2$/)).toBeVisible({timeout:8000});
 const scheduled=await page.evaluate(()=>(window as any).__audioStarts);const recording=scheduled.find((e:any)=>e.loop);expect(recording.rate).toBe(1.25);expect(recording.from).toBe(.2);expect(recording.to).toBe(2.7);expect(scheduled.filter((e:any)=>Math.abs(e.when-recording.when)<1e-8).length).toBeGreaterThanOrEqual(3);
 await page.getByRole('button',{name:'停止练习',exact:true}).click();await expect(page.getByRole('button',{name:'开始练习',exact:true})).toBeVisible();
});
test('browser recording captures actual audio data with a simulated input device',async({page,context})=>{
 await context.grantPermissions(['microphone']);await page.goto('/');await page.getByRole('button',{name:/录音工作台/}).first().click();await page.getByRole('button',{name:'设备录音',exact:true}).click();await expect(page.getByRole('button',{name:'停止录音',exact:true})).toBeVisible();await page.waitForTimeout(1200);await page.getByRole('button',{name:'停止录音',exact:true}).click();await expect(page.getByText('现场录音',{exact:true})).toBeVisible();await expect(page.locator('audio')).toHaveCount(1);
});
test('mobile layout remains usable without page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{name:'把鼓谱，变成你的练习。'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'mobile-screenshot.png',fullPage:true});
});

test('import reset survives reload and preserves the baseline in exported projects',async({page})=>{
 await page.goto('/');await page.locator('input[type=file]').nth(0).setInputFiles(sample('Tuplet-Pocket.musicxml'));
 await expect(page.getByLabel('鼓谱标题')).toHaveValue('Tuplet Pocket');
 await page.getByRole('button',{name:'吊镲 第1.25拍',exact:true}).click();
 await page.getByLabel('音符力度',{exact:true}).fill('51');await page.getByLabel('鼓谱标题').fill('Changed title');
 await page.getByRole('button',{name:'增加空白小节'}).click();await expect(page.locator('.measure-tabs button')).toHaveCount(3);
 await page.getByRole('button',{name:'复位鼓谱',exact:true}).click();await page.getByRole('button',{name:'保留修改',exact:true}).click();
 await expect(page.getByLabel('鼓谱标题')).toHaveValue('Changed title');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目',exact:true}).click();
 const downloaded=await downloadPromise,project=JSON.parse(await fs.readFile((await downloaded.path())!,'utf8'));
 expect(project.importedScore.measures).toHaveLength(2);expect(project.importedScore.title).toBe('Tuplet Pocket');
 await page.reload();await page.getByRole('button',{name:'复位鼓谱',exact:true}).click();await page.getByRole('button',{name:'确认复位',exact:true}).click();
 await expect(page.getByLabel('鼓谱标题')).toHaveValue('Tuplet Pocket');await expect(page.locator('.measure-tabs button')).toHaveCount(2);
 await expect(page.getByLabel('选择音符').locator('option')).toHaveCount(6);
 // Reopening an edited JSON must retain the original import baseline.
 await page.locator('input[type=file]').nth(2).setInputFiles({name:'edited.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await page.getByRole('button',{name:'复位鼓谱',exact:true}).click();await page.getByRole('button',{name:'确认复位',exact:true}).click();
 await expect(page.getByLabel('鼓谱标题')).toHaveValue('Tuplet Pocket');await expect(page.locator('.measure-tabs button')).toHaveCount(2);
});

test('original PDF cursor follows beats, changes pages, loops and stops',async({page})=>{
 const pdf=(await fs.readFile('tests/fixtures/playback-pages.pdf')).toString('base64');
 const project={title:'PDF playback',bpm:120,source:'playback.pdf',warnings:[],needsReview:false,tempos:[],pdf,pdfPageCount:2,measures:[0,1].map(i=>({id:`m${i}`,number:i+1,beats:4,time:[4,4],label:'',notes:[{id:`n${i}`,instrument:'kick',beat:0,duration:1,velocity:90,hand:''}],pdfRegion:{page:i,x:.1,y:.2,width:.8,height:.2,anchors:[{beat:0,x:.15},{beat:2,x:.7}],source:'omr'}}))};
 await page.goto('/');await page.locator('input[type=file]').nth(2).setInputFiles({name:'playback.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await expect(page.getByAltText('原始 PDF 第 1 页')).toBeVisible();
 await expect.poll(()=>page.getByAltText('原始 PDF 第 1 页').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
 await page.getByText('一小节预备拍',{exact:true}).locator('input').uncheck();
 await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.locator('.pdf-playhead')).toHaveAttribute('data-measure','1');
 const first=await page.locator('.pdf-playhead').getAttribute('style');
 await expect.poll(()=>page.locator('.pdf-playhead').getAttribute('style')).not.toBe(first);
 await expect(page.locator('.pdf-playhead')).toHaveAttribute('data-measure','2',{timeout:8000});
 await expect(page.getByAltText('原始 PDF 第 2 页')).toBeVisible();
 await expect(page.locator('.pdf-playhead')).toHaveAttribute('data-measure','1',{timeout:8000});
 await expect(page.getByAltText('原始 PDF 第 1 页')).toBeVisible();
 await page.getByRole('button',{name:'停止练习',exact:true}).click();await expect(page.locator('.pdf-playhead')).toHaveCount(0);
 // Manual location is available without OMR metadata, including on another page.
 await page.getByRole('button',{name:'原谱下一页'}).click();await expect(page.getByAltText('原始 PDF 第 2 页')).toBeVisible();
 await page.getByRole('button',{name:'定位第 1 小节'}).click();
 const box=(await page.locator('.pdf-stage').boundingBox())!;
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.1);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.25);await page.mouse.up();
 await expect(page.getByRole('button',{name:'原谱第 1 小节',exact:true})).toBeVisible();
 await expect(page.getByText('手动定位 · 拍线按时值比例移动，可重新框选。',{exact:false})).toBeVisible();
});

test('real drum kits load five velocity layers and persist the selected kit',async({page})=>{
 const samples=new Set<string>(),failed:string[]=[];
 page.on('response',r=>{if(r.url().includes('/sounds/red-zeppelin/')&&r.url().endsWith('.ogg')){samples.add(r.url());if(!r.ok())failed.push(r.url())}});
 await page.goto('/');await page.getByLabel('鼓组音色').selectOption('red-zeppelin');
 await page.getByRole('button',{name:'试听音色',exact:true}).click();
 await expect.poll(()=>samples.size).toBe(40);expect(failed).toEqual([]);
 await page.reload();await expect(page.getByLabel('鼓组音色')).toHaveValue('red-zeppelin');
 await page.getByLabel('鼓组音色').selectOption('synthetic');await page.getByRole('button',{name:'试听音色',exact:true}).click();
});

test('exports MP4 and WebM with moving frames and audible sampled audio, and supports cancellation',async({page})=>{
 await page.goto('/');await page.getByLabel('练习 BPM',{exact:true}).fill('240');await page.getByLabel('循环终点').selectOption('0');await page.getByText('一小节预备拍',{exact:true}).locator('input').uncheck();
 await page.getByRole('button',{name:'导出动态鼓谱视频',exact:true}).click();
 for(const [index,format] of ['mp4','webm'].entries()){
  await page.getByLabel('视频格式').selectOption(format);await page.getByRole('button',{name:index?'重新生成':'开始导出',exact:true}).click();
  await expect(page.getByText('视频已生成，可预览或下载。',{exact:true})).toBeVisible({timeout:45000});
  const result=await page.getByLabel('导出视频预览').evaluate(async(el:HTMLVideoElement)=>{
   if(el.readyState<2)await new Promise<void>((resolve,reject)=>{el.onloadeddata=()=>resolve();el.onerror=()=>reject(Error('Video decode failed'))});
   const context=new AudioContext(),bytes=await(await fetch(el.currentSrc)).arrayBuffer();
   try{
    const audio=await context.decodeAudioData(bytes.slice(0)),pcm=audio.getChannelData(0);let energy=0;for(const v of pcm)energy+=v*v;
    async function frameHash(time:number){el.currentTime=time;await new Promise<void>(r=>{el.onseeked=()=>r()});const c=document.createElement('canvas');c.width=128;c.height=72;const g=c.getContext('2d')!;g.drawImage(el,0,0,128,72);return Array.from(g.getImageData(0,0,128,72).data).reduce((n,v,i)=>(n+v*(i%31+1))%1000000007,0)}
    return {duration:el.duration,width:el.videoWidth,height:el.videoHeight,audioDuration:audio.duration,rms:Math.sqrt(energy/pcm.length),first:await frameHash(.15),second:await frameHash(.65)};
   }finally{await context.close()}
  });
  expect(result.width).toBe(1280);expect(result.height).toBe(720);expect(result.duration).toBeCloseTo(1.5,1);expect(Math.abs(result.audioDuration-result.duration)).toBeLessThan(.1);expect(result.rms).toBeGreaterThan(.001);expect(result.first).not.toBe(result.second);
  const pending=page.waitForEvent('download');await page.getByRole('link',{name:'下载视频',exact:true}).click();const download=await pending,bytes=await fs.readFile((await download.path())!);
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));expect(bytes.length).toBeGreaterThan(1000);if(format==='mp4')expect(bytes.subarray(4,8).toString()).toBe('ftyp');else expect(bytes.subarray(0,4).toString('hex')).toBe('1a45dfa3');
 }
 await page.getByLabel('视频播放遍数').fill('8');await page.getByRole('button',{name:'重新生成',exact:true}).click();await page.getByRole('button',{name:'取消导出',exact:true}).click();
 await expect(page.getByText('已取消，未生成视频。',{exact:true})).toBeVisible({timeout:15000});await expect(page.getByLabel('导出视频预览')).toHaveCount(0);
});

test('local history keeps PDF, audio and practice settings across switching and reload',async({page})=>{
 const score=JSON.parse(await fs.readFile(sample('Pocket-project.json'),'utf8'));score.title='朋克练习 A';score.pdf=(await fs.readFile('tests/fixtures/playback-pages.pdf')).toString('base64');score.pdfPageCount=2;
 await page.goto('/');await page.locator('input[type=file]').nth(2).setInputFiles({name:'practice-a.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
 await expect(page.getByLabel('鼓谱标题')).toHaveValue('朋克练习 A');await expect(page.getByAltText('原始 PDF 第 1 页')).toBeVisible();
 await page.getByRole('button',{name:'录音工作台',exact:true}).click();await page.locator('input[type=file]').nth(1).setInputFiles(sample('Pocket-96.wav'));
 await expect(page.getByText('Pocket-96.wav',{exact:true})).toBeVisible();await page.getByLabel('录音首拍偏移').fill('0.2');
 await page.getByRole('button',{name:'返回鼓谱并同步练习 →'}).click();await page.getByLabel('练习 BPM',{exact:true}).fill('132');await page.getByLabel('循环起点').selectOption('1');await page.getByLabel('循环终点').selectOption('2');await page.getByLabel('鼓组音色').selectOption('red-zeppelin');
 await expect(page.getByText('已保存到本机',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'新建项目',exact:true}).click();await expect(page.getByLabel('鼓谱标题')).toHaveValue('新的练习');await expect(page.locator('.pdf-player')).toHaveCount(0);await expect(page.getByText('同步播放录音',{exact:true}).locator('input')).not.toBeChecked();
 await page.getByLabel('鼓谱标题').fill('新的练习 B');await page.getByRole('button',{name:'打开项目 朋克练习 A',exact:true}).click();
 await expect(page.getByLabel('练习 BPM',{exact:true})).toHaveValue('132');await expect(page.getByLabel('循环起点')).toHaveValue('1');await expect(page.getByLabel('循环终点')).toHaveValue('2');await expect(page.getByLabel('鼓组音色')).toHaveValue('red-zeppelin');await expect(page.getByAltText('原始 PDF 第 1 页')).toBeVisible();
 await page.getByRole('button',{name:'录音工作台',exact:true}).click();await expect(page.getByText('Pocket-96.wav',{exact:true})).toBeVisible();await expect(page.locator('audio')).toHaveCount(1);await expect(page.getByLabel('录音首拍偏移')).toHaveValue('0.2');
 await expect(page.getByText('已保存到本机',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Pocket-96.wav',{exact:true})).toBeVisible();await expect(page.locator('audio')).toHaveCount(1);
 await page.getByRole('button',{name:'打开项目 新的练习 B',exact:true}).click();await page.getByRole('button',{name:'录音工作台',exact:true}).click();await expect(page.locator('audio')).toHaveCount(0);
 await expect(page.getByText('已保存到本机',{exact:true})).toBeVisible();await page.evaluate(()=>localStorage.clear());await page.reload();
 await expect(page.getByRole('button',{name:'打开项目 朋克练习 A',exact:true})).toBeVisible();await page.getByRole('button',{name:'打开项目 朋克练习 A',exact:true}).click();await page.getByRole('button',{name:'录音工作台',exact:true}).click();await expect(page.getByText('Pocket-96.wav',{exact:true})).toBeVisible();
});

test('history supports search, inline renaming and confirmed deletion',async({page})=>{
 await page.goto('/');await page.locator('input[type=file]').nth(0).setInputFiles(sample('Tuplet-Pocket.musicxml'));await expect(page.getByLabel('鼓谱标题')).toHaveValue('Tuplet Pocket');
 await page.getByRole('button',{name:'新建项目',exact:true}).click();await expect(page.getByLabel('鼓谱标题')).toHaveValue('新的练习');
 await page.getByRole('button',{name:'管理项目 Tuplet Pocket',exact:true}).click();await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByLabel('项目新名称').fill('节奏草稿');await page.getByLabel('项目新名称').press('Enter');
 await expect(page.getByRole('button',{name:'打开项目 节奏草稿',exact:true})).toBeVisible();
 await page.getByLabel('搜索本地项目').fill('节奏');await expect(page.getByRole('button',{name:'打开项目 节奏草稿',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'打开项目 新的练习',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'清除项目搜索'}).click();await page.getByRole('button',{name:'管理项目 节奏草稿',exact:true}).click();await page.getByRole('button',{name:'删除项目',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('button',{name:'打开项目 节奏草稿',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'管理项目 节奏草稿',exact:true}).click();await page.getByRole('button',{name:'删除项目',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
 await expect(page.getByRole('button',{name:'打开项目 节奏草稿',exact:true})).toHaveCount(0);await expect(page.getByLabel('鼓谱标题')).toHaveValue('新的练习');
});

test('migrates legacy cache and restores edits from an interrupted save snapshot',async({page})=>{
 const score=JSON.parse(await fs.readFile(sample('Pocket-project.json'),'utf8'));score.title='旧缓存练习';
 await page.addInitScript(value=>{if(!localStorage.getItem('migration-seeded')){localStorage.setItem('drumlab-score',JSON.stringify(value));localStorage.setItem('migration-seeded','yes')}},score);
 await page.goto('/');await expect(page.getByRole('button',{name:'打开项目 旧缓存练习',exact:true})).toBeVisible();
 await page.route('**/api/projects/*',async route=>{if(route.request().method()==='PUT')return route.abort();return route.continue()});
 await page.getByLabel('鼓谱标题').fill('尚未保存的练习');await expect(page.getByText('本机保存失败',{exact:true})).toBeVisible();
 await page.unroute('**/api/projects/*');await page.reload();await expect(page.getByLabel('鼓谱标题')).toHaveValue('尚未保存的练习');await expect(page.getByText('已保存到本机',{exact:true})).toBeVisible();
});


test('conflicting edits from another window are recovered as a separate local project',async({page,context})=>{
 await page.goto('/');await expect(page.getByLabel('鼓谱标题')).toHaveValue('Pocket Session');
 const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('鼓谱标题')).toHaveValue('Pocket Session');
 await page.getByLabel('鼓谱标题').fill('已保存版本');await expect(page.getByText('已保存到本机',{exact:true})).toBeVisible();
 await other.getByLabel('鼓谱标题').fill('另一个窗口的编辑');await expect(other.getByText('本机保存失败',{exact:true})).toBeVisible();
 await other.reload();await expect(other.getByLabel('鼓谱标题')).toHaveValue('另一个窗口的编辑（恢复快照）');
 await expect(other.getByRole('button',{name:'打开项目 已保存版本',exact:true})).toBeVisible();
 await other.getByRole('button',{name:'打开项目 已保存版本',exact:true}).click();await expect(other.getByLabel('鼓谱标题')).toHaveValue('已保存版本');await other.close();
});
