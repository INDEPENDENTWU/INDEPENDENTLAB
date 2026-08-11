(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error'),mirror=$('#mirror'),exit=$('#exit'),flip=$('#flip');
  const statusTitle=$('#statusTitle'),statusSub=$('#statusSub'),viewport=$('#viewport'),video=$('#video'),past=$('#pastFrame');
  const warm=$('#warm'),warmValue=$('#warmValue'),stamp=$('#timeStamp'),liveControls=$('#liveControls');
  const delayBtn=$('#delay'),delayValue=$('#delayValue'),replayBtn=$('#freeze'),directionBtn=$('#direction'),directionValue=$('#directionValue');
  const review=$('#review'),reviewAgo=$('#reviewAgo'),loopToggle=$('#loopToggle'),zoomBtn=$('#zoom'),resume=$('#resume'),scrub=$('#scrub');
  const saveFrame=$('#saveFrame'),saveFrameLabel=$('#saveFrameLabel'),canvas=$('#bufferCanvas');
  const ctx=canvas.getContext('2d');

  const DELAYS=[3000,5000,8000];
  const MAX_HISTORY=14000;
  const CAPTURE_GAP=270;
  const MAX_SIDE=840;
  const LOOP_HALF=1750;
  const ZOOMS=[1,1.8,2.5];

  let delayMs=Number(localStorage.getItem('delay-mirror-ms'))||5000;
  if(!DELAYS.includes(delayMs))delayMs=5000;
  let facing=localStorage.getItem('delay-mirror-facing')||'user';
  if(!['user','environment'].includes(facing))facing='user';
  let mirrorFront=localStorage.getItem('delay-mirror-orientation')!=='actual';

  let stream=null,active=false,reviewing=false,captureBusy=false,captureTimer=0;
  let frames=[],displayUrl='',displayIndex=-1,startedAt=0,wake=null;
  let loopTimer=0,loopIndices=[],loopPos=0,loopPlaying=false,reviewAnchor=0;
  let zoomIndex=0;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function revokeFrame(f){if(!f?.url)return;try{URL.revokeObjectURL(f.url)}catch{}}
  function stopReviewLoop(){clearInterval(loopTimer);loopTimer=0;loopPlaying=false;if(loopToggle){loopToggle.textContent='播放';loopToggle.classList.remove('active')}}
  function resetZoom(){zoomIndex=0;zoomBtn.textContent='1×';past.style.transform='scale(1)';past.style.transformOrigin='50% 50%'}
  function clearFrames(){past.removeAttribute('src');displayUrl='';displayIndex=-1;frames.forEach(revokeFrame);frames=[];viewport.classList.remove('ready');replayBtn.disabled=true;stamp.hidden=true;warm.hidden=false;startedAt=performance.now();warmValue.textContent=(delayMs/1000).toFixed(1)}
  function stopStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null}

  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function updateLabels(){delayValue.textContent=`${delayMs/1000} 秒`;statusSub.textContent=`延迟 ${delayMs/1000} 秒`}
  function updateOrientation(){const front=facing==='user';viewport.classList.toggle('front-mirrored',front&&mirrorFront);directionBtn.hidden=!front;directionValue.textContent=mirrorFront?'镜像':'实际'}

  function setDisplayed(index,now=performance.now()){
    const f=frames[index];if(!f)return;
    displayIndex=index;
    if(displayUrl!==f.url){displayUrl=f.url;past.src=f.url}
    viewport.classList.add('ready');warm.hidden=true;replayBtn.disabled=false;
    const ago=Math.max(0,(now-f.t)/1000);stamp.textContent=`${ago.toFixed(1)} 秒前`;stamp.hidden=false;
    if(!reviewing)statusTitle.textContent=`显示 ${delayMs/1000} 秒前`;
  }

  function updateDelayed(now=performance.now()){
    if(reviewing||!frames.length)return;
    const target=now-delayMs;let found=-1;
    for(let i=frames.length-1;i>=0;i--){if(frames[i].t<=target){found=i;break}}
    if(found>=0){setDisplayed(found,now);return}
    viewport.classList.remove('ready');replayBtn.disabled=true;stamp.hidden=true;warm.hidden=false;
    const oldest=frames[0]?.t??startedAt,collected=Math.max(0,now-oldest);
    warmValue.textContent=(Math.max(0,delayMs-collected)/1000).toFixed(1);statusTitle.textContent='正在准备';
  }

  function trimFrames(now){
    const cutoff=now-MAX_HISTORY;
    while(frames.length&&frames[0].t<cutoff){
      const old=frames.shift();
      if(old.url!==displayUrl)revokeFrame(old);
      else{displayUrl='';past.removeAttribute('src');revokeFrame(old)}
      if(displayIndex>=0)displayIndex--;
    }
  }

  function canvasSize(){
    const vw=video.videoWidth||1280,vh=video.videoHeight||720,scale=Math.min(1,MAX_SIDE/Math.max(vw,vh));
    return{w:Math.max(2,Math.round(vw*scale)),h:Math.max(2,Math.round(vh*scale)),vw,vh};
  }

  async function captureOne(){
    if(!active||reviewing||document.hidden||captureBusy||!stream||!video.videoWidth)return;
    captureBusy=true;
    try{
      const s=canvasSize();if(canvas.width!==s.w||canvas.height!==s.h){canvas.width=s.w;canvas.height=s.h}
      ctx.save();ctx.clearRect(0,0,s.w,s.h);
      if(facing==='user'&&mirrorFront){ctx.translate(s.w,0);ctx.scale(-1,1)}
      ctx.drawImage(video,0,0,s.vw,s.vh,0,0,s.w,s.h);ctx.restore();
      const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.78));
      if(!blob||!active||reviewing)return;
      const now=performance.now(),url=URL.createObjectURL(blob);frames.push({t:now,url,blob});trimFrames(now);updateDelayed(now);
    }catch{}finally{captureBusy=false}
  }

  function loopCapture(){clearTimeout(captureTimer);if(!active||reviewing)return;captureOne().finally(()=>{captureTimer=setTimeout(loopCapture,CAPTURE_GAP)})}

  async function acquireCamera(nextFacing){
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:nextFacing},width:{ideal:1280},height:{ideal:960}},audio:false});
    video.srcObject=s;await video.play();
    const actual=s.getVideoTracks()[0]?.getSettings?.().facingMode;
    return{stream:s,facing:actual==='user'||actual==='environment'?actual:nextFacing};
  }

  async function openCamera(){
    setError('');if(!navigator.mediaDevices?.getUserMedia){setError('当前浏览器没有提供相机访问能力。');return}
    start.disabled=true;
    try{
      stopStream();const result=await acquireCamera(facing);stream=result.stream;facing=result.facing;
      localStorage.setItem('delay-mirror-facing',facing);updateOrientation();
      home.hidden=true;mirror.hidden=false;active=true;reviewing=false;liveControls.hidden=false;review.hidden=true;
      stopReviewLoop();resetZoom();clearFrames();updateLabels();requestWake();loopCapture();
    }catch(e){stopStream();setError(e?.name==='NotAllowedError'?'没有获得相机权限。请允许相机后再试。':'相机没有打开。可以检查浏览器相机权限后再试。')}
    finally{start.disabled=false}
  }

  async function closeMirror(){
    active=false;reviewing=false;clearTimeout(captureTimer);captureTimer=0;stopReviewLoop();stopStream();clearFrames();resetZoom();await releaseWake();
    mirror.hidden=true;home.hidden=false;review.hidden=true;liveControls.hidden=false;statusTitle.textContent='正在准备';window.scrollTo({top:0,behavior:'instant'});
  }

  async function flipCamera(){
    if(!active||reviewing)return;flip.disabled=true;
    const previous=facing,next=previous==='user'?'environment':'user';
    stopStream();clearFrames();
    try{
      const result=await acquireCamera(next);stream=result.stream;facing=result.facing;localStorage.setItem('delay-mirror-facing',facing);updateOrientation();loopCapture();
    }catch{
      try{const result=await acquireCamera(previous);stream=result.stream;facing=result.facing;updateOrientation();loopCapture()}catch{}
    }finally{flip.disabled=false}
  }

  function cycleDelay(){
    if(reviewing)return;const i=DELAYS.indexOf(delayMs);delayMs=DELAYS[(i+1)%DELAYS.length];localStorage.setItem('delay-mirror-ms',String(delayMs));updateLabels();updateDelayed();
  }

  function toggleOrientation(){
    if(reviewing||facing!=='user')return;mirrorFront=!mirrorFront;localStorage.setItem('delay-mirror-orientation',mirrorFront?'mirror':'actual');updateOrientation();clearFrames();
  }

  function showReviewFrame(index){
    const i=Math.max(0,Math.min(frames.length-1,Number(index)||0)),f=frames[i];if(!f)return;
    displayIndex=i;if(displayUrl!==f.url){displayUrl=f.url;past.src=f.url}
    viewport.classList.add('ready');warm.hidden=true;stamp.hidden=true;scrub.value=String(i);
    reviewAgo.textContent=`${Math.max(0,(reviewAnchor-f.t)/1000).toFixed(1)} 秒前`;
  }

  function buildLoopWindow(centerIndex){
    const center=frames[centerIndex]?.t;if(!Number.isFinite(center))return[];
    let ids=[];for(let i=0;i<frames.length;i++){if(Math.abs(frames[i].t-center)<=LOOP_HALF)ids.push(i)}
    if(ids.length<5){const a=Math.max(0,centerIndex-6),b=Math.min(frames.length-1,centerIndex+6);ids=[];for(let i=a;i<=b;i++)ids.push(i)}
    return ids;
  }

  function startReviewLoop(){
    stopReviewLoop();if(!loopIndices.length)return;
    loopPlaying=true;loopToggle.textContent='暂停';loopToggle.classList.add('active');
    loopTimer=setInterval(()=>{if(!reviewing||!loopIndices.length)return;showReviewFrame(loopIndices[loopPos]);loopPos=(loopPos+1)%loopIndices.length},280);
  }

  function toggleReviewLoop(){
    if(!reviewing)return;
    if(loopPlaying)stopReviewLoop();else startReviewLoop();
  }

  function openReplay(){
    if(displayIndex<0||!frames[displayIndex])return;
    reviewing=true;reviewAnchor=performance.now();clearTimeout(captureTimer);captureTimer=0;liveControls.hidden=true;review.hidden=false;statusTitle.textContent='正在回看';
    scrub.min='0';scrub.max=String(Math.max(0,frames.length-1));scrub.value=String(displayIndex);
    loopIndices=buildLoopWindow(displayIndex);loopPos=0;resetZoom();showReviewFrame(displayIndex);startReviewLoop();
  }

  function resumeLive(){
    if(!active)return;reviewing=false;stopReviewLoop();resetZoom();review.hidden=true;liveControls.hidden=false;clearFrames();statusTitle.textContent='正在准备';requestWake();loopCapture();
  }

  function cycleZoom(){
    if(!reviewing)return;zoomIndex=(zoomIndex+1)%ZOOMS.length;const z=ZOOMS[zoomIndex];zoomBtn.textContent=`${z}×`;zoomBtn.classList.toggle('active',z>1);past.style.transform=`scale(${z})`;if(z===1)past.style.transformOrigin='50% 50%';
  }

  async function deliver(blob){
    const name=`延时镜-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.jpg`,file=new File([blob],name,{type:'image/jpeg'});
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}
    const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1600);
  }

  async function saveSelected(){
    const f=frames[displayIndex];if(!f)return;saveFrame.disabled=true;
    try{await deliver(f.blob);saveFrame.classList.add('done');saveFrameLabel.textContent='已保存';setTimeout(()=>{saveFrame.classList.remove('done');saveFrameLabel.textContent='保存这一帧'},1300)}catch{}finally{saveFrame.disabled=false}
  }

  start.onclick=openCamera;exit.onclick=closeMirror;flip.onclick=flipCamera;delayBtn.onclick=cycleDelay;replayBtn.onclick=openReplay;directionBtn.onclick=toggleOrientation;
  loopToggle.onclick=toggleReviewLoop;zoomBtn.onclick=cycleZoom;resume.onclick=resumeLive;
  scrub.oninput=()=>{stopReviewLoop();showReviewFrame(scrub.value)};saveFrame.onclick=saveSelected;
  viewport.addEventListener('pointerdown',e=>{if(!reviewing||ZOOMS[zoomIndex]===1)return;const r=viewport.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*100,y=(e.clientY-r.top)/r.height*100;past.style.transformOrigin=`${Math.max(0,Math.min(100,x))}% ${Math.max(0,Math.min(100,y))}%`});

  document.addEventListener('visibilitychange',()=>{
    if(!active)return;
    if(document.hidden){releaseWake();clearTimeout(captureTimer);captureTimer=0;stopReviewLoop()}
    else{requestWake();if(reviewing){loopToggle.textContent='播放'}else{clearFrames();loopCapture()}}
  });
  window.addEventListener('pagehide',()=>{active=false;reviewing=false;clearTimeout(captureTimer);stopReviewLoop();stopStream();clearFrames();releaseWake()});

  updateLabels();updateOrientation();
})();