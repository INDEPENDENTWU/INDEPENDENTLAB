(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error');
  const session=$('#session'),exit=$('#exit'),pauseBtn=$('#pause'),micState=$('#micState');
  const stage=$('.stage'),stateText=$('#stateText'),timer=$('#timer'),hint=$('#hint'),levelBar=$('#levelBar');
  const calibration=$('#calibration'),calValue=$('#calValue');
  const longestEl=$('#longest'),countEl=$('#count'),totalColdEl=$('#totalCold'),thresholdBtn=$('#threshold'),thresholdValue=$('#thresholdValue'),finish=$('#finish');
  const result=$('#result'),resultLongest=$('#resultLongest'),resultCount=$('#resultCount'),resultTotal=$('#resultTotal'),share=$('#share'),again=$('#again'),done=$('#done');

  let stream=null,audio=null,source=null,analyser=null,data=null,wake=null,raf=0;
  let active=false,paused=false,ambient=.002,lastSoundAt=0,soundHoldUntil=0,soundCandidate=0,coldCounted=false;
  let longest=0,totalCold=0,count=0,currentAdded=false;
  const thresholds=[2000,3000,5000];
  let thresholdMs=Number(localStorage.getItem('silence-threshold-ms'))||3000;if(!thresholds.includes(thresholdMs))thresholdMs=3000;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const fmtShort=ms=>ms>0?`${(ms/1000).toFixed(ms<10000?1:0)} 秒`:'—';
  const fmtClock=ms=>{const s=Math.max(0,ms)/1000,m=Math.floor(s/60),sec=s-m*60;return `${String(m).padStart(2,'0')}:${sec.toFixed(1).padStart(4,'0')}`};

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function renderThreshold(){thresholdValue.textContent=`${thresholdMs/1000} 秒`}
  function renderStats(){longestEl.textContent=fmtShort(longest);countEl.textContent=`${count} 次`;totalColdEl.textContent=fmtShort(totalCold)}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
  function rms(){if(!analyser)return 0;analyser.getFloatTimeDomainData(data);let s=0;for(const v of data)s+=v*v;return Math.sqrt(s/data.length)}
  function cleanupMedia(){cancelAnimationFrame(raf);raf=0;if(source){try{source.disconnect()}catch{}source=null}if(analyser){try{analyser.disconnect()}catch{}analyser=null}if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}data=null;levelBar.style.width='0%'}
  async function closeAll(){active=false;paused=false;cleanupMedia();await releaseWake();session.hidden=true;home.hidden=false;result.hidden=true;window.scrollTo({top:0,behavior:'instant'})}

  async function setupMic(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');const sup=navigator.mediaDevices.getSupportedConstraints?.()||{},c={channelCount:1};
    if(sup.echoCancellation)c.echoCancellation=false;if(sup.noiseSuppression)c.noiseSuppression=false;if(sup.autoGainControl)c.autoGainControl=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:c,video:false});const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);analyser=audio.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.05;source.connect(analyser);data=new Float32Array(analyser.fftSize)
  }
  async function calibrate(){
    calibration.hidden=false;micState.textContent='正在记住房间底噪';const vals=[],ms=1500,t0=performance.now();
    while(active&&performance.now()-t0<ms){const v=rms();vals.push(v);calValue.textContent=((ms-(performance.now()-t0))/1000).toFixed(1);await sleep(34)}
    ambient=Math.max(.0007,median(vals.filter(Number.isFinite))||.002);calibration.hidden=true;micState.textContent='正在听';const now=performance.now();lastSoundAt=now;soundHoldUntil=now+320;soundCandidate=0;coldCounted=false;currentAdded=false;startLoop()
  }
  function resetSession(){longest=0;totalCold=0;count=0;coldCounted=false;currentAdded=false;renderStats();result.hidden=true;pauseBtn.textContent='暂停'}
  function endCold(now){
    if(coldCounted&&!currentAdded){const d=Math.max(0,now-lastSoundAt);totalCold+=d;longest=Math.max(longest,d);currentAdded=true;renderStats()}
    coldCounted=false;currentAdded=false
  }
  function registerSound(now){
    if(now-lastSoundAt>thresholdMs)endCold(now);lastSoundAt=now;soundHoldUntil=now+260;soundCandidate=0;stage.classList.remove('cold');stateText.textContent='有人出声';timer.textContent='—';hint.textContent='最后一个声音结束后开始计算'
  }
  function renderQuiet(now){
    const d=Math.max(0,now-lastSoundAt);timer.textContent=fmtClock(d);
    if(d<thresholdMs){stage.classList.remove('cold');stateText.textContent='安静了';hint.textContent=`再安静 ${Math.max(0,(thresholdMs-d)/1000).toFixed(1)} 秒才算冷场`;return}
    if(!coldCounted){coldCounted=true;currentAdded=false;count++;renderStats()}
    longest=Math.max(longest,d);renderStats();stage.classList.add('cold');stateText.textContent='冷场中';
    hint.textContent=d<6000?'目前还算正常':d<12000?'已经有点久了':d<20000?'谁说句话':'已经可以听见空调了'
  }
  function startLoop(){
    cancelAnimationFrame(raf);let lastFrame=0;
    const loop=now=>{raf=requestAnimationFrame(loop);if(!active||paused||!analyser||now-lastFrame<32)return;lastFrame=now;const v=rms(),gate=Math.max(.0045,ambient*2.55+.0012),level=clamp((v-ambient)/(gate*2.2),0,1);levelBar.style.width=`${Math.round(level*100)}%`;
      if(v>gate){if(!soundCandidate)soundCandidate=now;if(now-soundCandidate>=55)registerSound(now)}else{soundCandidate=0;if(v<Math.max(.012,gate*.58))ambient=ambient*.997+v*.003}
      if(now>soundHoldUntil&&now-lastSoundAt>280)renderQuiet(now)
    };raf=requestAnimationFrame(loop)
  }

  async function open(){
    setError('');start.disabled=true;try{active=true;paused=false;home.hidden=true;session.hidden=false;resetSession();renderThreshold();await setupMic();await requestWake();await calibrate()}
    catch(e){active=false;cleanupMedia();session.hidden=true;home.hidden=false;setError(e?.name==='NotAllowedError'?'没有获得麦克风权限。允许后才能判断房间有没有出声。':'当前浏览器没有提供可用的麦克风。')}
    finally{start.disabled=false}
  }
  function togglePause(){
    if(!active)return;paused=!paused;pauseBtn.textContent=paused?'继续':'暂停';micState.textContent=paused?'已暂停':'正在听';if(paused){stage.classList.remove('cold');stateText.textContent='已暂停';timer.textContent='—';hint.textContent='继续后从新的声音状态开始'}else{const now=performance.now();lastSoundAt=now;soundHoldUntil=now+400;soundCandidate=0;coldCounted=false;currentAdded=false;stateText.textContent='有人出声';hint.textContent='最后一个声音结束后开始计算'}
  }
  function finishSession(){
    if(!active)return;const now=performance.now();if(coldCounted&&!currentAdded){const d=now-lastSoundAt;totalCold+=d;longest=Math.max(longest,d);currentAdded=true}renderStats();paused=true;cleanupMedia();releaseWake();micState.textContent='本次结束';resultLongest.textContent=fmtClock(longest);resultCount.textContent=String(count);resultTotal.textContent=fmtClock(totalCold);result.hidden=false
  }
  async function restart(){
    if(!active)active=true;resetSession();paused=false;try{await setupMic();await requestWake();await calibrate()}catch{await closeAll();setError('麦克风没有重新打开。')}
  }
  async function shareResult(){
    const text=`冷场计时：本次最长冷场 ${fmtShort(longest)}，共 ${count} 次，累计 ${fmtShort(totalCold)}。`;
    try{if(navigator.share){await navigator.share({title:'冷场计时',text});return}}catch(e){if(e?.name==='AbortError')return}
    try{await navigator.clipboard.writeText(text);share.textContent='已复制';setTimeout(()=>share.textContent='分享结果',1200)}catch{share.textContent='复制失败';setTimeout(()=>share.textContent='分享结果',1200)}
  }

  start.onclick=open;exit.onclick=closeAll;pauseBtn.onclick=togglePause;finish.onclick=finishSession;again.onclick=restart;done.onclick=closeAll;share.onclick=shareResult;
  thresholdBtn.onclick=()=>{const i=thresholds.indexOf(thresholdMs);thresholdMs=thresholds[(i+1)%thresholds.length];localStorage.setItem('silence-threshold-ms',String(thresholdMs));renderThreshold()};
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){paused=true;pauseBtn.textContent='继续';micState.textContent='已暂停';await releaseWake()}else{await requestWake()}});
  window.addEventListener('pagehide',()=>{active=false;cleanupMedia();releaseWake()});
  renderThreshold();renderStats();
})();