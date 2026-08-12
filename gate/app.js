(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error'),counter=$('#counter'),exit=$('#exit'),pauseBtn=$('#pause');
  const statusTitle=$('#statusTitle'),statusSub=$('#statusSub'),viewport=$('#viewport'),video=$('#video'),gate=$('#gate'),gateLine=$('#gateLine');
  const calibrate=$('#calibrate'),calValue=$('#calValue'),sensorA=gate.querySelector('.sensor.a'),sensorB=gate.querySelector('.sensor.b');
  const countAEl=$('#countA'),countBEl=$('#countB'),arrowA=$('#arrowA'),arrowB=$('#arrowB'),flash=$('#flash');
  const orientationBtn=$('#orientation'),orientationValue=$('#orientationValue'),resetBtn=$('#reset'),canvas=$('#analysis'),ctx=canvas.getContext('2d',{willReadFrequently:true});

  let orientation=localStorage.getItem('gate-orientation')||'vertical';if(!['vertical','horizontal'].includes(orientation))orientation='vertical';
  let gatePos=Number(localStorage.getItem('gate-position'));if(!Number.isFinite(gatePos)||gatePos<25||gatePos>75)gatePos=50;
  let countA=0,countB=0;try{const saved=JSON.parse(sessionStorage.getItem('gate-counts')||'{}');countA=Number(saved.a)||0;countB=Number(saved.b)||0}catch{}

  let stream=null,active=false,paused=false,wake=null,loopTimer=0,bg=null,gray=null,noise=.004;
  let calibrating=false,calStarted=0,phase='idle',phaseAt=0,clearSince=0,drag=null,flashTimer=0;
  const CAL_MS=1900,FRAME_MS=95;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function persistCounts(){try{sessionStorage.setItem('gate-counts',JSON.stringify({a:countA,b:countB}))}catch{}}
  function renderCounts(){countAEl.textContent=String(countA);countBEl.textContent=String(countB);persistCounts()}
  function applyOrientation(){
    gate.classList.toggle('vertical',orientation==='vertical');gate.classList.toggle('horizontal',orientation==='horizontal');gate.style.setProperty('--gate',`${gatePos}%`);
    orientationValue.textContent=orientation==='vertical'?'竖线':'横线';arrowA.textContent=orientation==='vertical'?'→':'↓';arrowB.textContent=orientation==='vertical'?'←':'↑';
  }
  function setSensors(a,b){sensorA.classList.toggle('active',a);sensorB.classList.toggle('active',b)}
  function resetPhase(){phase='idle';phaseAt=0;clearSince=0;setSensors(false,false)}

  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
  function stopStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null}

  function ensureCanvas(){
    const r=viewport.getBoundingClientRect(),aspect=Math.max(.45,Math.min(2.4,r.width/Math.max(1,r.height)));let w,h;
    if(aspect>=1){w=176;h=Math.max(74,Math.round(w/aspect))}else{h=176;w=Math.max(74,Math.round(h*aspect))}
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;bg=null;gray=null;startCalibration()}
  }
  function drawVisibleFrame(){
    ensureCanvas();const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return false;
    const target=canvas.width/canvas.height,source=vw/vh;let sx=0,sy=0,sw=vw,sh=vh;
    if(source>target){sw=vh*target;sx=(vw-sw)/2}else{sh=vw/target;sy=(vh-sh)/2}
    ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);return true;
  }
  function readGray(){
    const d=ctx.getImageData(0,0,canvas.width,canvas.height).data,n=canvas.width*canvas.height;if(!gray||gray.length!==n)gray=new Uint8Array(n);
    for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;return gray;
  }
  function bandDiff(which){
    if(!bg||!gray)return 0;const w=canvas.width,h=canvas.height,p=gatePos/100;let x0=0,x1=w,y0=0,y1=h;
    if(orientation==='vertical'){
      const c=p*w,offset=which==='a'?-0.095:0.095,center=c+offset*w;x0=Math.max(0,Math.floor(center-w*.045));x1=Math.min(w,Math.ceil(center+w*.045));
    }else{
      const c=p*h,offset=which==='a'?-0.095:0.095,center=c+offset*h;y0=Math.max(0,Math.floor(center-h*.045));y1=Math.min(h,Math.ceil(center+h*.045));
    }
    let sum=0,n=0;for(let y=y0;y<y1;y+=2){let i=y*w+x0;for(let x=x0;x<x1;x+=2,i+=2){sum+=Math.abs(gray[i]-bg[i]);n++}}return sum/Math.max(1,n)/255;
  }
  function adaptBackground(alpha=.012){if(!bg||!gray)return;for(let i=0;i<bg.length;i++)bg[i]=bg[i]*(1-alpha)+gray[i]*alpha}

  function startCalibration(){
    calibrating=true;calStarted=performance.now();bg=null;noise=.004;resetPhase();calibrate.hidden=false;calValue.textContent='2.0';statusTitle.textContent='正在记住画面';statusSub.textContent='标线附近先空两秒';
  }
  function calibrationFrame(now){
    if(!bg||bg.length!==gray.length){bg=new Float32Array(gray.length);for(let i=0;i<gray.length;i++)bg[i]=gray[i]}
    else{
      let d=0;for(let i=0;i<gray.length;i+=5)d+=Math.abs(gray[i]-bg[i]);d=d/Math.ceil(gray.length/5)/255;noise=noise*.88+d*.12;adaptBackground(.12)
    }
    const remain=Math.max(0,(CAL_MS-(now-calStarted))/1000);calValue.textContent=remain.toFixed(1);
    if(now-calStarted>=CAL_MS){calibrating=false;calibrate.hidden=true;statusTitle.textContent='正在计数';statusSub.textContent='拖动白线可以调整位置';resetPhase()}
  }

  function register(direction){
    if(direction==='a'){countA++}else countB++;renderCounts();flash.textContent=direction==='a'?`${arrowA.textContent} +1`:`${arrowB.textContent} +1`;flash.hidden=false;clearTimeout(flashTimer);flashTimer=setTimeout(()=>flash.hidden=true,540);statusTitle.textContent=direction==='a'?`${arrowA.textContent} 刚经过 1 个`:`${arrowB.textContent} 刚经过 1 个`;setTimeout(()=>{if(active&&!paused&&!calibrating)statusTitle.textContent='正在计数'},850)
  }
  function detect(now){
    const da=bandDiff('a'),db=bandDiff('b');noise=noise*.995+Math.min(da,db)*.005;const high=Math.max(.035,Math.min(.13,noise*4.6+.012)),low=high*.46;
    const a=da>high,b=db>high;setSensors(a,b);
    if(phase==='cooldown'){
      if(da<low&&db<low){if(!clearSince)clearSince=now;if(now-clearSince>420){phase='idle';clearSince=0;adaptBackground(.035)}}else clearSince=0;return;
    }
    if(phase==='idle'){
      if(a&&!b){phase='a';phaseAt=now}else if(b&&!a){phase='b';phaseAt=now}else if(!a&&!b)adaptBackground(.008);return;
    }
    if(phase==='a'){
      if(b){register('a');phase='cooldown';clearSince=0;return}if(now-phaseAt>4200){phase='idle';return}return;
    }
    if(phase==='b'){
      if(a){register('b');phase='cooldown';clearSince=0;return}if(now-phaseAt>4200){phase='idle';return}
    }
  }

  function frameLoop(){
    clearTimeout(loopTimer);if(!active)return;
    if(!paused&&video.readyState>=2&&drawVisibleFrame()){readGray();const now=performance.now();if(calibrating)calibrationFrame(now);else detect(now)}
    loopTimer=setTimeout(frameLoop,FRAME_MS);
  }

  async function open(){
    setError('');if(!navigator.mediaDevices?.getUserMedia){setError('当前浏览器没有提供相机访问能力。');return}start.disabled=true;
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});video.srcObject=stream;await video.play();home.hidden=true;counter.hidden=false;active=true;paused=false;pauseBtn.textContent='暂停';applyOrientation();renderCounts();requestWake();startCalibration();frameLoop();
    }catch(e){stopStream();setError(e?.name==='NotAllowedError'?'没有获得相机权限。请允许相机后再试。':'相机没有打开。可以检查浏览器相机权限后再试。')}
    finally{start.disabled=false}
  }
  async function close(){active=false;paused=false;clearTimeout(loopTimer);loopTimer=0;clearTimeout(flashTimer);stopStream();await releaseWake();counter.hidden=true;home.hidden=false;bg=null;gray=null;resetPhase();window.scrollTo({top:0,behavior:'instant'})}
  function togglePause(){
    if(!active)return;paused=!paused;pauseBtn.textContent=paused?'继续':'暂停';statusTitle.textContent=paused?'已暂停':'正在准备';statusSub.textContent=paused?'计数保留不变':'标线附近先空两秒';if(!paused)startCalibration();else{calibrate.hidden=true;resetPhase()}
  }
  function toggleOrientation(){orientation=orientation==='vertical'?'horizontal':'vertical';localStorage.setItem('gate-orientation',orientation);gatePos=50;localStorage.setItem('gate-position',String(gatePos));applyOrientation();if(active&&!paused)startCalibration()}
  function resetCounts(){countA=0;countB=0;renderCounts();flash.textContent='已清零';flash.hidden=false;clearTimeout(flashTimer);flashTimer=setTimeout(()=>flash.hidden=true,480)}

  gateLine.addEventListener('pointerdown',e=>{if(!active)return;e.preventDefault();drag=e.pointerId;try{gateLine.setPointerCapture(e.pointerId)}catch{}calibrating=true;calibrate.hidden=true;resetPhase()});
  gateLine.addEventListener('pointermove',e=>{if(drag!==e.pointerId)return;e.preventDefault();const r=viewport.getBoundingClientRect(),value=orientation==='vertical'?(e.clientX-r.left)/r.width*100:(e.clientY-r.top)/r.height*100;gatePos=Math.max(25,Math.min(75,value));gate.style.setProperty('--gate',`${gatePos}%`)});
  function endDrag(e){if(drag!==e.pointerId)return;drag=null;localStorage.setItem('gate-position',String(gatePos));if(!paused)startCalibration()}
  gateLine.addEventListener('pointerup',endDrag);gateLine.addEventListener('pointercancel',endDrag);

  start.onclick=open;exit.onclick=close;pauseBtn.onclick=togglePause;orientationBtn.onclick=toggleOrientation;resetBtn.onclick=resetCounts;
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){paused=true;pauseBtn.textContent='继续';statusTitle.textContent='页面已暂停';clearTimeout(loopTimer);await releaseWake()}else{await requestWake();paused=false;pauseBtn.textContent='暂停';startCalibration();frameLoop()}});
  window.addEventListener('resize',()=>{if(active&&!paused)startCalibration()});
  window.addEventListener('pagehide',()=>{active=false;clearTimeout(loopTimer);stopStream();releaseWake()});
  applyOrientation();renderCounts();
})();