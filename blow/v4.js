(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),choose=$('#choose'),filesInput=$('#files'),pasteOpen=$('#pasteOpen'),error=$('#error');
  const pasteSheet=$('#pasteSheet'),pasteClose=$('#pasteClose'),pasteText=$('#pasteText'),pasteUse=$('#pasteUse'),pasteModes=$('#pasteModes');
  const reader=$('#reader'),exit=$('#exit'),stage=$('#stage'),pdfCanvas=$('#pdfCanvas'),imagePage=$('#imagePage'),textPage=$('#textPage'),textBody=$('#textBody'),stepNo=$('#stepNo'),measureText=$('#measureText'),loading=$('#loading'),loadingNote=$('#loadingNote'),pctx=pdfCanvas.getContext('2d',{alpha:false});
  const faceVideo=$('#faceVideo'),fileKind=$('#fileKind'),pageNow=$('#pageNow'),pageTotal=$('#pageTotal'),statusDot=$('#statusDot'),statusText=$('#statusText'),actionBtn=$('#actionBtn'),prevBtn=$('#prev'),nextBtn=$('#next'),edgePrev=$('#edgePrev'),edgeNext=$('#edgeNext');
  const actionSheet=$('#actionSheet'),actionClose=$('#actionClose'),actionOptions=$('#actionOptions'),learnPanel=$('#learnPanel'),learnDots=[...document.querySelectorAll('#learnDots i')],learnHint=$('#learnHint');
  const permission=$('#permission'),permissionTitle=$('#permissionTitle'),permissionHint=$('#permissionHint'),permissionAction=$('#permissionAction');

  let kind=null,pdfjs=null,pdfDoc=null,pdfWorker='',pages=[],current=1,total=1,renderToken=0,renderTask=null,ownedUrls=[];
  let pasteMode='pages',controlMode=localStorage.getItem('handsfree-control-v4')||'blow';
  if(!['blow','voice','mouth'].includes(controlMode))controlMode='blow';
  let stream=null,audio=null,source=null,analyser=null,timeData=null,freqData=null,faceLandmarker=null,faceLoop=0,faceLast=0,faceSeenUntil=0;
  let currentMouth={pucker:0,funnel:0,puff:0,jaw:0,key:0},idleMouth=.03,ambient=.002,listening=false,monitorRaf=0,lastFrame=0;
  let activeGesture=false,gestureStart=0,lastGesture=0,longDone=false,cooldownUntil=0;
  let customTemplate=null,customCollect=null,customStarted=0,customLast=0,customFrames=[];
  let learning=false,learnEvents=[];
  let wake=null,pointerStart=null,resizeTimer=0,busy=false;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function setLoading(on,note='请稍候'){loading.hidden=!on;loadingNote.textContent=note}
  function own(url){ownedUrls.push(url);return url}
  function clearOwned(){for(const u of ownedUrls)URL.revokeObjectURL(u);ownedUrls=[]}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
  function setStatus(text,live=false,hit=false){statusText.textContent=text;statusDot.classList.toggle('live',live);statusDot.classList.toggle('hit',hit)}
  function defaultStatus(){const t={blow:'吹气 · 短吹向前，长吹返回',voice:'我的声音 · 短声向前',mouth:'无声嘴型 · 短嘟嘴向前，保持返回'};setStatus(t[controlMode],listening,false)}

  async function loadPdfLibrary(){
    if(pdfjs)return pdfjs;
    const sources=[
      {main:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'},
      {main:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'}
    ];
    let last=null;for(const s of sources){try{pdfjs=await import(s.main);pdfWorker=s.worker;break}catch(e){last=e}}
    if(!pdfjs)throw last||new Error('pdfjs');pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;return pdfjs
  }
  async function loadZip(){const urls=['https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm','https://esm.sh/jszip@3.10.1'];let last=null;for(const u of urls){try{const m=await import(u);return m.default||m}catch(e){last=e}}throw last||new Error('zip')}
  function resolvePath(base,rel){if(/^([a-z]+:|\/)/i.test(rel))return rel;const parts=base.split('/').slice(0,-1).concat(rel.split('/')),out=[];for(const p of parts){if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(p)}return out.join('/')}

  function markdownBlocks(text){
    const lines=String(text).replace(/\r/g,'').split('\n'),blocks=[];let para=[],list=null;
    const inline=s=>esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
    const flush=()=>{if(para.length){blocks.push(`<p>${inline(para.join(' '))}</p>`);para=[]}};
    const closeList=()=>{if(list){blocks.push(`<${list.tag}>${list.items.map(x=>`<li>${inline(x)}</li>`).join('')}</${list.tag}>`);list=null}};
    for(const raw of lines){const line=raw.trim();if(!line){flush();closeList();continue}
      let m=line.match(/^(#{1,3})\s+(.+)$/);if(m){flush();closeList();const n=m[1].length;blocks.push(`<h${n}>${inline(m[2])}</h${n}>`);continue}
      m=line.match(/^>\s*(.+)$/);if(m){flush();closeList();blocks.push(`<blockquote>${inline(m[1])}</blockquote>`);continue}
      m=line.match(/^[-*•]\s+(.+)$/);if(m){flush();if(!list||list.tag!=='ul'){closeList();list={tag:'ul',items:[]}}list.items.push(m[1]);continue}
      m=line.match(/^\d+[.)、]\s*(.+)$/);if(m){flush();if(!list||list.tag!=='ol'){closeList();list={tag:'ol',items:[]}}list.items.push(m[1]);continue}
      para.push(line)
    }flush();closeList();return blocks
  }
  function stepBlocks(text){
    const lines=String(text).replace(/\r/g,'').split('\n'),steps=[];let cur=[];const push=()=>{const s=cur.join('\n').trim();if(s)steps.push(s);cur=[]};
    for(const raw of lines){const line=raw.trim();if(!line){if(cur.length)push();continue}if(/^(?:\d+[.)、]|[-*•]|第\s*\d+\s*步)/.test(line)){if(cur.length)push();cur=[line.replace(/^(?:\d+[.)、]|[-*•])\s*/,'')]}else cur.push(line)}push();if(steps.length<2)return String(text).split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);return steps
  }
  function setMeasureWidth(){const r=stage.getBoundingClientRect();measureText.style.width=`${Math.max(240,Math.min(740,r.width-40))}px`;measureText.style.maxHeight=`${Math.max(260,r.height-40)}px`}
  function paginateBlocks(blocks){setMeasureWidth();const maxH=Math.max(220,stage.getBoundingClientRect().height-72),made=[];let cur=[];for(const b of blocks){cur.push(b);measureText.innerHTML=cur.join('');if(measureText.scrollHeight>maxH&&cur.length>1){cur.pop();made.push(cur.join(''));cur=[b]}}if(cur.length)made.push(cur.join(''));return made.length?made:['<p>没有可显示的文字。</p>']}
  async function openText(text,mode='pages',label='文字'){
    reader.hidden=false;home.hidden=true;kind=mode==='steps'?'steps':'text';fileKind.textContent=mode==='steps'?'下一步':label;
    pages=mode==='steps'?stepBlocks(text).map((s,i)=>({html:`<div>${markdownBlocks(s).join('')}</div>`,step:i+1})):paginateBlocks(markdownBlocks(text)).map(html=>({html}));
    total=pages.length;current=1;pageTotal.textContent=String(total);await showPage(1);await prepareControl(controlMode);requestWake()
  }
  async function openEpub(file){
    setLoading(true,'正在读取 EPUB');const JSZip=await loadZip(),zip=await JSZip.loadAsync(await file.arrayBuffer());const container=await zip.file('META-INF/container.xml')?.async('text');if(!container)throw new Error('epub');const cx=new DOMParser().parseFromString(container,'application/xml'),root=cx.querySelector('rootfile')?.getAttribute('full-path');if(!root)throw new Error('epub');
    const opfText=await zip.file(root)?.async('text');if(!opfText)throw new Error('epub');const opf=new DOMParser().parseFromString(opfText,'application/xml'),items={};opf.querySelectorAll('item').forEach(i=>items[i.getAttribute('id')]={href:i.getAttribute('href'),type:i.getAttribute('media-type')});
    const blocks=[];for(const ir of opf.querySelectorAll('spine itemref')){const it=items[ir.getAttribute('idref')];if(!it?.href)continue;const path=resolvePath(root,it.href),x=await zip.file(path)?.async('text');if(!x)continue;const doc=new DOMParser().parseFromString(x,'text/html');doc.querySelectorAll('script,style,nav').forEach(n=>n.remove());const nodes=[...doc.body.querySelectorAll('h1,h2,h3,p,li,blockquote')];if(nodes.length){for(const n of nodes){const t=n.textContent.trim();if(!t)continue;const tag=/^H[123]$/.test(n.tagName)?n.tagName.toLowerCase():n.tagName==='LI'?'li':n.tagName==='BLOCKQUOTE'?'blockquote':'p';blocks.push(`<${tag}>${esc(t)}</${tag}>`)}}else{const t=doc.body.textContent.trim();if(t)blocks.push(`<p>${esc(t)}</p>`)}}
    reader.hidden=false;home.hidden=true;kind='text';fileKind.textContent='EPUB';pages=paginateBlocks(blocks).map(html=>({html}));total=pages.length;current=1;pageTotal.textContent=String(total);setLoading(false);await showPage(1);await prepareControl(controlMode);requestWake()
  }
  function loadImage(url){return new Promise((ok,no)=>{const i=new Image;i.onload=()=>ok(i);i.onerror=no;i.src=url})}
  function toBlob(canvas,type='image/jpeg'){return new Promise((ok,no)=>canvas.toBlob(b=>b?ok(b):no(new Error('blob')),type,type==='image/jpeg'?.94:undefined))}
  async function imagePages(files){
    const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})),out=[];
    for(const file of sorted){const url=own(URL.createObjectURL(file)),img=await loadImage(url),w=img.naturalWidth,h=img.naturalHeight;if(h>w*2.15&&window.LONG_CUTTER){const cuts=LONG_CUTTER.find(img,w,h,1.68),bounds=[0,...cuts,h];for(let i=0;i<bounds.length-1;i++){const y=Math.round(bounds[i]),hh=Math.max(1,Math.round(bounds[i+1])-y),c=document.createElement('canvas');c.width=w;c.height=hh;c.getContext('2d').drawImage(img,0,y,w,hh,0,0,w,hh);const b=await toBlob(c,file.type==='image/png'?'image/png':'image/jpeg');out.push({type:'image',url:own(URL.createObjectURL(b))})}}else out.push({type:'image',url})}return out
  }
  async function openFiles(list){
    setError('');const files=[...list];if(!files.length)return;clearOwned();cleanupControl();try{
      const pdfs=files.filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)),epubs=files.filter(f=>/\.epub$/i.test(f.name)),texts=files.filter(f=>f.type.startsWith('text/')||/\.(txt|md|markdown)$/i.test(f.name)),imgs=files.filter(f=>f.type.startsWith('image/'));
      if([pdfs.length>0,epubs.length>0,texts.length>0,imgs.length>0].filter(Boolean).length>1)throw new Error('mixed');reader.hidden=false;home.hidden=true;setLoading(true,'正在打开内容');
      if(pdfs.length){if(pdfs.length>1)throw new Error('onepdf');kind='pdf';fileKind.textContent='PDF';const lib=await loadPdfLibrary(),data=new Uint8Array(await pdfs[0].arrayBuffer());pdfDoc=await lib.getDocument({data}).promise;total=pdfDoc.numPages;pages=[]}
      else if(epubs.length){if(epubs.length>1)throw new Error('oneepub');await openEpub(epubs[0]);return}
      else if(texts.length){const text=(await Promise.all(texts.map(f=>f.text()))).join('\n\n');setLoading(false);await openText(text,'pages','文字');return}
      else if(imgs.length){kind='images';fileKind.textContent='图片';pages=await imagePages(imgs);total=pages.length}
      else throw new Error('unsupported');current=1;pageTotal.textContent=String(total);setLoading(false);await showPage(1);await prepareControl(controlMode);requestWake()
    }catch(e){console.error(e);await closeReader();setError(e?.message==='mixed'?'不同类型请分开打开。':e?.message==='onepdf'?'一次先打开一个 PDF。':e?.message==='oneepub'?'一次先打开一本 EPUB。':'这个内容没有成功打开。')}
  }

  async function showPage(n,flashDir=null){
    if(!kind)return;current=clamp(n,1,total);pageNow.textContent=String(current);prevBtn.disabled=current<=1;nextBtn.disabled=current>=total;if(flashDir)flashEdge(flashDir);pdfCanvas.hidden=true;imagePage.hidden=true;textPage.hidden=true;stepNo.hidden=true;
    if(kind==='images'){imagePage.src=pages[current-1].url;imagePage.hidden=false;try{await imagePage.decode()}catch{}return}
    if(kind==='text'||kind==='steps'){textBody.innerHTML=pages[current-1].html;textPage.hidden=false;textPage.classList.toggle('step-page',kind==='steps');if(kind==='steps'){stepNo.hidden=false;stepNo.textContent=String(current).padStart(2,'0')}return}
    const token=++renderToken;try{renderTask?.cancel()}catch{}renderTask=null;const page=await pdfDoc.getPage(current);if(token!==renderToken)return;const base=page.getViewport({scale:1}),r=stage.getBoundingClientRect(),maxW=Math.max(120,r.width-8),maxH=Math.max(120,r.height-8),fit=Math.min(maxW/base.width,maxH/base.height),dpr=Math.min(2,window.devicePixelRatio||1),vp=page.getViewport({scale:fit*dpr});pdfCanvas.width=Math.max(1,Math.round(vp.width));pdfCanvas.height=Math.max(1,Math.round(vp.height));pdfCanvas.style.width=`${vp.width/dpr}px`;pdfCanvas.style.height=`${vp.height/dpr}px`;pctx.fillStyle='#fff';pctx.fillRect(0,0,pdfCanvas.width,pdfCanvas.height);pdfCanvas.hidden=false;renderTask=page.render({canvasContext:pctx,viewport:vp});try{await renderTask.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}finally{if(token===renderToken)renderTask=null}
  }
  function flashEdge(dir){const el=dir==='prev'?edgePrev:edgeNext;el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),220)}
  function nextPage(){if(current<total)showPage(current+1,'next');else{flashEdge('next');setStatus('已经是最后一页',true,true);setTimeout(defaultStatus,650)}}
  function prevPage(){if(current>1)showPage(current-1,'prev');else{flashEdge('prev');setStatus('已经是第一页',true,true);setTimeout(defaultStatus,650)}}

  function audioFeature(){
    if(!analyser)return{rms:0,flat:0,bands:new Array(12).fill(0)};analyser.getFloatTimeDomainData(timeData);let s=0;for(const v of timeData)s+=v*v;const rms=Math.sqrt(s/timeData.length);analyser.getFloatFrequencyData(freqData);const ny=audio.sampleRate/2,binHz=ny/freqData.length,edges=[80,140,230,360,560,850,1250,1800,2600,3700,5200,7000,9000],bands=new Array(12).fill(0),counts=new Array(12).fill(0);let logSum=0,arith=0,n=0;
    for(let i=1;i<freqData.length;i++){const hz=i*binHz;if(hz<80||hz>9000)continue;const p=Math.pow(10,freqData[i]/10);let b=0;while(b<11&&hz>=edges[b+1])b++;bands[b]+=p;counts[b]++;logSum+=Math.log(p+1e-18);arith+=p;n++}let totalP=0;for(let i=0;i<12;i++){bands[i]/=Math.max(1,counts[i]);totalP+=bands[i]}for(let i=0;i<12;i++)bands[i]/=(totalP+1e-18);const flat=n?Math.exp(logSum/n)/(arith/n+1e-18):0;return{rms,flat,bands}
  }
  function cosine(a,b){let d=0,aa=0,bb=0;for(let i=0;i<Math.min(a.length,b.length);i++){d+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return d/Math.sqrt((aa||1)*(bb||1))}
  function summarizeFrames(frames,duration=0){if(!frames.length)return null;const strong=[...frames].sort((a,b)=>b.audio.rms-a.audio.rms).slice(0,Math.max(3,Math.ceil(frames.length*.65))),bands=[];for(let i=0;i<12;i++)bands.push(median(strong.map(x=>x.audio.bands[i])));const sum=bands.reduce((a,b)=>a+b,0)||1;for(let i=0;i<12;i++)bands[i]/=sum;return{rms:median(strong.map(x=>x.audio.rms)),flat:median(strong.map(x=>x.audio.flat)),bands,duration,mouth:Math.max(...frames.map(x=>x.mouth||0))}}

  function mapBlend(result){const cats=result?.faceBlendshapes?.[0]?.categories||[],m={};for(const c of cats){const k=String(c.categoryName||c.displayName||'').replace(/[_\s-]/g,'').toLowerCase();m[k]=Number(c.score)||0}const pucker=m.mouthpucker||0,funnel=m.mouthfunnel||0,puff=m.cheekpuff||0,jaw=m.jawopen||0,key=Math.max(pucker,funnel*.95,puff*.78,jaw*.55);return{pucker,funnel,puff,jaw,key}}
  async function loadFace(){
    if(faceLandmarker)return faceLandmarker;const sources=[{js:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm',wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'},{js:'https://esm.sh/@mediapipe/tasks-vision@0.10.35',wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'}];let last=null;
    for(const s of sources){try{const mod=await import(s.js),F=mod.FilesetResolver||mod.default?.FilesetResolver,L=mod.FaceLandmarker||mod.default?.FaceLandmarker;if(!F||!L)throw 0;const vision=await F.forVisionTasks(s.wasm);faceLandmarker=await L.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,minFaceDetectionConfidence:.42,minFacePresenceConfidence:.42,minTrackingConfidence:.42});return faceLandmarker}catch(e){last=e;faceLandmarker=null}}throw last||new Error('face')
  }
  function startFaceLoop(){cancelAnimationFrame(faceLoop);faceLast=0;const loop=now=>{faceLoop=requestAnimationFrame(loop);if(!stream||!faceLandmarker||faceVideo.readyState<2||document.hidden||now-faceLast<90)return;faceLast=now;try{const r=faceLandmarker.detectForVideo(faceVideo,now);if(r?.faceBlendshapes?.length){currentMouth=mapBlend(r);faceSeenUntil=now+350;faceVideo.classList.add('found')}else if(now>faceSeenUntil)faceVideo.classList.remove('found')}catch{}};faceLoop=requestAnimationFrame(loop)}
  async function waitFace(ms=6000){const t=performance.now();while(performance.now()-t<ms){if(performance.now()<faceSeenUntil)return true;await sleep(80)}return false}
  async function setupMedia(needAudio=true){
    cleanupControl();const constraints={video:{facingMode:'user',width:{ideal:480},height:{ideal:360}},audio:needAudio?{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false};stream=await navigator.mediaDevices.getUserMedia(constraints);faceVideo.srcObject=stream;await faceVideo.play();faceVideo.classList.add('show');await loadFace();startFaceLoop();if(!await waitFace())throw new Error('noface');
    if(needAudio){const AC=window.AudioContext||window.webkitAudioContext;audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);analyser=audio.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.08;source.connect(analyser);timeData=new Float32Array(analyser.fftSize);freqData=new Float32Array(analyser.frequencyBinCount)}
    const mouthVals=[];const t0=performance.now();while(performance.now()-t0<650){mouthVals.push(currentMouth.key);await sleep(40)}idleMouth=median(mouthVals)||.03;if(needAudio){const vals=[];const a0=performance.now();while(performance.now()-a0<650){vals.push(audioFeature().rms);await sleep(36)}ambient=Math.max(.0007,median(vals)||.002)}
  }
  function cleanupControl(){listening=false;learning=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;cancelAnimationFrame(faceLoop);faceLoop=0;activeGesture=false;customCollect=null;if(source){try{source.disconnect()}catch{}source=null}if(analyser){try{analyser.disconnect()}catch{}analyser=null}if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}faceVideo.srcObject=null;faceVideo.classList.remove('show','found');if(audio){try{audio.close()}catch{}audio=null}timeData=null;freqData=null;setStatus('免手操作未开启',false,false)}

  function blowEvidence(){if(performance.now()>faceSeenUntil||!analyser)return false;const a=audioFeature(),mouth=Math.max(currentMouth.pucker,currentMouth.funnel*.95,currentMouth.puff*.72),gate=Math.max(.0035,ambient*1.9+.0007);return a.rms>=gate&&mouth>=Math.max(.12,idleMouth+.065)}
  function mouthEvidence(){if(performance.now()>faceSeenUntil)return false;const mouth=Math.max(currentMouth.pucker,currentMouth.funnel*.95,currentMouth.puff*.72);return mouth>=Math.max(.15,idleMouth+.085)}
  function customFrame(){return{audio:audioFeature(),mouth:Math.max(0,currentMouth.key-idleMouth)}}
  function customEvidence(f){if(!customTemplate||performance.now()>faceSeenUntil)return false;const gate=Math.max(.003,ambient*1.75,customTemplate.rms*.12);if(f.audio.rms<gate||f.mouth<Math.max(.025,customTemplate.mouth*.18))return false;return cosine(f.audio.bands,customTemplate.bands)>=.80}

  function gestureLoop(){cancelAnimationFrame(monitorRaf);lastFrame=0;activeGesture=false;longDone=false;const loop=now=>{monitorRaf=requestAnimationFrame(loop);if(!listening||now-lastFrame<30)return;lastFrame=now;let hit=false;if(controlMode==='blow')hit=blowEvidence();else if(controlMode==='mouth')hit=mouthEvidence();else if(controlMode==='voice')hit=customEvidence(customFrame());if(now<cooldownUntil)hit=false;
      if(hit){lastGesture=now;if(!activeGesture){activeGesture=true;gestureStart=now;longDone=false;setStatus(controlMode==='voice'?'听到了你的声音':'识别到动作',true,true)}const d=now-gestureStart;if(d>=720&&!longDone){longDone=true;prevPage();setStatus('保持动作 · 返回',true,true)}}
      else if(activeGesture&&now-lastGesture>140){const d=lastGesture-gestureStart;activeGesture=false;cooldownUntil=now+480;if(!longDone&&d>=90){nextPage();setStatus('短动作 · 向前',true,true)}setTimeout(defaultStatus,620)}};monitorRaf=requestAnimationFrame(loop)}

  async function prepareControl(mode){controlMode=mode;localStorage.setItem('handsfree-control-v4',mode);cleanupControl();actionSheet.hidden=true;permission.hidden=false;permissionTitle.textContent=mode==='blow'?'吹一下就能翻':mode==='voice'?'把一个声音变成按钮':'不用出声也能翻';permissionHint.textContent=mode==='blow'?'只需要一次相机和麦克风权限，不需要先录吹气。':mode==='voice'?'第一次做三次同样的短声音，以后再发这个声音就向前。':'前置相机看到短嘟嘴就向前，保持一下返回。';permissionAction.textContent='开启';permission.dataset.mode=mode}
  async function activateMode(mode){
    if(busy)return;busy=true;permissionAction.disabled=true;try{setStatus('正在准备',false,false);await setupMedia(mode!=='mouth');permission.hidden=true;if(mode==='voice'){await startLearning()}else{listening=true;cooldownUntil=performance.now()+420;defaultStatus();gestureLoop()}}
    catch(e){console.error(e);cleanupControl();permissionTitle.textContent='没有准备好';permissionHint.textContent=e?.message==='noface'?'前置相机没有看到脸。把手机放到能看到你的正面，再试一次。':'需要前置相机权限；吹气和“我的声音”还需要麦克风权限。';permissionAction.textContent='再试一次'}finally{busy=false;permissionAction.disabled=false}
  }
  async function startLearning(){
    learning=true;learnEvents=[];customTemplate=null;permission.hidden=true;actionSheet.hidden=false;actionOptions.hidden=true;learnPanel.hidden=false;learnDots.forEach(x=>x.classList.remove('on'));learnHint.textContent='连续做三次同样的短声音，例如「啧」「嗯」「过」。每次分开一点。';setStatus('正在学你的声音',true,false);customCollect=null;let last=0;const gate=()=>Math.max(.003,ambient*1.75+.0005);
    const loop=now=>{monitorRaf=requestAnimationFrame(loop);if(!learning||now-last<30)return;last=now;const f=customFrame(),active=f.audio.rms>=gate();if(active){if(!customCollect){customCollect=[];customStarted=now}customLast=now;customCollect.push(f)}else if(customCollect&&now-customLast>150){const d=customLast-customStarted,summary=summarizeFrames(customCollect,d);customCollect=null;if(summary&&d>=70&&d<=1600&&summary.mouth>=.025){learnEvents.push(summary);learnDots[learnEvents.length-1]?.classList.add('on');learnHint.textContent=learnEvents.length<3?'收到，再来一次。':'好了';navigator.vibrate?.(12);if(learnEvents.length>=3){learning=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;const bands=[];for(let i=0;i<12;i++)bands.push(median(learnEvents.map(x=>x.bands[i])));const sum=bands.reduce((a,b)=>a+b,0)||1;bands.forEach((_,i)=>bands[i]/=sum);customTemplate={bands,rms:median(learnEvents.map(x=>x.rms)),flat:median(learnEvents.map(x=>x.flat)),duration:median(learnEvents.map(x=>x.duration)),mouth:median(learnEvents.map(x=>x.mouth))};setTimeout(()=>{actionSheet.hidden=true;actionOptions.hidden=false;learnPanel.hidden=true;listening=true;cooldownUntil=performance.now()+450;defaultStatus();gestureLoop()},380)}}}};monitorRaf=requestAnimationFrame(loop)
  }

  function openActionSheet(){actionSheet.hidden=false;actionOptions.hidden=false;learnPanel.hidden=true;actionOptions.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===controlMode);b.querySelector('em').textContent=b.dataset.mode===controlMode?'当前':'选择'})}
  async function closeReader(){cleanupControl();await releaseWake();try{renderTask?.cancel()}catch{}renderTask=null;pdfDoc=null;kind=null;pages=[];clearOwned();reader.hidden=true;home.hidden=false;pasteSheet.hidden=true;actionSheet.hidden=true;permission.hidden=true;filesInput.value='';setLoading(false);window.scrollTo({top:0,behavior:'instant'})}

  choose.onclick=()=>filesInput.click();filesInput.onchange=()=>{openFiles(filesInput.files);filesInput.value=''};
  pasteOpen.onclick=()=>{pasteSheet.hidden=false;pasteText.focus()};pasteClose.onclick=()=>pasteSheet.hidden=true;pasteModes.querySelectorAll('button').forEach(b=>b.onclick=()=>{pasteMode=b.dataset.mode;pasteModes.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b))});pasteUse.onclick=async()=>{const t=pasteText.value.trim();if(!t)return;pasteSheet.hidden=true;clearOwned();cleanupControl();await openText(t,pasteMode,'文字')};
  actionBtn.onclick=openActionSheet;actionClose.onclick=()=>actionSheet.hidden=true;actionOptions.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>prepareControl(b.dataset.mode));permissionAction.onclick=()=>activateMode(permission.dataset.mode||controlMode);
  prevBtn.onclick=prevPage;nextBtn.onclick=nextPage;exit.onclick=closeReader;
  stage.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId}});stage.addEventListener('pointerup',e=>{if(!pointerStart||pointerStart.id!==e.pointerId)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){dx<0?nextPage():prevPage()}});
  document.addEventListener('keydown',e=>{if(reader.hidden)return;if(e.key==='ArrowRight'||e.key==='PageDown')nextPage();if(e.key==='ArrowLeft'||e.key==='PageUp')prevPage()});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(reader.hidden)return;if(kind==='pdf')showPage(current)},150)});
  document.addEventListener('visibilitychange',async()=>{if(reader.hidden)return;if(document.hidden){listening=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;await releaseWake()}else{await requestWake();if(stream&&!learning){listening=true;cooldownUntil=performance.now()+500;gestureLoop()}}});
  window.addEventListener('pagehide',()=>{cleanupControl();releaseWake();clearOwned()});
})();