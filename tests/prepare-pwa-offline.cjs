// 构建三个独立的合成程序版本；只复制既有发布允许列表，不碰正式源码。
const fs=require('node:fs'),path=require('node:path');
const {build}=require('../pwa/build.cjs');
const baseline=require('../docs/PWA_PUBLIC_FILES_STAGE0.json'),config=require('../pwa/public-files.json');
const source=path.resolve(__dirname,'..'),evidence=path.join(source,'output/playwright/pwa-stage4');
fs.mkdirSync(evidence,{recursive:true});
const variants=fs.mkdtempSync(path.join(evidence,'variants-')),root=path.join(variants,'build-root');
for(const file of [...baseline.sourceFiles,...Object.keys(config.extraSourceFiles),...Object.keys(config.storagePreviewSourceFiles),'pwa/sw-template.js']){
 const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,file),target);
}
const original=fs.readFileSync(path.join(root,'index.html'),'utf8'),versions={};
for(const version of ['A','B','C']){
 fs.writeFileSync(path.join(root,'index.html'),original.replace('<html lang="zh-CN">',`<html lang="zh-CN" data-offline-test-version="${version}">`));
 const result=build({root,storagePreview:true}),destination=path.join(variants,version);fs.mkdirSync(destination);
 for(const file of fs.readdirSync(result.output,{recursive:true}).filter(file=>fs.statSync(path.join(result.output,file)).isFile())){
  const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(result.output,file),target);
 }
 versions[version]=JSON.parse(fs.readFileSync(path.join(destination,'build-info.json'))).buildId;
}
fs.writeFileSync(path.join(evidence,'variants.json'),JSON.stringify({variants,versions},null,2));
console.log(JSON.stringify({variants,versions}));
