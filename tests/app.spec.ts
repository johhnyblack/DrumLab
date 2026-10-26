import {test,expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
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
