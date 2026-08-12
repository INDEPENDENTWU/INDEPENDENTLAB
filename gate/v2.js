(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),startLabel=$('#startLabel'),error=$('#error'),modeChoice=$('#modeChoice');
  const counter=$('#counter'),exit=$('#exit'),pauseBtn=$('#pause'),statusTitle=$('#statusTitle'),statusSub=$('#statusSub');
  const viewport=$('#viewport'),video=$('#video'),gate=$('#gate'),gateLine=$('#gateLine'),startHandle=$('#startHandle'),endHandle=$('#endHandle');
  const calibrate=$('#calibrate'),calValue=$('#calValue'),sensorA=gate.querySelector('.sensor.a'),sensorB=gate.querySelector('.sensor.b'),flash=$('#flash');
  const crossState=$('#crossState'),crossDot=$('#crossDot'),crossStateText=$('#crossStateText');
  const flowStats=$('#flowStats'),countAEl=$('#countA'),countBEl=$('#countB'),arrowA=$('#arrowA'),arrowB=$('#arrowB'),netCount=$('#netCount'),netNote=$('#netNote');
  const itemStats=$('#itemStats'),itemTotalEl=$('#itemTotal'),itemRate=$('#itemRate'),itemInterval=$('#itemInterval'),itemDirection=$('#itemDirection');
  const lapStats=$('#lapStats'),lapCountEl=$('#lapCount'),lastLap=$('#lastLap'),bestLap=$('#bestLap'),avgLap=$('#avgLap'),lapDirection=$('#lapDirection');
  const orientationBtn=$('#orientation'),orientationValue=$('#orientationValue'),directionBtn=$('#direction'),directionValue=$('#directionValue'),resetBtn=$('#reset'),bottomHint=$('#bottomHint');
  const canvas=$('#analysis'),ctx=canvas.getContext('2d',{willReadFrequently:true});

  const MODES=['flow','item','lap'],CAL_MS=1650,FRAME_MS=78;
  let mode=localStorage.getItem('gate-v4-mode')||'flow';if(!MODES.includes(mode))mode='flow';
  let orientation=localStorage.getItem('gate-v4-orientation')||'horizontal';if(!['vertical','horizontal'].includes(orientation))orientation='horizontal';
  let gatePos=Number(localStorage.getItem('gate-v4-position'));if(!Number.isFinite(gatePos)||gatePos<22||gatePos>78)gatePos=56;
  let segStart=Number(localStorage.getItem('gate-v4-seg-start')),segEnd=Number(localStorage.getItem('gate-v4-seg-end'));if(!Number.isFinite(segStart)||!Number.isFinite(segEnd)||segStart<4||segEnd>96||segEnd-segStart<24){segStart=12;segEnd=88}
  let directions={flow:'a',item:'a',lap:'a'};try{directions={...directions,...JSON.parse(localStorage.getItem('gate-v4-directions')||'{}')}}catch{}
  if(!['a','b'].includes(directions.flow))directions.flow='a';if(!['a','b','both'].includes(directions.item))directions.item='a';if(!['a','b','both'].includes(directions.lap))directions.lap='a';

  let flowA=0,flowB=0,itemTotal=0,lapCount=0;try{const s=JSON.parse(sessionStorage.getItem('gate-session-v4')||'{}');flowA=Number(s.flowA)||0;flowB=Number(s.flowB)||0;itemTotal=Number(s.itemTotal)||0;lapCount=Number(s.lapCount)||0}catch{}
  let itemTimes=[],lapTimes=[],lapAnchor=null;
  let stream=null,active=false,paused=false,wake=null,loopTimer=0,bg=null,gray=null,prevGray=null,noiseMean=.008,noiseRatio=.025,shakeFrames=0;
  let calibrating=false,calStarted=0,phase='idle',firstSide=null,phaseAt=0,secondAt=0,clearSince=0,drag=null,flashTimer=0;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function persistSession(){try{sessionStorage.setItem('gate-session-v4',JSON.stringify({flowA,flowB,itemTotal,lapCount}))}catch{}}
  function persistGeometry(){localStorage.setItem('gate-v4-position',String(gatePos));localStorage.setItem('gate-v4-seg-start',String(segStart));localStorage.setItem('gate-v4-seg-end',String(segEnd));localStorage.setItem('gate-v4-orientation',orientation)}
  function persistDirections(){localStorage.setItem('gate-v4-directions',JSON.stringify(directions))}
  function arrows(){return orientation==='vertical'?{a:'→',b:'←'}:{a:'↓',b:'↑'}}
  function formatSec(ms){if(!Number.isFinite(ms))return'—';const s=ms/1000;return s<10?s.toFixed(2):s<60?s.toFixed(1):`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`}
  function applyGeometry(){gate.classList.toggle('vertical',orientation==='vertical');gate.classList.toggle('horizontal',orientation==='horizontal');gate.style.setProperty('--gate',`${gatePos}%`);gate.style.setProperty('--seg-start',`${segStart}%`);gate.style.setProperty('--seg-end',`${segEnd}%`)}
  function setBandVisual(a,b,la=0,lb=0){sensorA.classList.toggle('active',a);sensorB.classList.toggle('active',b);sensorA.style.background=`rgba(232,69,45,${(.08+Math.min(1,la)*.22).toFixed(3)})`;sensorB.style.background=`rgba(232,69,45,${(.08+Math.min(1,lb)*.22).toFixed(3)})`}
  function stateText(t,live=false){crossStateText.textContent=t;crossDot.classList.toggle('live',live)}
  function resetCross(){phase='idle';firstSide=null;phaseAt=0;secondAt=0;clearSince=0;setBandVisual(false,false);stateText('等待穿越')}
  function resetTiming(){itemTimes=[];lapTimes=[];lapAnchor=null}

  function renderModeChoice(){modeChoice.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));const n={flow:'进出',item:'计件',lap:'圈数'};startLabel.textContent=`打开${n[mode]}计数`}
  function renderData(){
    const ar=arrows(),dir=directions[mode];arrowA.textContent=ar.a;arrowB.textContent=ar.b;flowStats.hidden=mode!=='flow';itemStats.hidden=mode!=='item';lapStats.hidden=mode!=='lap';
    countAEl.textContent=String(flowA);countBEl.textContent=String(flowB);const enterA=directions.flow==='a',net=enterA?flowA-flowB:flowB-flowA;netCount.textContent=net>0?`+${net}`:String(net);netNote.textContent=`${enterA?ar.a:ar.b} 进入 · ${enterA?ar.b:ar.a} 离开`;
    itemTotalEl.textContent=String(itemTotal);itemDirection.textContent=dir==='both'?'两个方向都计':`只计 ${dir==='a'?ar.a:ar.b}`;const now=Date.now(),recent=itemTimes.filter(t=>now-t<=60000);itemRate.textContent=recent.length>=2?(((recent.length-1)/Math.max(1,recent.at(-1)-recent[0])*60000).toFixed(1)):'—';
    if(itemTimes.length>=2){const ds=[];for(let i=Math.max(1,itemTimes.length-8);i<itemTimes.length;i++)ds.push((itemTimes[i]-itemTimes[i-1])/1000);itemInterval.textContent=(ds.reduce((a,b)=>a+b,0)/ds.length).toFixed(ds.some(x=>x<10)?2:1)}else itemInterval.textContent='—';
    lapCountEl.textContent=String(lapCount);lapDirection.textContent=dir==='both'?'每次过门计时':`经过 ${dir==='a'?ar.a:ar.b} 计一圈`;lastLap.textContent=lapTimes.length?formatSec(lapTimes.at(-1)):'—';bestLap.textContent=lapTimes.length?formatSec(Math.min(...lapTimes)):'—';avgLap.textContent=lapTimes.length?`平均 ${formatSec(lapTimes.reduce((a,b)=>a+b,0)/lapTimes.length)}`:'平均 —';
    orientationValue.textContent=orientation==='horizontal'?'横向':'竖向';if(mode==='flow')directionValue.textContent=`进门 ${directions.flow==='a'?ar.a:ar.b}`;else if(mode==='item')directionValue.textContent=directions.item==='both'?'双向':directions.item==='a'?ar.a:ar.b;else directionValue.textContent=directions.lap==='both'?'双向':directions.lap==='a'?ar.a:ar.b;
    bottomHint.textContent=orientation==='horizontal'?`把两道感应带横在必经路上：先穿 1、再穿 2 才计 ${ar.a}；反过来才计 ${ar.b}。`:`把两道感应带竖在必经路上：先穿 1、再穿 2 才计 ${ar.a}；反过来才计 ${ar.b}。`;persistSession()
  }
  function showFlash(text){flash.textContent=text;flash.hidden=false;clearTimeout(flashTimer);flashTimer=setTimeout(()=>flash.hidden=true,520)}

  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
  function stopStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null}

  function ensureCanvas(){
    const r=viewport.getBoundingClientRect(),aspect=Math.max(.45,Math.min(2.4,r.width/Math.max(1,r.height)));let w,h;if(aspect>=1){w=240;h=Math.max(100,Math.round(w/aspect))}else{h=240;w=Math.max(100,Math.round(h*aspect))}
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;bg=null;gray=null;prevGray=null;if(active&&!paused)startCalibration('画面尺寸变化')}
  }
  function drawVisibleFrame(){
    ensureCanvas();const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return false;const target=canvas.width/canvas.height,source=vw/vh;let sx=0,sy=0,sw=vw,sh=vh;if(source>target){sw=vh*target;sx=(vw-sw)/2}else{sh=vw/target;sy=(vh-sh)/2}ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);return true
  }
  function readGray(){const d=ctx.getImageData(0,0,canvas.width,canvas.height).data,n=canvas.width*canvas.height;if(!gray||gray.length!==n)gray=new Uint8Array(n);for(let i=0,j=0;i<d.length;i+=4,j++)gray[j]=(d[i]*77+d[i+1]*150+d[i+2]*29)>>8;return gray}
  function bandRect(which){
    const w=canvas.width,h=canvas.height,p=gatePos/100,s0=segStart/100,s1=segEnd/100,gap=.095,half=.045;
    if(orientation==='vertical'){const center=(p+(which==='a'?-gap:gap))*w;return{x0:Math.max(0,Math.floor(center-half*w)),x1:Math.min(w,Math.ceil(center+half*w)),y0:Math.floor(s0*h),y1:Math.ceil(s1*h)}}
    const center=(p+(which==='a'?-gap:gap))*h;return{x0:Math.floor(s0*w),x1:Math.ceil(s1*w),y0:Math.max(0,Math.floor(center-half*h)),y1:Math.min(h,Math.ceil(center+half*h))}
  }
  function bandStats(which){
    if(!bg||!gray)return{mean:0,ratio:0};const r=bandRect(which),cut=Math.max(13,noiseMean*255*3.2+7);let sum=0,changed=0,n=0;
    for(let y=r.y0;y<r.y1;y+=2){for(let x=r.x0;x<r.x1;x+=2){const i=y*canvas.width+x,d=Math.abs(gray[i]-bg[i]);sum+=d/255;if(d>cut)changed++;n++}}
    return{mean:sum/Math.max(1,n),ratio:changed/Math.max(1,n)}
  }
  function adaptBackground(alpha=.006){if(!bg||!gray)return;for(let i=0;i<bg.length;i++)bg[i]=bg[i]*(1-alpha)+gray[i]*alpha}
  function globalFrameChange(){
    if(!prevGray||prevGray.length!==gray.length){prevGray=new Uint8Array(gray);return 0}let changed=0,n=0;for(let i=0;i<gray.length;i+=7){if(Math.abs(gray[i]-prevGray[i])>28)changed++;n++;prevGray[i]=gray[i]}return changed/Math.max(1,n)
  }

  function startCalibration(reason=''){calibrating=true;calStarted=performance.now();bg=null;prevGray=null;noiseMean=.008;noiseRatio=.025;shakeFrames=0;resetCross();calibrate.hidden=false;calValue.textContent='1.7';statusTitle.textContent='正在记住空画面';statusSub.textContent='两道感应带附近先空着';if(reason)stateText('重新记背景')}
  function calibrationFrame(now){
    if(!bg||bg.length!==gray.length){bg=new Float32Array(gray.length);for(let i=0;i<gray.length;i++)bg[i]=gray[i]}
    else{const a=bandStats('a'),b=bandStats('b');noiseMean=noiseMean*.86+Math.min(a.mean,b.mean)*.14;noiseRatio=noiseRatio*.86+Math.min(a.ratio,b.ratio)*.14;adaptBackground(.12)}
    const remain=Math.max(0,(CAL_MS-(now-calStarted))/1000);calValue.textContent=remain.toFixed(1);if(now-calStarted>=CAL_MS){calibrating=false;calibrate.hidden=true;statusTitle.textContent='正在计数';statusSub.textContent='必须完整穿过两道感应带';resetCross();if(mode==='lap')statusSub.textContent='第一次完整过门开始计时'}
  }

  function directionMatches(d){const pref=directions[mode];return pref==='both'||pref===d}
  function register(d){
    const ar=arrows(),now=Date.now();navigator.vibrate?.(18);
    if(mode==='flow'){if(d==='a')flowA++;else flowB++;showFlash(`${d==='a'?ar.a:ar.b} +1`);statusTitle.textContent=`${d==='a'?ar.a:ar.b} 完整通过`}
    else if(mode==='item'&&directionMatches(d)){itemTotal++;itemTimes.push(now);if(itemTimes.length>100)itemTimes.shift();showFlash('+1');statusTitle.textContent='刚计入 1 个'}
    else if(mode==='lap'&&directionMatches(d)){if(lapAnchor==null){lapAnchor=now;showFlash('开始');statusTitle.textContent='计时开始'}else{const t=now-lapAnchor;lapAnchor=now;if(t>=450){lapCount++;lapTimes.push(t);if(lapTimes.length>100)lapTimes.shift();showFlash(`第 ${lapCount} 圈`);statusTitle.textContent=`上一圈 ${formatSec(t)}`}}}
    renderData();setTimeout(()=>{if(active&&!paused&&!calibrating)statusTitle.textContent='正在计数'},900)
  }
  function detect(now){
    const sa=bandStats('a'),sb=bandStats('b');noiseMean=noiseMean*.995+Math.min(sa.mean,sb.mean)*.005;noiseRatio=noiseRatio*.995+Math.min(sa.ratio,sb.ratio)*.005;
    const meanHigh=Math.max(.028,Math.min(.12,noiseMean*4.2+.013)),ratioHigh=Math.max(.095,Math.min(.46,noiseRatio*3.8+.045)),meanLow=meanHigh*.44,ratioLow=ratioHigh*.45;
    const a=sa.mean>meanHigh&&sa.ratio>ratioHigh,b=sb.mean>meanHigh&&sb.ratio>ratioHigh,la=Math.max(sa.mean/meanHigh,sa.ratio/ratioHigh),lb=Math.max(sb.mean/meanHigh,sb.ratio/ratioHigh);setBandVisual(a,b,la,lb);

    const global=globalFrameChange();if(global>.48)shakeFrames++;else shakeFrames=Math.max(0,shakeFrames-1);if(shakeFrames>=5){startCalibration('相机位置变化');statusTitle.textContent='相机动了';statusSub.textContent='正在重新记背景';return}

    if(phase==='cooldown'){
      if(sa.mean<meanLow&&sb.mean<meanLow&&sa.ratio<ratioLow&&sb.ratio<ratioLow){if(!clearSince)clearSince=now;if(now-clearSince>330){resetCross();adaptBackground(.03)}}else clearSince=0;return
    }
    if(phase==='idle'){
      if(a&&!b){phase='first';firstSide='a';phaseAt=now;stateText('感应 1 触发',true)}
      else if(b&&!a){phase='first';firstSide='b';phaseAt=now;stateText('感应 2 触发',true)}
      else if(a&&b)stateText('两道同时被挡住 · 不计')
      else{stateText('等待穿越');adaptBackground(.004)}return
    }
    if(phase==='first'){
      if(now-phaseAt>4200){resetCross();return}
      if(firstSide==='a'){
        if(!a&&!b){resetCross();return}if(b){phase='overlap';secondAt=now;stateText('1 → 2 · 正在穿越',true)}
      }else{
        if(!a&&!b){resetCross();return}if(a){phase='overlap';secondAt=now;stateText('2 → 1 · 正在穿越',true)}
      }return
    }
    if(phase==='overlap'){
      if(now-phaseAt>4800){resetCross();return}
      if(firstSide==='a'){
        if(!a&&b&&now-secondAt>45){register('a');phase='cooldown';clearSince=0;stateText('完整通过 · 等待清空',true);return}
        if(a&&!b&&now-secondAt>120){resetCross();return}
      }else{
        if(!b&&a&&now-secondAt>45){register('b');phase='cooldown';clearSince=0;stateText('完整通过 · 等待清空',true);return}
        if(b&&!a&&now-secondAt>120){resetCross();return}
      }
    }
  }
  function frameLoop(){clearTimeout(loopTimer);if(!active)return;if(!paused&&video.readyState>=2&&drawVisibleFrame()){readGray();const now=performance.now();if(calibrating)calibrationFrame(now);else detect(now)}loopTimer=setTimeout(frameLoop,FRAME_MS)}

  async function open(){
    setError('');if(!navigator.mediaDevices?.getUserMedia){setError('当前浏览器没有提供相机访问能力。');return}start.disabled=true;
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:960}},audio:false});video.srcObject=stream;await video.play();active=true;paused=false;home.hidden=true;counter.hidden=false;pauseBtn.textContent='暂停';applyGeometry();renderData();requestWake();startCalibration();frameLoop()}
    catch(e){stopStream();setError(e?.name==='NotAllowedError'?'没有获得相机权限。允许相机后才能计数。':'相机没有成功打开。')}
    finally{start.disabled=false}
  }
  async function close(){active=false;paused=false;clearTimeout(loopTimer);loopTimer=0;stopStream();await releaseWake();counter.hidden=true;home.hidden=false;resetCross();window.scrollTo({top:0,behavior:'instant'})}
  function togglePause(){if(!active)return;paused=!paused;pauseBtn.textContent=paused?'继续':'暂停';if(paused){statusTitle.textContent='已暂停';statusSub.textContent='当前不会计数';stateText('暂停')}else{startCalibration();statusTitle.textContent='重新准备';statusSub.textContent='两道感应带附近先空着'}}
  function cycleDirection(){const cur=directions[mode];if(mode==='flow')directions.flow=cur==='a'?'b':'a';else directions[mode]=cur==='a'?'b':cur==='b'?'both':'a';persistDirections();renderData()}
  function clearData(){flowA=flowB=itemTotal=lapCount=0;itemTimes=[];lapTimes=[];lapAnchor=null;persistSession();renderData();showFlash('已清零')}
  function toggleOrientation(){orientation=orientation==='horizontal'?'vertical':'horizontal';gatePos=50;segStart=12;segEnd=88;applyGeometry();persistGeometry();renderData();if(active&&!paused)startCalibration('感应带方向变化')}

  function pctFromPointer(e){const r=viewport.getBoundingClientRect();return orientation==='vertical'?clamp((e.clientX-r.left)/r.width*100,8,92):clamp((e.clientY-r.top)/r.height*100,8,92)}
  function segPctFromPointer(e){const r=viewport.getBoundingClientRect();return orientation==='vertical'?clamp((e.clientY-r.top)/r.height*100,4,96):clamp((e.clientX-r.left)/r.width*100,4,96)}
  function beginDrag(type,e){e.preventDefault();drag={type,id:e.pointerId};e.currentTarget.setPointerCapture?.(e.pointerId);paused=true}
  function moveDrag(e){if(!drag||e.pointerId!==drag.id)return;if(drag.type==='gate')gatePos=clamp(pctFromPointer(e),22,78);else if(drag.type==='start')segStart=Math.min(segEnd-24,segPctFromPointer(e));else if(drag.type==='end')segEnd=Math.max(segStart+24,segPctFromPointer(e));applyGeometry()}
  function endDrag(e){if(!drag||e.pointerId!==drag.id)return;drag=null;paused=false;persistGeometry();startCalibration('位置变化')}

  gateLine.addEventListener('pointerdown',e=>beginDrag('gate',e));startHandle.addEventListener('pointerdown',e=>beginDrag('start',e));endHandle.addEventListener('pointerdown',e=>beginDrag('end',e));window.addEventListener('pointermove',moveDrag,{passive:false});window.addEventListener('pointerup',endDrag);
  modeChoice.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;localStorage.setItem('gate-v4-mode',mode);renderModeChoice()};start.onclick=open;exit.onclick=close;pauseBtn.onclick=togglePause;orientationBtn.onclick=toggleOrientation;directionBtn.onclick=cycleDirection;resetBtn.onclick=clearData;
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){paused=true;await releaseWake()}else{paused=false;await requestWake();startCalibration('返回前台')}});window.addEventListener('pagehide',()=>{active=false;clearTimeout(loopTimer);stopStream();releaseWake()});
  applyGeometry();renderModeChoice();renderData();
})();