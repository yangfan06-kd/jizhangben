// 只供本机合成版本、下载失败与摘要错误检查；不进入发布产物。
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {safePath}=require('../pwa/build.cjs');
const variants=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../output/playwright/pwa-stage4/variants.json'))).variants;
const port=Number(process.argv[process.argv.indexOf('--port')+1]||4177);
if(![4177,4178].includes(port))throw Error('仅允许独立测试端口');
let state={version:'A',fail:'',tamper:'',after:0},counts={};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async(req,res)=>{
 try{
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/__test_control'){
   if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);if(!['A','B','C'].includes(value.version))throw Error('version');state={version:value.version,fail:value.fail||'',tamper:value.tamper||'',after:value.after||0};counts={};}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({state,counts}));return;
  }
  if(name.startsWith('/ledger-preview/'))name=name.slice('/ledger-preview'.length);
  const relative=name==='/'?'index.html':name.slice(1);counts[relative]=(counts[relative]||0)+1;
  if(state.fail===relative&&counts[relative]>state.after){res.writeHead(503);res.end('合成下载中断');return;}
  const content=fs.readFileSync(safePath(path.join(variants,state.version),relative));
  res.writeHead(200,{'Content-Type':mime[path.extname(relative)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(state.tamper===relative&&counts[relative]>state.after?Buffer.from('/* 合成错误资源 */'):content);
 }catch(_){res.writeHead(404);res.end('未找到测试资源');}
}).listen(port,'127.0.0.1',()=>console.log('合成离线版本服务 http://127.0.0.1:'+port));
