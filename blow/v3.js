(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),choose=$('#choose'),filesInput=$('#files'),error=$('#error');
  const reader=$('#reader'),exit=$('#exit'),relearn=$('#relearn'),stage=$('#stage');
  const pdfCanvas=$('#pdfCanvas'),imagePage=$('#imagePage'),loading=$('#loading'),loadingNote=$('#loadingNote'),pctx=pdfCanvas.getContext('2d',{alpha:false});
  const calibration=$('#calibration'),calStep=$('#calStep'),calValue=$('#calValue'),calHint=$('#calHint'),calAction=$('#calAction'),calMeter=$('#calMeter');
  const faceVideo=$('#faceVideo'),faceState=$('#faceState'),micState=$('#micState');
  const pageNow=$('#pageNow'),pageTotal=$('#pageTotal'),breathText=$('#breathText'),breathLevel=$('#breathLevel');
  const audioCheck=$('#audioCheck'),mouthCheck=$('#mouthCheck'),stillCheck=$('#stillCheck');
  const prevBtn=$('#prev'),nextBtn=$('#next'),edgePrev=$('#edgePrev'),edgeNext=$('#edgeNext');

  let kind=null,pdfjs=null,pdfDoc=null,imageUrls=[],current=1,total=1,renderToken=0,renderTask=null,pdfWorker='';
  let stream=null,audio=null,source=null,analyser=null,timeData=null,freqData=null,wake=null;
  let faceLandmarker=null,faceLoop=0,faceLastRun=0,faceSeenUntil=0,currentMouth={pucker:0,funnel:0,puff:0,jaw:0,key:0};
  let motionGranted=false,motionAvailable=false,movingUntil=0,lastGravity=null;
  let ambient=.002,idleMouth=.03,learned=null,listening=false,monitorRaf=0,lastAudioFrame=0;
  let blowing=false,blowStart=0,lastConfirmed=0,longDone=false,cooldownUntil=0;
  let learning=false,learnRaf=0,learnActive=false,learnStart=0,learnLast=0,learnFrames=[],learnEvents=[],learnMoved=false;
  let pointerStart=null,resizeTimer=0,busy=false;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const median=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const ratioSim=(a,b)=>{a=Math.max(.002,a||0);b=Math.max(.002,b||0);return clamp(Math.min(a/b,b/a),0,1)};

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function setLoading(on,note='请稍候'){loading.hidden=!on;loadingNote.textContent=note}
  function setCheck(el,state){el.classList.toggle('on',state===true);el.classList.toggle('bad',state==='bad')}
  function setChecks(a=false,m=false,s=true){setCheck(audioCheck,a);setCheck(mouthCheck,m);setCheck(stillCheck,s)}
  function revokeImages(){for(const u of imageUrls)URL.revokeObjectURL(u);imageUrls=[]}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function cleanupMedia(){
    listening=false;learning=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;cancelAnimationFrame(learnRaf);learnRaf=0;cancelAnimationFrame(faceLoop);faceLoop=0;
    blowing=false;learnActive=false;faceSeenUntil=0;currentMouth={pucker:0,funnel:0,puff:0,jaw:0,key:0};
    if(source){try{source.disconnect()}catch{}source=null}if(analyser){try{analyser.disconnect()}catch{}analyser=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}faceVideo.srcObject=null;
    if(audio){try{audio.close()}catch{}audio=null}timeData=null;freqData=null;lastGravity=null;movingUntil=0;
    faceVideo.classList.remove('show');faceState.textContent='准备前置相机';micState.textContent='吹气识别未开启';breathLevel.style.width='0%';setChecks(false,false,true)
  }
  async function closeReader(){
    cleanupMedia();await releaseWake();try{renderTask?.cancel()}catch{}renderTask=null;pdfDoc=null;kind=null;revokeImages();reader.hidden=true;home.hidden=false;filesInput.value='';setLoading(false);window.scrollTo({top:0,behavior:'instant'})
  }

  async function loadPdfLibrary(){
    if(pdfjs)return pdfjs;
    const sources=[
      {main:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'},
      {main:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.mjs',worker:'https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.mjs'}
    ];
    let last=null;for(const s of sources){try{pdfjs=await import(s.main);pdfWorker=s.worker;break}catch(e){last=e}}
    if(!pdfjs)throw last||new Error('pdfjs');pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;return pdfjs
  }
  async function openFiles(list){
    setError('');const files=[...list];if(!files.length)return;
    const pdfs=files.filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)),imgs=files.filter(f=>f.type.startsWith('image/'));
    if(pdfs.length&&imgs.length){setError('PDF 和图片请分开选择。');return}if(pdfs.length>1){setError('一次先打开一个 PDF。');return}
    reader.hidden=false;home.hidden=true;setLoading(true,pdfs.length?'正在读取 PDF':'正在准备图片');current=1;cleanupMedia();await releaseWake();
    try{
      if(pdfs.length){kind='pdf';imagePage.hidden=true;pdfCanvas.hidden=false;const lib=await loadPdfLibrary();const data=new Uint8Array(await pdfs[0].arrayBuffer());pdfDoc=await lib.getDocument({data}).promise;total=pdfDoc.numPages}
      else if(imgs.length){kind='images';pdfCanvas.hidden=true;imagePage.hidden=false;const sorted=[...imgs].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));imageUrls=sorted.map(f=>URL.createObjectURL(f));total=imageUrls.length}
      else throw new Error('unsupported');
      pageTotal.textContent=String(total);await showPage(1);setLoading(false);showCalibrationStart();requestWake()
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
  function defaultText(){if(learned&&listening)breathText.textContent='短吹下一页 · 长吹上一页'}
  function nextPage(){if(current<total)showPage(current+1,'next');else{flashEdge('next');breathText.textContent='已经是最后一页';setTimeout(defaultText,900)}}
  function prevPage(){if(current>1)showPage(current-1,'prev');else{flashEdge('prev');breathText.textContent='已经是第一页';setTimeout(defaultText,900)}}

  function audioFeature(){
    if(!analyser)return{rms:0,low:.33,mid:.33,high:.34,flat:0};
    analyser.getFloatTimeDomainData(timeData);let sum=0;for(const v of timeData)sum+=v*v;const rms=Math.sqrt(sum/timeData.length);
    analyser.getFloatFrequencyData(freqData);const ny=audio.sampleRate/2,binHz=ny/freqData.length;let low=0,mid=0,high=0,totalP=0,logSum=0,arith=0,n=0;
    for(let i=1;i<freqData.length;i++){
      const hz=i*binHz;if(hz<40||hz>8500)continue;const db=freqData[i];if(!Number.isFinite(db))continue;const p=Math.pow(10,db/10);totalP+=p;if(hz<550)low+=p;else if(hz<1900)mid+=p;else high+=p;logSum+=Math.log(p+1e-18);arith+=p;n++
    }
    const t=totalP+1e-18,flat=n?Math.exp(logSum/n)/(arith/n+1e-18):0;return{rms,low:low/t,mid:mid/t,high:high/t,flat}
  }
  function audioSummary(frames){
    if(!frames.length)return null;const strong=[...frames].sort((a,b)=>b.audio.rms-a.audio.rms).slice(0,Math.max(3,Math.ceil(frames.length*.65)));return{
      rms:median(strong.map(x=>x.audio.rms)),low:median(strong.map(x=>x.audio.low)),mid:median(strong.map(x=>x.audio.mid)),high:median(strong.map(x=>x.audio.high)),flat:median(strong.map(x=>x.audio.flat))
    }
  }
  function audioEvidence(f){
    if(!learned)return{ok:false,score:0};const gate=Math.max(.0024,ambient*1.7,learned.audio.rms*.11),amp=f.rms/gate;
    const shape=ratioSim(f.low,learned.audio.low)*.26+ratioSim(f.mid,learned.audio.mid)*.16+ratioSim(f.high,learned.audio.high)*.28+ratioSim(f.flat,learned.audio.flat)*.30;
    const score=clamp(clamp((amp-.7)/1.8,0,1)*.58+shape*.42,0,1);return{ok:f.rms>=gate&&(shape>=.26||f.rms>=learned.audio.rms*.62),score}
  }

  function mapBlendshapes(result){
    const cats=result?.faceBlendshapes?.[0]?.categories||[];const m={};for(const c of cats){const k=String(c.categoryName||c.displayName||'').replace(/[_\s-]/g,'').toLowerCase();m[k]=Number(c.score)||0}
    const pucker=m.mouthpucker||0,funnel=m.mouthfunnel||0,puff=m.cheekpuff||0,jaw=m.jawopen||0,key=Math.max(pucker,funnel*.94,puff*.78);return{pucker,funnel,puff,jaw,key}
  }
  function mouthEvidence(){
    if(!learned||performance.now()>faceSeenUntil)return{ok:false,score:0};const m=currentMouth,den=Math.max(.035,learned.mouth.key-idleMouth),activation=clamp((m.key-idleMouth)/den,0,1.4);
    const shape=ratioSim(m.pucker+.012,learned.mouth.pucker+.012)*.40+ratioSim(m.funnel+.012,learned.mouth.funnel+.012)*.34+ratioSim(m.puff+.012,learned.mouth.puff+.012)*.26;
    const score=clamp(activation*.62+shape*.38,0,1);return{ok:m.key>=learned.mouthThreshold&&activation>=.30&&shape>=.34,score}
  }

  async function loadFaceLandmarker(){
    if(faceLandmarker)return faceLandmarker;
    const sources=[
      {js:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm',wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'},
      {js:'https://esm.sh/@mediapipe/tasks-vision@0.10.35',wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'}
    ];
    let last=null;
    for(const s of sources){
      try{
        const mod=await import(s.js),FilesetResolver=mod.FilesetResolver||mod.default?.FilesetResolver,FaceLandmarker=mod.FaceLandmarker||mod.default?.FaceLandmarker;if(!FilesetResolver||!FaceLandmarker)throw new Error('module');
        const vision=await FilesetResolver.forVisionTasks(s.wasm);faceLandmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,minFaceDetectionConfidence:.45,minFacePresenceConfidence:.45,minTrackingConfidence:.45});return faceLandmarker
      }catch(e){last=e;faceLandmarker=null}
    }
    throw last||new Error('face')
  }
  function startFaceLoop(){
    cancelAnimationFrame(faceLoop);faceLastRun=0;const loop=now=>{faceLoop=requestAnimationFrame(loop);if(!stream||!faceLandmarker||document.hidden||now-faceLastRun<95||faceVideo.readyState<2)return;faceLastRun=now;try{const res=faceLandmarker.detectForVideo(faceVideo,now),m=mapBlendshapes(res);if(res?.faceLandmarks?.length||res?.faceBlendshapes?.length){currentMouth=m;faceSeenUntil=now+360;faceState.textContent='已看到脸';faceVideo.classList.add('found')}else if(now>faceSeenUntil){faceState.textContent='没有看到脸';faceVideo.classList.remove('found')}}catch{}};faceLoop=requestAnimationFrame(loop)
  }
  async function waitForFace(ms=6000){const t=performance.now();while(performance.now()-t<ms){if(performance.now()<faceSeenUntil)return true;await sleep(80)}return false}

  function onMotion(e){
    if(!stream)return;const now=performance.now(),a=e.acceleration,r=e.rotationRate;let moving=false;
    if(a&&[a.x,a.y,a.z].every(Number.isFinite)&&Math.hypot(a.x,a.y,a.z)>.55)moving=true;
    if(r){const vals=[r.alpha,r.beta,r.gamma].filter(Number.isFinite);if(vals.length&&Math.max(...vals.map(Math.abs))>18)moving=true}
    const g=e.accelerationIncludingGravity;if(g&&[g.x,g.y,g.z].every(Number.isFinite)){if(lastGravity&&Math.hypot(g.x-lastGravity.x,g.y-lastGravity.y,g.z-lastGravity.z)>.46)moving=true;lastGravity={x:g.x,y:g.y,z:g.z}}
    if(moving)movingUntil=now+520
  }
  window.addEventListener('devicemotion',onMotion,true);
  function isMoving(){return performance.now()<movingUntil}
  function requestMotionAccess(){
    motionAvailable=typeof DeviceMotionEvent!=='undefined';if(!motionAvailable)return Promise.resolve(false);
    if(typeof DeviceMotionEvent.requestPermission==='function')return DeviceMotionEvent.requestPermission().then(v=>motionGranted=v==='granted').catch(()=>false);
    motionGranted=true;return Promise.resolve(true)
  }

  async function setupMedia(){
    cleanupMedia();if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');const sup=navigator.mediaDevices.getSupportedConstraints?.()||{},ac={channelCount:1};
    if(sup.echoCancellation)ac.echoCancellation=false;if(sup.noiseSuppression)ac.noiseSuppression=false;if(sup.autoGainControl)ac.autoGainControl=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:ac,video:{facingMode:'user',width:{ideal:320,max:480},height:{ideal:240,max:360},frameRate:{ideal:12,max:15}}});
    const at=stream.getAudioTracks()[0];try{await at?.applyConstraints(ac)}catch{}faceVideo.srcObject=stream;await faceVideo.play();
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);analyser=audio.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.08;source.connect(analyser);timeData=new Float32Array(analyser.fftSize);freqData=new Float32Array(analyser.frequencyBinCount);micState.textContent='正在准备吹气识别';faceVideo.classList.add('show')
  }

  async function collectAmbient(ms=1200){
    const audioVals=[],mouthVals=[],t0=performance.now();while(performance.now()-t0<ms){audioVals.push(audioFeature().rms);if(performance.now()<faceSeenUntil)mouthVals.push(currentMouth.key);calValue.textContent=((ms-(performance.now()-t0))/1000).toFixed(1);await sleep(32)}
    ambient=Math.max(.0007,median(audioVals.filter(Number.isFinite))||.002);idleMouth=Math.max(.01,median(mouthVals.filter(Number.isFinite))||currentMouth.key||.03)
  }
  function showCalibrationStart(){
    learned=null;listening=false;learning=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;cancelAnimationFrame(learnRaf);learnRaf=0;calibration.hidden=false;calStep.textContent='准备吹气识别';calValue.textContent='—';calHint.textContent='会同时用麦克风、前置相机和手机运动状态确认吹气。';calAction.hidden=false;calAction.disabled=false;calAction.textContent='开启吹气识别';calMeter.style.width='0%';micState.textContent='吹气识别未开启';breathText.textContent='完成校准后开始';faceState.textContent='准备前置相机';faceVideo.classList.remove('show','found');setChecks(false,false,true)
  }
  function eventMouthSummary(frames){
    const ms=frames.filter(x=>x.face).map(x=>x.mouth);if(!ms.length)return null;const byKey=[...ms].sort((a,b)=>b.key-a.key).slice(0,Math.max(2,Math.ceil(ms.length*.55)));return{pucker:median(byKey.map(x=>x.pucker)),funnel:median(byKey.map(x=>x.funnel)),puff:median(byKey.map(x=>x.puff)),jaw:median(byKey.map(x=>x.jaw)),key:Math.max(...ms.map(x=>x.key))}
  }
  function finishLearnEvent(now){
    const dur=learnLast-learnStart,audioS=audioSummary(learnFrames),mouthS=eventMouthSummary(learnFrames),moved=learnMoved;learnActive=false;learnFrames=[];learnMoved=false;
    if(dur<90||dur>1900||!audioS)return;
    if(moved){calHint.textContent='刚才手机在动，没有采用。放稳后再吹。';return}
    if(!mouthS){calHint.textContent='听到了声音，但没有看到脸。正对前置镜头再吹。';return}
    const delta=mouthS.key-idleMouth;if(delta<.025&&mouthS.key<.11){calHint.textContent='听到了，但嘴型变化不明显。嘴唇稍微收拢后再吹。';return}
    learnEvents.push({audio:audioS,mouth:mouthS});navigator.vibrate?.(10);calValue.textContent=`${learnEvents.length} / 3`;calHint.textContent=learnEvents.length<3?'收到。停半秒，再吹一次。':'正在完成';
    if(learnEvents.length>=3){
      const audioP={rms:median(learnEvents.map(x=>x.audio.rms)),low:median(learnEvents.map(x=>x.audio.low)),mid:median(learnEvents.map(x=>x.audio.mid)),high:median(learnEvents.map(x=>x.audio.high)),flat:median(learnEvents.map(x=>x.audio.flat))};
      const mouthP={pucker:median(learnEvents.map(x=>x.mouth.pucker)),funnel:median(learnEvents.map(x=>x.mouth.funnel)),puff:median(learnEvents.map(x=>x.mouth.puff)),jaw:median(learnEvents.map(x=>x.mouth.jaw)),key:median(learnEvents.map(x=>x.mouth.key))};
      const mouthThreshold=Math.max(idleMouth+.018,idleMouth+(mouthP.key-idleMouth)*.32);learned={audio:audioP,mouth:mouthP,mouthThreshold};learning=false;cancelAnimationFrame(learnRaf);learnRaf=0;calibration.hidden=true;faceVideo.classList.remove('show');micState.textContent=motionGranted||!motionAvailable?'声音 + 嘴型 + 静止':'声音 + 嘴型';breathText.textContent='短吹下一页 · 长吹上一页';listening=true;cooldownUntil=now+550;requestWake();startMonitor()
    }
  }
  function startLearning(){
    learnEvents=[];learnActive=false;learnFrames=[];learning=true;calStep.textContent='连续吹三次';calValue.textContent='0 / 3';calHint.textContent='面对前置镜头，嘴唇稍微收拢，靠近手机吹一小口气。';calAction.hidden=true;const gate=Math.max(.0025,ambient*1.7);let last=0;
    const loop=now=>{learnRaf=requestAnimationFrame(loop);if(!learning||now-last<28)return;last=now;const af=audioFeature(),face=now<faceSeenUntil,moving=isMoving(),active=af.rms>=gate;setChecks(active,face&&currentMouth.key>idleMouth+.018,!moving);const level=clamp((af.rms-gate*.65)/(Math.max(gate,ambient)*2.1),0,1);calMeter.style.width=`${Math.round(level*100)}%`;
      if(active){if(!learnActive){learnActive=true;learnStart=now;learnFrames=[];learnMoved=false}learnLast=now;if(moving)learnMoved=true;learnFrames.push({audio:af,mouth:{...currentMouth},face})}
      else if(learnActive&&now-learnLast>150)finishLearnEvent(now)
    };learnRaf=requestAnimationFrame(loop)
  }
  async function beginCalibration(){
    if(busy)return;busy=true;calAction.disabled=true;calStep.textContent='正在准备';calHint.textContent='允许麦克风和前置相机后，把脸放在手机前方。';faceVideo.classList.add('show');
    try{
      const motionPromise=requestMotionAccess();const mediaPromise=setupMedia();const facePromise=loadFaceLandmarker();await mediaPromise;await motionPromise;await facePromise;startFaceLoop();calStep.textContent='找到你的脸';calValue.textContent='—';calHint.textContent='正对手机，不用贴得很近。';
      if(!await waitForFace()){throw new Error('noface')}
      calStep.textContent='先听一下环境';calValue.textContent='1.2';calHint.textContent='先别吹，也不要碰手机';await collectAmbient();startLearning()
    }catch(e){console.error(e);cleanupMedia();calStep.textContent=e?.message==='noface'?'没有看到脸':'吹气识别没有准备好';calValue.textContent='—';calHint.textContent=e?.message==='noface'?'把脸放在前置镜头范围内，再试一次。':e?.name==='NotAllowedError'?'需要麦克风和前置相机权限；你仍然可以手动或滑动翻页。':'嘴型识别组件没有加载成功；你仍然可以手动或滑动翻页。';calAction.hidden=false;calAction.disabled=false;calAction.textContent='再试一次';setChecks(false,false,true)
    }finally{busy=false}
  }
  async function relearnCalibration(){
    if(busy)return;if(!stream||!analyser||!faceLandmarker){showCalibrationStart();return}
    listening=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;learned=null;calibration.hidden=false;faceVideo.classList.add('show');calStep.textContent='重新学习';calValue.textContent='1.0';calHint.textContent='先别吹，也不要碰手机';await collectAmbient(1000);startLearning()
  }

  function startMonitor(){
    cancelAnimationFrame(monitorRaf);lastAudioFrame=0;blowing=false;longDone=false;lastConfirmed=0;
    const loop=now=>{monitorRaf=requestAnimationFrame(loop);if(!listening||!analyser||now-lastAudioFrame<28)return;lastAudioFrame=now;const af=audioFeature(),ae=audioEvidence(af),me=mouthEvidence(),moving=isMoving(),freshFace=now<faceSeenUntil;
      setChecks(ae.ok,me.ok,!moving);breathLevel.style.width=`${Math.round((ae.score*.55+me.score*.45)*100)}%`;
      if(moving&&ae.ok){if(blowing){blowing=false;longDone=false}breathText.textContent='手机在动 · 已忽略';cooldownUntil=now+300;return}
      if(ae.ok&&!freshFace){breathText.textContent='听到声音 · 没看到脸';return}
      if(ae.ok&&!me.ok){breathText.textContent='听到声音 · 不是吹气嘴型';return}
      const confirmed=now>=cooldownUntil&&ae.ok&&me.ok&&!moving;
      if(confirmed){lastConfirmed=now;if(!blowing){blowing=true;blowStart=now;longDone=false;breathText.textContent='识别到吹气'}const dur=now-blowStart;if(dur>=820&&!longDone){longDone=true;prevPage();breathText.textContent='长吹 · 上一页'}}
      else if(blowing&&now-lastConfirmed>190){const dur=lastConfirmed-blowStart;blowing=false;cooldownUntil=now+540;if(!longDone&&dur>=110&&dur<760){nextPage();breathText.textContent='短吹 · 下一页'}else if(!longDone&&dur<110)breathText.textContent='吹气太短 · 没有翻页';setTimeout(defaultText,700)}
      else if(!blowing&&now>=cooldownUntil&&af.rms<Math.max(.009,ambient*2)){ambient=ambient*.995+af.rms*.005}
    };monitorRaf=requestAnimationFrame(loop)
  }

  choose.onclick=()=>filesInput.click();filesInput.onchange=()=>openFiles(filesInput.files);calAction.onclick=beginCalibration;relearn.onclick=relearnCalibration;
  prevBtn.onclick=prevPage;nextBtn.onclick=nextPage;exit.onclick=closeReader;
  document.addEventListener('keydown',e=>{if(reader.hidden)return;if(e.key==='ArrowRight'||e.key==='PageDown')nextPage();if(e.key==='ArrowLeft'||e.key==='PageUp')prevPage()});
  stage.addEventListener('pointerdown',e=>{if(!calibration.hidden)return;pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId}});
  stage.addEventListener('pointerup',e=>{if(!pointerStart||pointerStart.id!==e.pointerId)return;const dx=e.clientX-pointerStart.x,dy=e.clientY-pointerStart.y;pointerStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){dx<0?nextPage():prevPage()}});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!reader.hidden&&kind==='pdf')showPage(current)},120)});
  document.addEventListener('visibilitychange',async()=>{if(reader.hidden)return;if(document.hidden){listening=false;cancelAnimationFrame(monitorRaf);monitorRaf=0;cancelAnimationFrame(faceLoop);faceLoop=0;await releaseWake()}else{await requestWake();if(stream&&faceLandmarker)startFaceLoop();if(learned&&analyser){listening=true;cooldownUntil=performance.now()+700;startMonitor()}}});
  window.addEventListener('pagehide',()=>{cleanupMedia();releaseWake();revokeImages();try{faceLandmarker?.close?.()}catch{}faceLandmarker=null});
})();