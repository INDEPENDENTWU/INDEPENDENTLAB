import{analyzeStrip,chooseDetection,measurePages,buildReconstruction,issueSummary,clamp}from'./engine.js?v=20260819';
const $=s=>document.querySelector(s);
const fileInput=$('#file'),home=$('#home'),work=$('#work'),back=$('#back'),change=$('#change'),fileName=$('#fileName'),error=$('#error');
const busy=$('#busy'),busyTitle=$('#busyTitle'),busyText=$('#busyText'),result=$('#result'),verdict=$('#verdict'),summary=$('#summary');
const pageCount=$('#pageCount'),foundCount=$('#foundCount'),issueCount=$('#issueCount'),leftBtn=$('#left'),rightBtn=$('#right'),forward=$('#forward'),reverse=$('#reverse');
const restoreCanvas=$('#restoreCanvas'),restoreMeta=$('#restoreMeta'),positionInput=$('#position'),positionReset=$('#positionReset'),widthInput=$('#width'),widthReset=$('#widthReset'),issues=$('#issues'),issuesMeta=$('#issuesMeta'),issueList=$('#issueList'),saveBtn=$('#save'),note=$('#note');
let pdfjs=null,pages=[],detection=null,measure=null,lastBuilt=null,forcedSide='auto',isReverse=false,manualCenter=null,runId=0;
function setError(t=''){error.hidden=!t;error.textContent=t}
async function loadPdf(){if(pdfjs)return pdfjs;let last;for(const u of['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.mjs','https://unpkg.com/pdfjs-dist@4.10.38/legacy/build/pdf.mjs']){try{const m=await import(u);m.GlobalWorkerOptions.workerSrc=u.replace('pdf.mjs','pdf.worker.mjs');pdfjs=m;return m}catch(e){last=e}}throw last||new Error('pdfjs')}
function targetWidth(n){return n<=36?620:n<=80?520:n<=140?455:410}
async function readPages(file,id){
  if(file.size>180*1024*1024)throw new Error('large');const lib=await loadPdf();if(id!==runId)return null;const data=new Uint8Array(await file.arrayBuffer()),doc=await lib.getDocument({data}).promise;
  if(doc.numPages<2){await doc.destroy().catch(()=>{});throw new Error('few')}if(doc.numPages>220){await doc.destroy().catch(()=>{});throw new Error('many')}
  const out=[],wanted=targetWidth(doc.numPages);
  try{
    for(let i=1;i<=doc.numPages;i++){
      if(id!==runId)return null;busyTitle.textContent='正在看页边';busyText.textContent=`${i} / ${doc.numPages} 页`;
      const page=await doc.getPage(i),base=page.getViewport({scale:1}),scale=Math.min(1.35,wanted/base.width,1220/base.height),vp=page.getViewport({scale}),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(vp.width));canvas.height=Math.max(1,Math.round(vp.height));const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport:vp}).promise;
      const ew=clamp(Math.round(canvas.width*.17),62,118),leftImage=ctx.getImageData(0,0,ew,canvas.height),rightImage=ctx.getImageData(canvas.width-ew,0,ew,canvas.height);
      out.push({page:i,left:{image:leftImage,analysis:analyzeStrip(leftImage)},right:{image:rightImage,analysis:analyzeStrip(rightImage)}});canvas.width=1;canvas.height=1;page.cleanup?.();
      if(i%8===0)await new Promise(r=>setTimeout(r,0));
    }
    return out;
  }finally{await doc.destroy().catch(()=>{})}
}
function syncControls(){leftBtn.classList.toggle('active',detection?.side==='left');rightBtn.classList.toggle('active',detection?.side==='right');forward.classList.toggle('active',!isReverse);reverse.classList.toggle('active',isReverse)}
function copyCanvas(source,target){target.width=source.width;target.height=source.height;target.getContext('2d').drawImage(source,0,0)}
function renderIssues(report){
  const rows=[];for(const p of report.pages)rows.push({no:String(p).padStart(2,'0'),text:`第 ${p} 页`,detail:'没找到明显印章'});for(const [a,b] of report.seams)rows.push({no:`${a}/${b}`,text:`第 ${a} / ${b} 页`,detail:'接缝差得比较多'});
  issues.hidden=!rows.length;issuesMeta.textContent=rows.length?`${rows.length} 处`:'';issueList.innerHTML=rows.map(x=>`<div class="issue-row"><i>${x.no}</i><strong>${x.text}</strong><b>${x.detail}</b></div>`).join('');
}
function applyManualBand(d){
  if(manualCenter==null)return d;const span=d.band.end-d.band.start,center=clamp(manualCenter,span/2,1-span/2),start=clamp(center-span/2,0,1-span);return{...d,band:{...d.band,start,end:start+span}};
}
function renderCurrent({resetWidth=false,resetPosition=false}={}){
  if(!pages.length)return;detection=chooseDetection(pages,forcedSide);if(resetPosition){manualCenter=null;positionInput.value=String(Math.round((detection.band.start+detection.band.end)*50))}detection=applyManualBand(detection);measure=measurePages(pages,detection);const report=issueSummary(measure),found=measure.rows.filter(x=>x.found).length,coverage=found/pages.length;
  pageCount.textContent=String(pages.length);foundCount.textContent=String(found);issueCount.textContent=String(report.count);
  if(found<2||coverage<.16){verdict.textContent='没找到明显骑缝章';summary.textContent='可以换到另一边，或把上下位置移到印章那里。'}
  else if(report.count){verdict.textContent=`${report.count} 处需要看`;summary.textContent='下面已经按页拼好，直接看断开的地方。'}
  else{verdict.textContent='每页都找到了';summary.textContent='下面已经按页拼好，可以直接看整枚章。'}
  if(resetWidth)widthInput.value='100';const widthScale=Number(widthInput.value)/100,last=buildReconstruction(pages,detection,measure,{reverse:isReverse,widthScale});lastBuilt=last;copyCanvas(last.canvas,restoreCanvas);restoreMeta.textContent=`${detection.side==='right'?'右边':'左边'} · ${detection.mode==='red'?'红章':'彩色印迹'}`;renderIssues(report);syncControls();
  note.textContent=detection.mode==='red'?'适合彩色扫描的骑缝章。黑白复印、很淡的印章或彩色页边可能需要自己看还原图。':'这份文件没有明显红章，当前按其他彩色印迹拼接；如果位置不对，可以换边。';
}
async function process(file){
  if(!file)return;if(file.type&&file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name)){setError('请选择 PDF。');return}const id=++runId;setError('');home.hidden=true;work.hidden=false;busy.hidden=false;result.hidden=true;fileName.textContent=file.name;forcedSide='auto';isReverse=false;manualCenter=null;widthInput.value='100';positionInput.value='50';pages=[];detection=measure=lastBuilt=null;
  try{const read=await readPages(file,id);if(!read||id!==runId)return;pages=read;busyTitle.textContent='正在拼';busyText.textContent='';await new Promise(r=>setTimeout(r,0));busy.hidden=true;result.hidden=false;renderCurrent({resetWidth:true,resetPosition:true});window.scrollTo({top:0,behavior:'instant'})}
  catch(e){console.error(e);work.hidden=true;home.hidden=false;if(e?.message==='few')setError('至少需要两页 PDF。');else if(e?.message==='many')setError('这份 PDF 超过 220 页，先拆成较小的一份再试。');else if(e?.message==='large')setError('这份 PDF 太大，先压小或拆成几份再试。');else setError('这份 PDF 没有成功打开。')}
}
function setSide(side){forcedSide=side;manualCenter=null;renderCurrent({resetWidth:true,resetPosition:true})}
function setOrder(reverseValue){isReverse=reverseValue;renderCurrent()}
async function saveImage(){if(!lastBuilt?.canvas)return;const canvas=lastBuilt.canvas,blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)return;const file=new File([blob],`骑缝还原-${new Date().toISOString().slice(0,10)}.png`,{type:'image/png'});if(navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'骑缝还原'});return}catch(e){if(e?.name==='AbortError')return}}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}
fileInput.onchange=()=>{const f=fileInput.files?.[0];if(f)process(f);fileInput.value=''};change.onclick=()=>fileInput.click();back.onclick=()=>{runId++;pages=[];detection=measure=lastBuilt=null;work.hidden=true;home.hidden=false;window.scrollTo({top:0,behavior:'instant'})};
leftBtn.onclick=()=>setSide('left');rightBtn.onclick=()=>setSide('right');forward.onclick=()=>setOrder(false);reverse.onclick=()=>setOrder(true);
positionInput.onchange=()=>{manualCenter=Number(positionInput.value)/100;renderCurrent()};positionReset.onclick=()=>{manualCenter=null;renderCurrent({resetPosition:true})};widthInput.onchange=()=>renderCurrent();widthReset.onclick=()=>{widthInput.value='100';renderCurrent()};saveBtn.onclick=saveImage;
window.addEventListener('pagehide',()=>{runId++;pages=[]});
