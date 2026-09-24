// Hidden, temporary Electron fixture: no access to application state or personal files.
import { _electron } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = await mkdtemp(path.join(tmpdir(), 'devhaven-reader-'));
let app;
try {
  const fixture = await readFile('tests/fixtures/interactive-document.html', 'utf8');
  await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {HTMLReader} from './src/components/html-reader';
    import {Segments} from './src/components/list-controls';
    import './src/app/toolbar.css';
    window.devhaven = {privateValue: 'fixture-only'};
    const options = Array.from({length:25},(_,i)=>({value:String(i),label:'示例筛选 '+i}));
    createRoot(document.getElementById('root')).render(<>
      <div className="projects-workspace"><div className="catalog-filters">
      <div className="project-group-filter"><Segments label="目录" options={options} value="0" onChange={()=>{}} /></div>
      <Segments label="语言" options={options} value="0" onChange={()=>{}} />
      <Segments label="标签" options={options} value="0" onChange={()=>{}} />
      </div></div><HTMLReader title="交互文档" content={${JSON.stringify(fixture)}} /></>);
    ` }, bundle: true, outfile: path.join(root, 'renderer.js'), platform: 'browser', jsx: 'automatic', logLevel: 'silent' });
  await writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; connect-src \'none\'; frame-src \'self\'; object-src \'none\'; base-uri \'none\'"><link rel="stylesheet" href="renderer.css"><style>iframe{width:100%;height:350px}*{box-sizing:border-box}button{border:0}body{margin:10px}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    const {app,BrowserWindow}=require('electron');const path=require('node:path');
    const {restrictDocumentNavigation}=require('./electron/document-security');
    app.setPath('userData',path.join(__dirname,'profile'));global.requests=[];
    app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      restrictDocumentNavigation(w.webContents);w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{global.requests.push(d.url);cb({cancel:true});});
      w.loadFile(path.join(__dirname,'index.html'));
    });app.on('window-all-closed',()=>app.quit());
  ` }, bundle: true, outfile: path.join(root, 'main.cjs'), platform: 'node', external: ['electron'], logLevel: 'silent' });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: [path.join(root, 'main.cjs')], env });
  const page = await app.firstWindow();
  const frame = page.frameLocator('iframe');
  await frame.locator('#counter').click();
  assert.equal(await frame.locator('#counter').textContent(), '1');
  await frame.locator('#amount').fill('7');
  await frame.getByRole('button', {name:'计算',exact:true}).click();
  assert.equal(await frame.locator('#result').textContent(), '14');
  await frame.locator('#probe').click();
  await frame.locator('#isolation').filter({ hasText: 'network' }).waitFor();
  const checks = JSON.parse(await frame.locator('#isolation').textContent());
  for (const [key, passed] of Object.entries(checks)) assert.equal(passed, true, key);
  await frame.locator('#anchor').click();
  await frame.locator('#external').click();
  assert.equal(await frame.locator('html').evaluate(()=>location.href), 'about:srcdoc');
  await frame.locator('#counter').click();
  assert.equal(await frame.locator('#counter').textContent(), '2');
  await frame.locator('#navigate').click();
  await page.waitForTimeout(100);
  assert.ok(!page.frames().some(f=>f.url().startsWith('https:')), 'script navigation cannot leave the sandbox');
  assert.deepEqual(await app.evaluate(() => global.requests), [], 'no document network requests should reach Electron');
  for (const width of [1440, 760]) {
    await page.setViewportSize({width,height:900});
    const rows = await page.locator('.catalog-filters > *').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom,width:r.width};}));
    assert.equal(rows.length,3);
    for (let i=1;i<rows.length;i++) { assert.ok(rows[i].y>=rows[i-1].bottom);assert.equal(rows[i].x,rows[0].x);assert.equal(rows[i].width,rows[0].width); }
    const toggle = page.locator('.catalog-filters > *').first().getByRole('button',{name:'展开全部'});
    await toggle.click();
    assert.equal(await page.locator('.filter-segments').first().locator('[aria-hidden=true]').count(),0);
    await page.getByRole('button',{name:'收起',exact:true}).click();
  }
  console.log('PASS: script/button/form/anchor interactions, opaque origin, desktop/file/network/navigation isolation, one filter category per row and expand/collapse at two widths');
} finally { await app?.close(); await rm(root,{recursive:true,force:true}); }
