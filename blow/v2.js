(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),choose=$('#choose'),filesInput=$('#files'),error=$('#error'),reader=$('#reader'),exit=$('#exit'),relearn=$('#relearn');
  const stage=$('#stage'),pdfCanvas=$('#pdfCanvas'),imagePage=$('#imagePage'),loading=$('#loading'),loadingNote=$('#loadingNote');
  const calibration=$('#calibration'),calStep=$('#calStep'),calValue=$('#calValue'),calHint=$('#calHint'),calAction=$('#calAction'),calMeter=$('#calMeter');
  const micState=$('#micState'),pageNow=$('#pageNow'),pageTotal=$('#pageTotal'),breathDot=$('#breathDot'),breathText=$('#breathText'),breathLevel=$('#breathLevel'),prevBtn=$('#prev'),nextBtn=$('#next');
  const edgePrev=$('#edgePrev'),edgeNext=$('#edgeNext'),pctx=pdfCanvas.getContext('2d',{alpha:false});

  let kind=null,pdfjs=null,pdfDoc=null,imageUrls=[],current=1,total=1,renderToken=0,renderTask=null,pdfWorker='';
  let stream=null,audio=null,source=null,analyser=null,timeData=null,freqData=null,wake=null;
  let ambient=.002,learned=null,listening=false,raf=0,lastFrame=0,blowing=false,blowStart=0,lastActive=0,longDone=false,cooldownUntil=0;
  let learnRaf=0,learnEvents=[],learnActive=false,learnStart=0,learnLast=0,learnFrames=[];
  let pointerStart=null,resizeTimer=0,busy=false;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const median=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const ratioSim=(a,b)=>{if(!(a>0)||!(b>0))return 0;return clamp(Math.min(a/b,b/a),0,1)};

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function setLoading(on,note='请稍候'){loading.hidden=!on;loadingNote.textContent=note}
  function revokeImages(){for(const u of imageUrls)URL.revokeObjectURL(u);imageUrls=[]}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function cleanupAudio(){
    listening=false;cancelAnimationFrame(raf);raf=0;cancelAnimationFrame(learnRaf);learnRaf=0;blowing=false;learnActive=false;
    if(source){try{source.disconnect()}catch{}source=null}if(analyser){try{analyser.disconnect()}catch{}analyser=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}
    timeData=null;freqData=null;breathDot.classList.remove('live','blowing');breathLevel.style.width='0%';
  }
  async function closeReader(){
    cleanupAudio();await releaseWake();try{renderTask?.cancel()}catch{}renderTask=null;pdfDoc=null;kind=null;revokeImages();reader.hidden=true;home.hidden=false;filesInput.value='';setLoading(false);window.scrollTo({top:0,behavior:'instant'});
  }

  async function loadPdfLibrary(){
    if(pdfjs)return pdfjs;
    const sources=[
      {main:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'},
      {main:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'}
    ];
    let last=null;for(const s of sources){try{pdfjs=await import(s.main);pdfWorker=s.worker;break}catch(e){last=e}}
    if(!pdfjs)throw last||new Error('pdfjs');pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;return pdfjs;
  }
  async function openFiles(list){
    setError('');const files=[...list];if(!files.length)return;
    const pdfs=files.filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)),imgs=files.filter(f=>f.type.startsWith('image/'));
    if(pdfs.length&&imgs.length){setError('PDF 和图片请分开选择。');return}if(pdfs.length>1){setError('一次先打开一个 PDF。');return}
    reader.hidden=false;home.hidden=true;setLoading(true,pdfs.length?'正在读取 PDF':'正在准备图片');current=1;cleanupAudio();await releaseWake();
    try{
      if(pdfs.length){kind='pdf';imagePage.hidden=true;pdfCanvas.hidden=false;const lib=await loadPdfLibrary();const data=new Uint8Array(await pdfs[0].arrayBuffer());pdfDoc=await lib.getDocument({data}).promise;total=pdfDoc.numPages}
      else if(imgs.length){kind='images';pdfCanvas.hidden=true;imagePage.hidden=false;const sorted=[...imgs].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));imageUrls=sorted.map(f=>URL.createObjectURL(f));total=imageUrls.length}
      else throw new Error('unsupported');
      pageTotal.textContent=String(total);await showPage(1);setLoading(false);showCalibrationStart();requestWake();
    }catch(e){console.error(e);await closeReader();setError(pdfs.length?'这个 PDF 没有成功打开。可以换一个 PDF，或先把页面导成图片再试。':'这些图片没有成功打开。')}
  }

  async function showPage(n,flashDir=null){
    if(!kind)return;current=clamp(n,1,total);pageNow.textContent=String(current);prevBtn.disabled=current<=1;nextBtn.disabled=current>=total;if(flashDir)flashEdge(flashDir);
    if(kind==='images'){const token=++renderToken;imagePage.src=imageUrls[current-1];try{await imagePage.decode()}catch{}if(token!==renderToken)return;return}
    const token=++renderToken;try{renderTask?.cancel()}catch{}renderTask=null;const page=await pdfDoc.getPage(current);if(token!==renderToken)return;
    const base=page.getViewport({scale:1}),r=stage.getBoundingClientRect(),maxW=Math.max(120,r.width-8),maxH=Math.max(120,r.height-8),fit=Math.min(maxW/base.width,maxH/base.height),dpr=Math.min(2,window.devicePixelRatio||1),vp=page.getViewport({scale:fit*dpr});
    pdfCanvas.width=Math.max(1,Math.round(vp.width));pdfCanvas.height=Math.max(1,Math.round(vp.height));pdfCanvas.style.width=`${vp.width/dpr}px`;pdfCanvas.style.height=`${vp.height/dpr}px`;pctx.fillStyle='#fff';pctx.fillRect(0,0,pdfCanvas.width,pdfCanvas.height);
    renderTask=page.render({canvasContext:pctx,viewport:vp});try{await renderTask.promise}catch(e){if(e?.name!=='RenderingCancelledException')throw e}finally{if(token===renderToken)renderTask=null}
  }
  function flashEdge(dir){const el=dir==='prev'?edgePrev:edgeNext;el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),220)}
  function defaultBreathText(){if(learned&&listening)breathText.textContent='短吹下一页 · 长吹上一页'}
  function nextPage(){if(current<total)showPage(current+1,'next');else{flashEdge('next');breathText.textContent='已经是最后一页';setTimeout(defaultBreathText,900)}}
  function prevPage(){if(current>1)showPage(current-1,'prev');else{flashEdge('prev');breathText.textContent='已经是第一页';setTimeout(defaultBreathText,900)}}

  function feature(){
    if(!analyser)return{rms:0,low:.33,mid:.33,high:.34,flat:0};
    analyser.getFloatTimeDomainData(timeData);let sum=0;for(const v of timeData)sum+=v*v;const rms=Math.sqrt(sum/timeData.length);
    analyser.getFloatFrequencyData(freqData);const ny=audio.sampleRate/2,binHz=ny/freqData.length;let low=0,mid=0,high=0,totalP=0,logSum=0,arith=0,n=0;
    for(let i=1;i<freqData.length;i++){
      const hz=i*binHz;if(hz<40||hz>8500)continue;const db=freqData[i];if(!Number.isFinite(db))continue;const p=Math.pow(10,db/10);totalP+=p;if(hz<550)low+=p;else if(hz<1900)mid+=p;else high+=p;logSum+=Math.log(p+1e-18);arith+=p;n++;
    }
    const t=totalP+1e-18,flat=n?Math.exp(logSum/n)/(arith/n+1e-18):0;return{rms,low:low/t,mid:mid/t,high:high/t,flat};
  }
  async function setupAudio(){
    cleanupAudio();if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');const sup=navigator.mediaDevices.getSupportedConstraints?.()||{},c={channelCount:1};
    if(sup.echoCancellation)c.echoCancellation=false;if(sup.noiseSuppression)c.noiseSuppression=false;if(sup.autoGainControl)c.autoGainControl=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:c,video:false});const track=stream.getAudioTracks()[0];try{await track.applyConstraints(c)}catch{}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);analyser=audio.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.1;source.connect(analyser);timeData=new Float32Array(analyser.fftSize);freqData=new Float32Array(analyser.frequencyBinCount);micState.textContent='麦克风已开启';breathDot.classList.add('live');
  }
  async function collectAmbient(ms=1300){const vals=[],t0=performance.now();while(performance.now()-t0<ms){vals.push(feature().rms);calValue.textContent=((ms-(performance.now()-t0))/1000).toFixed(1);await sleep(32)}return Math.max(.0007,median(vals.filter(Number.isFinite))||.002)}

  function showCalibrationStart(){
    learned=null;listening=false;cancelAnimationFrame(raf);raf=0;cancelAnimationFrame(learnRaf);learnRaf=0;calibration.hidden=false;calStep.textContent='准备麦克风';calValue.textContent='—';calHint.textContent='先听一小会儿环境，再连续学三次吹气。';calAction.hidden=false;calAction.disabled=false;calAction.textContent='开启麦克风';calMeter.style.width='0%';micState.textContent='准备麦克风';breathText.textContent='完成吹气校准后开始';
  }
  function eventSummary(frames){
    if(!frames.length)return null;const strong=[...frames].sort((a,b)=>b.rms-a.rms).slice(0,Math.max(3,Math.ceil(frames.length*.7)));return{rms:median(strong.map(x=>x.rms)),low:median(strong.map(x=>x.low)),high:median(strong.map(x=>x.high)),flat:median(strong.map(x=>x.flat))};
  }
  function finishLearnEvent(now){
    const dur=learnLast-learnStart,summary=eventSummary(learnFrames);learnActive=false;learnFrames=[];
    if(dur<80||dur>1800||!summary)return;
    learnEvents.push(summary);navigator.vibrate?.(12);calValue.textContent=`${learnEvents.length} / 3`;calHint.textContent=learnEvents.length<3?'收到。再吹一次，分开一点。':'正在完成';
    if(learnEvents.length>=3){
      learned={rms:median(learnEvents.map(x=>x.rms)),low:median(learnEvents.map(x=>x.low)),high:median(learnEvents.map(x=>x.high)),flat:median(learnEvents.map(x=>x.flat))};
      cancelAnimationFrame(learnRaf);learnRaf=0;calibration.hidden=true;micState.textContent='正在听吹气';breathText.textContent='短吹下一页 · 长吹上一页';listening=true;cooldownUntil=now+500;requestWake();startMonitor();
    }
  }
  function startLearning(){
    learnEvents=[];learnActive=false;learnFrames=[];calStep.textContent='连续吹三次';calValue.textContent='0 / 3';calHint.textContent='靠近手机底部麦克风，短短吹一下；每次之间停半秒。';calAction.hidden=true;
    const gate=Math.max(.0028,ambient*1.75);let last=0;
    const loop=now=>{learnRaf=requestAnimationFrame(loop);if(now-last<28)return;last=now;const f=feature(),level=clamp((f.rms-gate*.65)/(Math.max(gate,ambient)*2.2),0,1);calMeter.style.width=`${Math.round(level*100)}%`;const active=f.rms>=gate;
      if(active){if(!learnActive){learnActive=true;learnStart=now;learnFrames=[]}learnLast=now;learnFrames.push(f)}
      else if(learnActive&&now-learnLast>150)finishLearnEvent(now);
    };learnRaf=requestAnimationFrame(loop);
  }
  async function beginCalibration(){
    if(busy)return;busy=true;calAction.disabled=true;try{await setupAudio();calAction.hidden=true;calStep.textContent='先听一下环境';calValue.textContent='1.3';calHint.textContent='先别吹，也不用说话';ambient=await collectAmbient();startLearning()}
    catch(e){cleanupAudio();calStep.textContent='麦克风没有打开';calValue.textContent='—';calHint.textContent=e?.name==='NotAllowedError'?'没有获得麦克风权限。允许后再试。':'当前浏览器没有提供可用的麦克风。';calAction.hidden=false;calAction.disabled=false;calAction.textContent='再试一次'}finally{busy=false}
  }

  function breathScore(f){
    if(!learned)return{active:false,score:0};const ampGate=Math.max(.0024,ambient*1.65,learned.rms*.12),ampRatio=f.rms/ampGate;
    const shape=(ratioSim(f.low,learned.low)*.42+ratioSim(f.high,learned.high)*.28+ratioSim(Math.max(f.flat,.002),Math.max(learned.flat,.002))*.30);
    const ampScore=clamp((ampRatio-.7)/1.8,0,1),score=clamp(ampScore*.64+shape*.36,0,1);const active=f.rms>=ampGate&&(shape>=.38||f.rms>=learned.rms*.72);return{active,score};
  }
  function startMonitor(){
    cancelAnimationFrame(raf);lastFrame=0;blowing=false;longDone=false;
    const loop=now=>{raf=requestAnimationFrame(loop);if(!listening||!analyser||now-lastFrame<28)return;lastFrame=now;const f=feature(),b=breathScore(f),enabled=now>=cooldownUntil&&b.active;breathLevel.style.width=`${Math.round(b.score*100)}%`;
      if(enabled){lastActive=now;if(!blowing){blowing=true;blowStart=now;longDone=false;breathDot.classList.add('blowing');breathText.textContent='识别到吹气'}const dur=now-blowStart;if(dur>=720&&!longDone){longDone=true;prevPage();breathText.textContent='长吹 · 上一页'}}
      else if(blowing&&now-lastActive>150){const dur=lastActive-blowStart;blowing=false;breathDot.classList.remove('blowing');cooldownUntil=now+520;if(!longDone&&dur>=90&&dur<700){nextPage();breathText.textContent='短吹 · 下一页'}else if(!longDone&&dur<90){breathText.textContent='太短，没有翻页'}setTimeout(defaultBreathText,650)}
      else if(!blowing&&now>=cooldownUntil&&f.rms<Math.max(.01,ambient*2.1)){ambient=ambient*.995+f.rms*.005}
    };raf=requestAnimationFrame(loop)
  }

  choose.onclick=()=>filesInput.click();filesInput.onchange=()=>openFiles(filesInput.files);calAction.onclick=beginCalibration;
  relearn.onclick=()=>{if(reader.hidden)return;cleanupAudio();showCalibrationStart()};prevBtn.onclick=prevPage;nextBtn.onclick=nextPage;exit.onclick=closeReader;
  document.addEventListener('keydown',e=>{if(reader.hidden)return;if(e.key==='ArrowRight'||e.key==='PageDown')nextPage();if(e.key==='ArrowLeft'||e.key==='PageUp')prevPage()});
  stage.addEventListener('pointerdown',e=>{if(!calibration.hidden)return;pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId}});
  stage.addEventListener('pointerup',e=>{if(!pointerStart||pointerStart.id!==e.pointerId)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){dx<0?nextPage():prevPage()}});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!reader.hidden&&kind==='pdf')showPage(current)},120)});
  document.addEventListener('visibilitychange',async()=>{if(reader.hidden)return;if(document.hidden){listening=false;cancelAnimationFrame(raf);raf=0;await releaseWake()}else{await requestWake();if(learned&&analyser){listening=true;cooldownUntil=performance.now()+600;startMonitor()}}});
  window.addEventListener('pagehide',()=>{cleanupAudio();releaseWake();revokeImages()});
})();