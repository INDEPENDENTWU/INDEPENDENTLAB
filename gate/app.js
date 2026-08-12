(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),startLabel=$('#startLabel'),error=$('#error'),modeChoice=$('#modeChoice');
  const counter=$('#counter'),exit=$('#exit'),pauseBtn=$('#pause'),statusTitle=$('#statusTitle'),statusSub=$('#statusSub');
  const viewport=$('#viewport'),video=$('#video'),gate=$('#gate'),gateLine=$('#gateLine'),startHandle=$('#startHandle'),endHandle=$('#endHandle');
  const calibrate=$('#calibrate'),calValue=$('#calValue'),sensorA=gate.querySelector('.sensor.a'),sensorB=gate.querySelector('.sensor.b'),flash=$('#flash');
  const flowStats=$('#flowStats'),countAEl=$('#countA'),countBEl=$('#countB'),arrowA=$('#arrowA'),arrowB=$('#arrowB'),netCount=$('#netCount'),netNote=$('#netNote');
  const itemStats=$('#itemStats'),itemTotalEl=$('#itemTotal'),itemRate=$('#itemRate'),itemInterval=$('#itemInterval'),itemDirection=$('#itemDirection');
  const lapStats=$('#lapStats'),lapCountEl=$('#lapCount'),lastLap=$('#lastLap'),bestLap=$('#bestLap'),avgLap=$('#avgLap'),lapDirection=$('#lapDirection');
  const tools=$('#tools'),orientationBtn=$('#orientation'),orientationValue=$('#orientationValue'),directionBtn=$('#direction'),directionValue=$('#directionValue'),resetBtn=$('#reset'),bottomHint=$('#bottomHint');
  const canvas=$('#analysis'),ctx=canvas.getContext('2d',{willReadFrequently:true});

  const MODES=['flow','item','lap'];
  let mode=localStorage.getItem('gate-mode')||'flow';if(!MODES.includes(mode))mode='flow';
  let orientation=localStorage.getItem('gate-orientation')||'vertical';if(!['vertical','horizontal'].includes(orientation))orientation='vertical';
  let gatePos=Number(localStorage.getItem('gate-position'));if(!Number.isFinite(gatePos)||gatePos<18||gatePos>82)gatePos=50;
  let segStart=Number(localStorage.getItem('gate-segment-start')),segEnd=Number(localStorage.getItem('gate-segment-end'));
  if(!Number.isFinite(segStart)||!Number.isFinite(segEnd)||segStart<4||segEnd>96||segEnd-segStart<20){segStart=18;segEnd=82}
  let directions={flow:'a',item:'a',lap:'a'};try{directions={...directions,...JSON.parse(localStorage.getItem('gate-directions')||'{}')}}catch{}
  if(!['a','b'].includes(directions.flow))directions.flow='a';if(!['a','b','both'].includes(directions.item))directions.item='a';if(!['a','b','both'].includes(directions.lap))directions.lap='a';

  let flowA=0,flowB=0,itemTotal=0,lapCount=0;try{const s=JSON.parse(sessionStorage.getItem('gate-session-v3')||'{}');flowA=Number(s.flowA)||0;flowB=Number(s.flowB)||0;itemTotal=Number(s.itemTotal)||0;lapCount=Number(s.lapCount)||0}catch{}
  let itemTimes=[],lapTimes=[],lapAnchor=null;

  let stream=null,active=false,paused=false,wake=null,loopTimer=0,bg=null,gray=null,noise=.004,noiseRatio=.02;
  let calibrating=false,calStarted=0,phase='idle',phaseAt=0,clearSince=0,bothSince=0,drag=null,flashTimer=0;
  const CAL_MS=1900,FRAME_MS=72;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function persistSession(){try{sessionStorage.setItem('gate-session-v3',JSON.stringify({flowA,flowB,itemTotal,lapCount}))}catch{}}
  function persistGeometry(){localStorage.setItem('gate-position',String(gatePos));localStorage.setItem('gate-segment-start',String(segStart));localStorage.setItem('gate-segment-end',String(segEnd))}
  function persistDirections(){localStorage.setItem('gate-directions',JSON.stringify(directions))}
  function arrows(){return orientation==='vertical'?{a:'→',b:'←'}:{a:'↓',b:'↑'}}
  function formatSec(ms){if(!Number.isFinite(ms))return'—';const s=ms/1000;return s<10?s.toFixed(2):s<60?s.toFixed(1):`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`}

  function applyGeometry(){gate.classList.toggle('vertical',orientation==='vertical');gate.classList.toggle('horizontal',orientation==='horizontal');gate.style.setProperty('--gate',`${gatePos}%`);gate.style.setProperty('--seg-start',`${segStart}%`);gate.style.setProperty('--seg-end',`${segEnd}%`)}
  function setSensors(a,b){sensorA.classList.toggle('active',a);sensorB.classList.toggle('active',b)}
  function resetPhase(){phase='idle';phaseAt=0;clearSince=0;bothSince=0;setSensors(false,false)}
  function resetTiming(){itemTimes=[];lapAnchor=null}

  function renderModeChoice(){
    modeChoice.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    const names={flow:'进出',item:'计件',lap:'圈数'};startLabel.textContent=`打开${names[mode]}计数`;
  }
  function renderData(){
    const ar=arrows(),dir=directions[mode];arrowA.textContent=ar.a;arrowB.textContent=ar.b;
    flowStats.hidden=mode!=='flow';itemStats.hidden=mode!=='item';lapStats.hidden=mode!=='lap';
    countAEl.textContent=String(flowA);countBEl.textContent=String(flowB);
    const enterA=directions.flow==='a',net=enterA?flowA-flowB:flowB-flowA;netCount.textContent=net>0?`+${net}`:String(net);netNote.textContent=`${enterA?ar.a:ar.b} 进入 · ${enterA?ar.b:ar.a} 离开`;
    itemTotalEl.textContent=String(itemTotal);itemDirection.textContent=dir==='both'?'两个方向都计':`只计 ${dir==='a'?ar.a:ar.b}`;
    const now=Date.now(),recent=itemTimes.filter(t=>now-t<=60000);if(recent.length>=2){const span=Math.max(1,recent.at(-1)-recent[0]);itemRate.textContent=((recent.length-1)/span*60000).toFixed(1)}else itemRate.textContent='—';
    if(itemTimes.length>=2){const ds=[];for(let i=Math.max(1,itemTimes.length-8);i<itemTimes.length;i++)ds.push((itemTimes[i]-itemTimes[i-1])/1000);itemInterval.textContent=(ds.reduce((a,b)=>a+b,0)/ds.length).toFixed(ds.some(x=>x<10)?2:1)}else itemInterval.textContent='—';
    lapCountEl.textContent=String(lapCount);lapDirection.textContent=dir==='both'?'每次过线计时':`经过 ${dir==='a'?ar.a:ar.b} 计一圈`;lastLap.textContent=lapTimes.length?formatSec(lapTimes.at(-1)):'—';bestLap.textContent=lapTimes.length?formatSec(Math.min(...lapTimes)):'—';avgLap.textContent=lapTimes.length?`平均 ${formatSec(lapTimes.reduce((a,b)=>a+b,0)/lapTimes.length)}`:'平均 —';
    orientationValue.textContent=orientation==='vertical'?'竖线':'横线';
    if(mode==='flow')directionValue.textContent=`进门 ${directions.flow==='a'?ar.a:ar.b}`;else if(mode==='item')directionValue.textContent=directions.item==='both'?'双向':directions.item==='a'?ar.a:ar.b;else directionValue.textContent=directions.lap==='both'?'双向':directions.lap==='a'?ar.a:ar.b;
    bottomHint.textContent=mode==='lap'?'拖白线到每圈必经的位置；拖两端缩短有效线段，第一次过线只开始计时。':'拖白线移动位置，拖两端缩短线段，只保留真正会穿过的通道。';
    persistSession()
  }
  function showFlash(text){flash.textContent=text;flash.hidden=false;clearTimeout(flashTimer);flashTimer=setTimeout(()=>flash.hidden=true,520)}

  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
  function stopStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null}

  function ensureCanvas(){
    const r=viewport.getBoundingClientRect(),aspect=Math.max(.45,Math.min(2.4,r.width/Math.max(1,r.height)));let w,h;
    if(aspect>=1){w=208;h=Math.max(86,Math.round(w/aspect))}else{h=208;w=Math.max(86,Math.round(h*aspect))}
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;bg=null;gray=null;if(active&&!paused)startCalibration()}
  }
  function drawVisibleFrame(){
    ensureCanvas();const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return false;
    const target=canvas.width/canvas.height,source=vw/vh;let sx=0,sy=0,sw=vw,sh=vh;
    if(source>target){sw=vh*target;sx=(vw-sw)/2}else{sh=vw/target;sy=(vh-sh)/2}
    ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);return true;
  }
  function readGray(){const d=ctx.getImageData(0,0,canvas.width,canvas.height).data,n=canvas.width*canvas.height;if(!gray||gray.length!==n)gray=new Uint8Array(n);for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;return gray}
  function bandStats(which){
    if(!bg||!gray)return{mean:0,ratio:0};const w=canvas.width,h=canvas.height,p=gatePos/100,s0=segStart/100,s1=segEnd/100;let x0=0,x1=w,y0=0,y1=h;
    if(orientation==='vertical'){
      y0=Math.floor(s0*h);y1=Math.ceil(s1*h);const c=p*w,offset=which==='a'?-.075:.075,center=c+offset*w;x0=Math.max(0,Math.floor(center-w*.035));x1=Math.min(w,Math.ceil(center+w*.035));
    }else{
      x0=Math.floor(s0*w);x1=Math.ceil(s1*w);const c=p*h,offset=which==='a'?-.075:.075,center=c+offset*h;y0=Math.max(0,Math.floor(center-h*.035));y1=Math.min(h,Math.ceil(center+h*.035));
    }
    const pixelCut=Math.max(.058,noise*3.1+.018);let sum=0,changed=0,n=0;
    for(let y=y0;y<y1;y+=2){let i=y*w+x0;for(let x=x0;x<x1;x+=2,i+=2){const d=Math.abs(gray[i]-bg[i])/255;sum+=d;if(d>pixelCut)changed++;n++}}
    return{mean:sum/Math.max(1,n),ratio:changed/Math.max(1,n)};
  }
  function adaptBackground(alpha=.01){if(!bg||!gray)return;for(let i=0;i<bg.length;i++)bg[i]=bg[i]*(1-alpha)+gray[i]*alpha}

  function startCalibration(){calibrating=true;calStarted=performance.now();bg=null;noise=.004;noiseRatio=.02;resetPhase();resetTiming();calibrate.hidden=false;calValue.textContent='2.0';statusTitle.textContent='正在记住空画面';statusSub.textContent='有效线段附近先空两秒'}
  function calibrationFrame(now){
    if(!bg||bg.length!==gray.length){bg=new Float32Array(gray.length);for(let i=0;i<gray.length;i++)bg[i]=gray[i]}
    else{const a=bandStats('a'),b=bandStats('b');noise=noise*.86+Math.min(a.mean,b.mean)*.14;noiseRatio=noiseRatio*.86+Math.min(a.ratio,b.ratio)*.14;adaptBackground(.14)}
    const remain=Math.max(0,(CAL_MS-(now-calStarted))/1000);calValue.textContent=remain.toFixed(1);
    if(now-calStarted>=CAL_MS){calibrating=false;calibrate.hidden=true;statusTitle.textContent='正在计数';statusSub.textContent='只统计完整穿过有效线段的事件';resetPhase();if(mode==='lap')statusSub.textContent='第一次过线开始计时'}
  }

  function directionMatches(d){const pref=directions[mode];return pref==='both'||pref===d}
  function register(d){
    const ar=arrows(),now=Date.now();
    if(mode==='flow'){
      if(d==='a')flowA++;else flowB++;showFlash(`${d==='a'?ar.a:ar.b} +1`);statusTitle.textContent=`${d==='a'?ar.a:ar.b} 刚经过 1 个`;
    }else if(mode==='item'){
      if(directionMatches(d)){itemTotal++;itemTimes.push(now);if(itemTimes.length>80)itemTimes.shift();showFlash('+1');statusTitle.textContent='刚计入 1 个'}
    }else if(mode==='lap'&&directionMatches(d)){
      if(lapAnchor==null){lapAnchor=now;showFlash('开始');statusTitle.textContent='计时开始'}else{const t=now-lapAnchor;lapAnchor=now;if(t>=450){lapCount++;lapTimes.push(t);if(lapTimes.length>100)lapTimes.shift();showFlash(`第 ${lapCount} 圈`);statusTitle.textContent=`上一圈 ${formatSec(t)}`}}
    }
    renderData();setTimeout(()=>{if(active&&!paused&&!calibrating)statusTitle.textContent='正在计数'},900)
  }
  function detect(now){
    const sa=bandStats('a'),sb=bandStats('b');noise=noise*.994+Math.min(sa.mean,sb.mean)*.006;noiseRatio=noiseRatio*.994+Math.min(sa.ratio,sb.ratio)*.006;
    const meanHigh=Math.max(.020,Math.min(.11,noise*4.5+.008)),ratioHigh=Math.max(.115,Math.min(.48,noiseRatio*4+.06));
    const meanLow=meanHigh*.46,ratioLow=ratioHigh*.48;
    const a=sa.mean>meanHigh&&sa.ratio>ratioHigh,b=sb.mean>meanHigh&&sb.ratio>ratioHigh;setSensors(a,b);
    if(a&&b){if(!bothSince)bothSince=now;if(now-bothSince>950){resetPhase();adaptBackground(.06)}return}else bothSince=0;
    if(phase==='cooldown'){
      if(sa.mean<meanLow&&sb.mean<meanLow&&sa.ratio<ratioLow&&sb.ratio<ratioLow){if(!clearSince)clearSince=now;if(now-clearSince>360){phase='idle';clearSince=0;adaptBackground(.03)}}else clearSince=0;return;
    }
    if(phase==='idle'){
      if(a&&!b){phase='a';phaseAt=now}else if(b&&!a){phase='b';phaseAt=now}else if(!a&&!b)adaptBackground(.007);return;
    }
    if(phase==='a'){
      if(b&&now-phaseAt>=55){register('a');phase='cooldown';clearSince=0;return}if(now-phaseAt>3400){phase='idle';return}return;
    }
    if(phase==='b'){
      if(a&&now-phaseAt>=55){register('b');phase='cooldown';clearSince=0;return}if(now-phaseAt>3400){phase='idle';return}
    }
  }
  function frameLoop(){clearTimeout(loopTimer);if(!active)return;if(!paused&&video.readyState>=2&&drawVisibleFrame()){readGray();const now=performance.now();if(calibrating)calibrationFrame(now);else detect(now)}loopTimer=setTimeout(frameLoop,FRAME_MS)}

  async function open(){
    setError('');if(!navigator.mediaDevices?.getUserMedia){setError('当前浏览器没有提供相机访问能力。');return}start.disabled=true;
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});video.srcObject=stream;await video.play();home.hidden=true;counter.hidden=false;active=true;paused=false;pauseBtn.textContent='暂停';applyGeometry();renderData();requestWake();startCalibration();frameLoop()}
    catch(e){stopStream();setError(e?.name==='NotAllowedError'?'没有获得相机权限。请允许相机后再试。':'相机没有打开。可以检查浏览器相机权限后再试。')}
    finally{start.disabled=false}
  }
  async function close(){active=false;paused=false;clearTimeout(loopTimer);loopTimer=0;clearTimeout(flashTimer);stopStream();await releaseWake();counter.hidden=true;home.hidden=false;bg=null;gray=null;resetPhase();resetTiming();window.scrollTo({top:0,behavior:'instant'})}
  function togglePause(){if(!active)return;paused=!paused;pauseBtn.textContent=paused?'继续':'暂停';statusTitle.textContent=paused?'已暂停':'正在准备';statusSub.textContent=paused?'已有数字保持不变':'有效线段附近先空两秒';if(!paused)startCalibration();else{calibrate.hidden=true;resetPhase();resetTiming()}}
  function toggleOrientation(){orientation=orientation==='vertical'?'horizontal':'vertical';localStorage.setItem('gate-orientation',orientation);gatePos=50;applyGeometry();persistGeometry();renderData();if(active&&!paused)startCalibration()}
  function cycleDirection(){
    const key=mode,cur=directions[key];if(mode==='flow')directions[key]=cur==='a'?'b':'a';else directions[key]=cur==='a'?'b':cur==='b'?'both':'a';persistDirections();lapAnchor=null;itemTimes=[];renderData();if(active&&!paused)startCalibration()
  }
  function resetData(){
    if(mode==='flow'){flowA=0;flowB=0}else if(mode==='item'){itemTotal=0;itemTimes=[]}else{lapCount=0;lapTimes=[];lapAnchor=null}renderData();showFlash('已清零')
  }

  function startDrag(type,e){if(!active)return;e.preventDefault();drag={id:e.pointerId,type};const el=type==='line'?gateLine:type==='start'?startHandle:endHandle;try{el.setPointerCapture(e.pointerId)}catch{}calibrating=true;calibrate.hidden=true;resetPhase()}
  gateLine.addEventListener('pointerdown',e=>startDrag('line',e));startHandle.addEventListener('pointerdown',e=>startDrag('start',e));endHandle.addEventListener('pointerdown',e=>startDrag('end',e));
  function dragMove(e){
    if(!drag||drag.id!==e.pointerId)return;e.preventDefault();const r=viewport.getBoundingClientRect();
    if(drag.type==='line'){const value=orientation==='vertical'?(e.clientX-r.left)/r.width*100:(e.clientY-r.top)/r.height*100;gatePos=Math.max(18,Math.min(82,value))}
    else{const value=orientation==='vertical'?(e.clientY-r.top)/r.height*100:(e.clientX-r.left)/r.width*100;if(drag.type==='start')segStart=Math.max(4,Math.min(segEnd-20,value));else segEnd=Math.min(96,Math.max(segStart+20,value))}
    applyGeometry()
  }
  [gateLine,startHandle,endHandle].forEach(el=>el.addEventListener('pointermove',dragMove));
  function endDrag(e){if(!drag||drag.id!==e.pointerId)return;drag=null;persistGeometry();if(!paused)startCalibration()}
  [gateLine,startHandle,endHandle].forEach(el=>{el.addEventListener('pointerup',endDrag);el.addEventListener('pointercancel',endDrag)});

  modeChoice.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;localStorage.setItem('gate-mode',mode);renderModeChoice();renderData()});
  start.onclick=open;exit.onclick=close;pauseBtn.onclick=togglePause;orientationBtn.onclick=toggleOrientation;directionBtn.onclick=cycleDirection;resetBtn.onclick=resetData;
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){paused=true;pauseBtn.textContent='继续';statusTitle.textContent='页面已暂停';clearTimeout(loopTimer);resetTiming();await releaseWake()}else{await requestWake();paused=false;pauseBtn.textContent='暂停';startCalibration();frameLoop()}});
  window.addEventListener('resize',()=>{if(active&&!paused)startCalibration()});
  window.addEventListener('pagehide',()=>{active=false;clearTimeout(loopTimer);stopStream();releaseWake()});

  renderModeChoice();applyGeometry();renderData();
})();