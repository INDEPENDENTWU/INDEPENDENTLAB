(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),choose=$('#choose'),filesInput=$('#files'),error=$('#error'),reader=$('#reader'),exit=$('#exit'),relearn=$('#relearn');
  const stage=$('#stage'),pdfCanvas=$('#pdfCanvas'),imagePage=$('#imagePage'),loading=$('#loading'),loadingNote=$('#loadingNote');
  const calibration=$('#calibration'),calStep=$('#calStep'),calValue=$('#calValue'),calHint=$('#calHint'),calAction=$('#calAction');
  const micState=$('#micState'),pageNow=$('#pageNow'),pageTotal=$('#pageTotal'),breathDot=$('#breathDot'),breathText=$('#breathText'),prevBtn=$('#prev'),nextBtn=$('#next');
  const edgePrev=$('#edgePrev'),edgeNext=$('#edgeNext'),pctx=pdfCanvas.getContext('2d',{alpha:false});

  let kind=null,pdfjs=null,pdfDoc=null,imageUrls=[],current=1,total=1,renderToken=0,renderTask=null;
  let stream=null,audio=null,source=null,analyser=null,timeData=null,freqData=null,wake=null;
  let ambient=.002,learned=null,listening=false,raf=0,lastFrame=0,blowing=false,blowStart=0,lastActive=0,longDone=false,cooldownUntil=0;
  let calMode='start',busyCal=false,pointerStart=null,resizeTimer=0;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const median=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function setLoading(on,note='请稍候'){loading.hidden=!on;loadingNote.textContent=note}
  function revokeImages(){for(const u of imageUrls)URL.revokeObjectURL(u);imageUrls=[]}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function cleanupAudio(){
    listening=false;cancelAnimationFrame(raf);raf=0;blowing=false;
    if(source){try{source.disconnect()}catch{}source=null}if(analyser){try{analyser.disconnect()}catch{}analyser=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}
    timeData=null;freqData=null;breathDot.classList.remove('live','blowing');micState.textContent='麦克风已关闭';
  }
  async function closeReader(){
    cleanupAudio();await releaseWake();try{renderTask?.cancel()}catch{}renderTask=null;pdfDoc=null;kind=null;revokeImages();reader.hidden=true;home.hidden=false;filesInput.value='';setLoading(false);window.scrollTo({top:0,behavior:'instant'});
  }

  async function loadPdfLibrary(){
    if(pdfjs)return pdfjs;
    const sources=[
      {module:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'},
      {module:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'}
    ];
    let last=null;for(const src of sources){try{pdfjs=await import(src.module);pdfjs.GlobalWorkerOptions.workerSrc=src.worker;break}catch(e){last=e;pdfjs=null}}
    if(!pdfjs)throw last||new Error('pdfjs');return pdfjs;
  }
  async function openFiles(list){
    setError('');const files=[...list];if(!files.length)return;
    const pdfs=files.filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)),imgs=files.filter(f=>f.type.startsWith('image/'));
    if(pdfs.length&&imgs.length){setError('PDF 和图片请分开选择。');return}
    if(pdfs.length>1){setError('一次先打开一个 PDF。');return}
    reader.hidden=false;home.hidden=true;setLoading(true,pdfs.length?'正在读取 PDF':'正在准备图片');current=1;cleanupAudio();await releaseWake();
    try{
      if(pdfs.length){
        kind='pdf';imagePage.hidden=true;pdfCanvas.hidden=false;const lib=await loadPdfLibrary();const data=new Uint8Array(await pdfs[0].arrayBuffer());pdfDoc=await lib.getDocument({data}).promise;total=pdfDoc.numPages;
      }else if(imgs.length){
        kind='images';pdfCanvas.hidden=true;imagePage.hidden=false;const sorted=[...imgs].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));imageUrls=sorted.map(f=>URL.createObjectURL(f));total=imageUrls.length;
      }else throw new Error('unsupported');
      pageTotal.textContent=String(total);await showPage(1);setLoading(false);showCalibrationStart();requestWake();
    }catch(e){
      console.error(e);await closeReader();setError(pdfs.length?'这个 PDF 没有成功打开。可以换一个 PDF，或先把页面导成图片再试。':'这些图片没有成功打开。');
    }
  }

  async function showPage(n,flashDir=null){
    if(!kind)return;current=clamp(n,1,total);pageNow.textContent=String(current);prevBtn.disabled=current<=1;nextBtn.disabled=current>=total;
    if(flashDir)flashEdge(flashDir);
    if(kind==='images'){
      const token=++renderToken;imagePage.src=imageUrls[current-1];try{await imagePage.decode()}catch{}if(token!==renderToken)return;return;
    }
    const token=++renderToken;try{renderTask?.cancel()}catch{}renderTask=null;
    const page=await pdfDoc.getPage(current);if(token!==renderToken)return;
    const base=page.getViewport({scale:1}),r=stage.getBoundingClientRect(),maxW=Math.max(120,r.width-8),maxH=Math.max(120,r.height-8),fit=Math.min(maxW/base.width,maxH/base.height),dpr=Math.min(2,window.devicePixelRatio||1),vp=page.getViewport({scale:fit*dpr});
    pdfCanvas.width=Math.max(1,Math.round(vp.width));pdfCanvas.height=Math.max(1,Math.round(vp.height));pdfCanvas.style.width=`${vp.width/dpr}px`;pdfCanvas.style.height=`${vp.height/dpr}px`;
    pctx.save();pctx.fillStyle='#fff';pctx.fillRect(0,0,pdfCanvas.width,pdfCanvas.height);pctx.restore();
    renderTask=page.render({canvasContext:pctx,viewport:vp});try{await renderTask.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}finally{if(token===renderToken)renderTask=null}
  }
  function flashEdge(dir){const el=dir==='prev'?edgePrev:edgeNext;el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),220)}
  function nextPage(){if(current<total)showPage(current+1,'next');else{flashEdge('next');breathText.textContent='已经是最后一页';setTimeout(defaultBreathText,900)}}
  function prevPage(){if(current>1)showPage(current-1,'prev');else{flashEdge('prev');breathText.textContent='已经是第一页';setTimeout(defaultBreathText,900)}}
  function defaultBreathText(){if(learned&&listening)breathText.textContent='短吹下一页 · 长吹上一页'}

  function feature(){
    if(!analyser)return{rms:0,ratio:0,flat:0};analyser.getFloatTimeDomainData(timeData);let sum=0;for(const v of timeData)sum+=v*v;const rms=Math.sqrt(sum/timeData.length);
    analyser.getFloatFrequencyData(freqData);const ny=audio.sampleRate/2,binHz=ny/freqData.length;let low=0,lowN=0,high=0,highN=0,logSum=0,arith=0,flatN=0;
    for(let i=1;i<freqData.length;i++){const hz=i*binHz,db=freqData[i];if(!Number.isFinite(db))continue;const p=Math.pow(10,db/10);if(hz>=120&&hz<=900){low+=p;lowN++}if(hz>=1200&&hz<=8500){high+=p;highN++;logSum+=Math.log(p+1e-14);arith+=p;flatN++}}
    const lo=low/Math.max(1,lowN),hi=high/Math.max(1,highN),ratio=hi/(lo+1e-14),geo=flatN?Math.exp(logSum/flatN):0,flat=geo/(arith/Math.max(1,flatN)+1e-14);return{rms,ratio,flat};
  }
  async function setupAudio(){
    cleanupAudio();if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');const sup=navigator.mediaDevices.getSupportedConstraints?.()||{},c={channelCount:1};
    if(sup.echoCancellation)c.echoCancellation=false;if(sup.noiseSuppression)c.noiseSuppression=false;if(sup.autoGainControl)c.autoGainControl=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:c,video:false});const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);analyser=audio.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.18;source.connect(analyser);timeData=new Float32Array(analyser.fftSize);freqData=new Float32Array(analyser.frequencyBinCount);micState.textContent='麦克风已开启';breathDot.classList.add('live');
  }
  async function collect(ms,onTick){const arr=[],start=performance.now();while(performance.now()-start<ms){const elapsed=performance.now()-start;arr.push(feature());onTick?.(elapsed,ms);await sleep(34)}return arr}

  function showCalibrationStart(){
    learned=null;listening=false;cancelAnimationFrame(raf);raf=0;calibration.hidden=false;calStep.textContent='准备吹气';calValue.textContent='—';calHint.textContent='先让麦克风听一小会儿环境，再学一次你的吹气。';calAction.hidden=false;calAction.textContent='开启麦克风';calAction.disabled=false;calMode='start';micState.textContent='准备麦克风';breathText.textContent='完成一次吹气校准后开始';
  }
  async function beginAmbient(){
    if(busyCal)return;busyCal=true;calAction.disabled=true;
    try{await setupAudio();calAction.hidden=true;calStep.textContent='先听一下环境';calHint.textContent='保持安静一小会儿';const vals=await collect(1500,(e,m)=>calValue.textContent=((m-e)/1000).toFixed(1));ambient=Math.max(.0008,median(vals.map(x=>x.rms).filter(Number.isFinite))||.002);calStep.textContent='现在学你的吹气';calValue.textContent='1×';calHint.textContent='点下面按钮后，靠近手机底部麦克风吹一下，短短一口就够。';calAction.hidden=false;calAction.disabled=false;calAction.textContent='吹一下开始';calMode='learn';}
    catch(e){cleanupAudio();calStep.textContent='麦克风没有打开';calValue.textContent='—';calHint.textContent=e?.name==='NotAllowedError'?'没有获得麦克风权限。允许后再试。':'当前浏览器没有提供可用的麦克风。';calAction.hidden=false;calAction.disabled=false;calAction.textContent='再试一次';calMode='start'}finally{busyCal=false}
  }
  async function learnBlow(){
    if(busyCal||!analyser)return;busyCal=true;calAction.hidden=true;calStep.textContent='吹一下';calHint.textContent='现在对着手机底部吹一小口气';
    const vals=await collect(2200,(e,m)=>calValue.textContent=((m-e)/1000).toFixed(1));const gate=Math.max(.006,ambient*2.5),strong=vals.filter(v=>v.rms>=gate).sort((a,b)=>b.rms-a.rms),keep=strong.slice(0,Math.max(4,Math.ceil(strong.length*.55)));
    if(keep.length<4){calStep.textContent='没有听清';calValue.textContent='—';calHint.textContent='靠近手机底部麦克风一点，再吹一次。';calAction.hidden=false;calAction.textContent='重新吹一次';calMode='learn';busyCal=false;return}
    learned={rms:median(keep.map(v=>v.rms)),ratio:median(keep.map(v=>v.ratio)),flat:median(keep.map(v=>v.flat))};
    if(!(learned.rms>gate)||!(learned.flat>.015)){calStep.textContent='这次不像吹气';calValue.textContent='—';calHint.textContent='不要说话，直接对着麦克风吹一小口气。';calAction.hidden=false;calAction.textContent='重新吹一次';calMode='learn';busyCal=false;return}
    calibration.hidden=true;calAction.hidden=true;calMode='done';micState.textContent='正在听吹气';breathText.textContent='短吹下一页 · 长吹上一页';listening=true;cooldownUntil=performance.now()+500;requestWake();startMonitor();busyCal=false;
  }
  function isBreath(f){if(!learned)return false;const rmsMin=Math.max(.0055,ambient*2.55,learned.rms*.27),ratioMin=Math.max(.22,learned.ratio*.34),flatMin=Math.max(.018,learned.flat*.38);return f.rms>=rmsMin&&f.ratio>=ratioMin&&f.flat>=flatMin}
  function startMonitor(){
    cancelAnimationFrame(raf);lastFrame=0;blowing=false;longDone=false;
    const loop=now=>{raf=requestAnimationFrame(loop);if(!listening||!analyser||now-lastFrame<30)return;lastFrame=now;const f=feature(),active=now>=cooldownUntil&&isBreath(f);
      if(active){lastActive=now;if(!blowing){blowing=true;blowStart=now;longDone=false;breathDot.classList.add('blowing');breathText.textContent='继续吹到长吹可返回'}const dur=now-blowStart;if(dur>=900&&!longDone){longDone=true;prevPage();breathText.textContent='长吹 · 上一页'}}
      else if(blowing&&now-lastActive>110){const dur=lastActive-blowStart;blowing=false;breathDot.classList.remove('blowing');cooldownUntil=now+560;if(!longDone&&dur>=120&&dur<850){nextPage();breathText.textContent='短吹 · 下一页'}setTimeout(defaultBreathText,650)}
      else if(!blowing&&now>=cooldownUntil&&f.rms<Math.max(.01,ambient*2.2)){ambient=ambient*.994+f.rms*.006}
    };raf=requestAnimationFrame(loop)
  }

  choose.onclick=()=>filesInput.click();filesInput.onchange=()=>openFiles(filesInput.files);
  calAction.onclick=()=>calMode==='start'?beginAmbient():calMode==='learn'?learnBlow():null;
  relearn.onclick=()=>{if(reader.hidden)return;cleanupAudio();showCalibrationStart()};
  prevBtn.onclick=prevPage;nextBtn.onclick=nextPage;exit.onclick=closeReader;
  document.addEventListener('keydown',e=>{if(reader.hidden)return;if(e.key==='ArrowRight'||e.key==='PageDown')nextPage();if(e.key==='ArrowLeft'||e.key==='PageUp')prevPage()});
  stage.addEventListener('pointerdown',e=>{if(!calibration.hidden)return;pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId}});
  stage.addEventListener('pointerup',e=>{if(!pointerStart||pointerStart.id!==e.pointerId)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){dx<0?nextPage():prevPage()}});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(kind==='pdf'&&!reader.hidden)showPage(current)},140)});
  document.addEventListener('visibilitychange',async()=>{if(reader.hidden)return;if(document.hidden){await releaseWake();if(audio)try{await audio.suspend()}catch{}micState.textContent='页面已暂停'}else{await requestWake();if(audio)try{await audio.resume()}catch{}if(learned){micState.textContent='正在听吹气';listening=true;startMonitor()}}});
  window.addEventListener('pagehide',()=>{cleanupAudio();releaseWake();revokeImages()});
})();