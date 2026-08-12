(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error');
  const session=$('#session'),exit=$('#exit'),pauseBtn=$('#pause'),micState=$('#micState');
  const stage=$('.stage'),stateText=$('#stateText'),timer=$('#timer'),hint=$('#hint'),lineNote=$('#lineNote'),levelBar=$('#levelBar');
  const calibration=$('#calibration'),calValue=$('#calValue'),calText=$('#calText');
  const longestEl=$('#longest'),countEl=$('#count'),usualGapEl=$('#usualGap'),thresholdValue=$('#thresholdValue'),finish=$('#finish');
  const result=$('#result'),resultLongest=$('#resultLongest'),resultCount=$('#resultCount'),resultUsual=$('#resultUsual'),share=$('#share'),again=$('#again'),done=$('#done');

  let vadInstance=null,wake=null,active=false,paused=false,raf=0,voiceProb=0;
  let speaking=false,speechStartedAt=0,lastSpeechEnd=0,currentGapThreshold=5600;
  let turns=[],naturalGaps=[],armed=false,coldActive=false,coldCount=0,longestCold=0;
  let ortBase='',vadBase='';

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const median=a=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
  const fmtSec=ms=>Number.isFinite(ms)&&ms>0?`${(ms/1000).toFixed(ms<10000?1:0)} 秒`:'—';
  const fmtClock=ms=>{const s=Math.max(0,ms)/1000,m=Math.floor(s/60),sec=s-m*60;return `${String(m).padStart(2,'0')}:${sec.toFixed(1).padStart(4,'0')}`};

  function setError(t=''){error.hidden=!t;error.textContent=t}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
  function recentTurns(now=performance.now()){turns=turns.filter(t=>now-t.end<35000);return turns}
  function usualGap(){return naturalGaps.length?median(naturalGaps.slice(-10)):NaN}
  function calcThreshold(){
    const g=naturalGaps.slice(-10).filter(x=>x>=180&&x<5000);if(!g.length)return 5600;
    const s=[...g].sort((a,b)=>a-b),med=median(s),p75=s[Math.min(s.length-1,Math.floor((s.length-1)*.75))];
    return clamp(Math.max(5200,med*1.55+3500,p75+3000),5200,9500)
  }
  function renderStats(){
    longestEl.textContent=fmtSec(longestCold);countEl.textContent=`${coldCount} 次`;const u=usualGap();usualGapEl.textContent=fmtSec(u);
    thresholdValue.textContent=armed?fmtSec(currentGapThreshold):'学习中'
  }
  function resetConversation(keepStats=true){
    speaking=false;speechStartedAt=0;lastSpeechEnd=0;turns=[];naturalGaps=[];armed=false;coldActive=false;currentGapThreshold=5600;
    if(!keepStats){coldCount=0;longestCold=0}stage.classList.remove('cold');stateText.textContent='先聊起来';timer.textContent='—';hint.textContent='听到几轮对话后才开始判断冷场';lineNote.textContent='正在学习这场聊天的节奏';renderStats()
  }

  function loadScript(url){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.async=true;s.crossOrigin='anonymous';s.onload=()=>resolve(url);s.onerror=()=>{s.remove();reject(new Error(url))};document.head.appendChild(s)})}
  async function loadFirst(urls,test){if(test())return urls[0];let last;for(const u of urls){try{await loadScript(u);if(test())return u}catch(e){last=e}}throw last||new Error('load')}
  async function loadVadLibrary(){
    calText.textContent='正在载入人声识别';calValue.textContent='…';
    const ortUrl=await loadFirst([
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js',
      'https://unpkg.com/onnxruntime-web@1.22.0/dist/ort.wasm.min.js'
    ],()=>!!window.ort);
    ortBase=ortUrl.includes('unpkg.com')?'https://unpkg.com/onnxruntime-web@1.22.0/dist/':'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
    const vadUrl=await loadFirst([
      'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/bundle.min.js',
      'https://unpkg.com/@ricky0123/vad-web@0.0.30/dist/bundle.min.js'
    ],()=>!!window.vad?.MicVAD);
    vadBase=vadUrl.includes('unpkg.com')?'https://unpkg.com/@ricky0123/vad-web@0.0.30/dist/':'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/'
  }

  function onSpeechStart(){
    if(!active||paused)return;const now=performance.now();speaking=true;speechStartedAt=now;voiceProb=1;
    if(lastSpeechEnd>0){
      const gap=now-lastSpeechEnd;
      if(coldActive||armed&&gap>=currentGapThreshold){
        if(!coldActive)coldCount++;longestCold=Math.max(longestCold,gap);coldActive=false
      }else if(gap>=180&&gap<Math.min(5000,currentGapThreshold)){
        naturalGaps.push(gap);if(naturalGaps.length>24)naturalGaps.shift()
      }
    }
    stage.classList.remove('cold');stateText.textContent='有人在说话';timer.textContent='—';hint.textContent='';lineNote.textContent=armed?`这场聊天目前超过 ${fmtSec(calcThreshold())} 才算冷场`:'还在学习接话节奏';renderStats()
  }
  function onSpeechEnd(audioData){
    if(!active||paused)return;const now=performance.now(),dur=audioData?.length?audioData.length/16:Math.max(0,now-speechStartedAt);speaking=false;
    if(dur<160){stateText.textContent=armed?'正常停顿':'先聊起来';return}
    turns.push({end:now,dur});const r=recentTurns(now),speechMs=r.reduce((a,b)=>a+b.dur,0);if(!armed&&r.length>=3&&speechMs>=1800)armed=true;
    lastSpeechEnd=now;currentGapThreshold=calcThreshold();coldActive=false;stage.classList.remove('cold');timer.textContent='—';
    if(armed){stateText.textContent='正常停顿';hint.textContent='还不算冷场';lineNote.textContent=`当前要超过 ${fmtSec(currentGapThreshold)} 才算冷场`}
    else{stateText.textContent='先聊起来';hint.textContent='再听到几轮对话后开始判断';lineNote.textContent='普通停顿不会被直接算成冷场'}
    renderStats()
  }
  function onFrameProcessed(probs){voiceProb=clamp(Number(probs?.isSpeech)||0,0,1)}

  async function setupVad(){
    await loadVadLibrary();calText.textContent='正在开启麦克风';
    vadInstance=await window.vad.MicVAD.new({
      model:'v5',onnxWASMBasePath:ortBase,baseAssetPath:vadBase,
      onSpeechStart,onSpeechEnd,onFrameProcessed,onVADMisfire:()=>{}
    });
    await vadInstance.start();micState.textContent='只听人声';calibration.hidden=true;startLoop()
  }
  async function stopVad(){
    cancelAnimationFrame(raf);raf=0;try{await vadInstance?.pause?.()}catch{}try{await vadInstance?.destroy?.()}catch{}vadInstance=null;voiceProb=0;levelBar.style.width='0%'
  }

  function timeoutConversation(){
    if(coldActive)longestCold=Math.max(longestCold,30000);coldActive=false;armed=false;turns=[];naturalGaps=[];lastSpeechEnd=0;currentGapThreshold=5600;stage.classList.remove('cold');stateText.textContent='聊天好像停了';timer.textContent='—';hint.textContent='重新说几轮后再判断冷场';lineNote.textContent='长时间没人说话不会无限计成冷场';renderStats()
  }
  function renderQuiet(now){
    if(!armed||!lastSpeechEnd||speaking)return;const gap=now-lastSpeechEnd;
    if(gap>=30000){timeoutConversation();return}
    if(gap<currentGapThreshold){
      stage.classList.remove('cold');stateText.textContent='正常停顿';timer.textContent='—';const remain=currentGapThreshold-gap;
      hint.textContent=remain<1800?'再没人说话才真的有点冷':'还不算冷场';lineNote.textContent=`当前冷场线 ${fmtSec(currentGapThreshold)}`;return
    }
    if(!coldActive){coldActive=true;coldCount++;renderStats()}
    longestCold=Math.max(longestCold,gap);stage.classList.add('cold');stateText.textContent='冷场中';timer.textContent=fmtClock(gap);
    hint.textContent=gap<9000?'这次已经明显比平时久了':gap<15000?'确实没人接了':gap<22000?'谁救一下':'这已经不是普通停顿了';lineNote.textContent=`平时大约 ${fmtSec(usualGap())} · 这次 ${fmtSec(gap)}`;renderStats()
  }
  function startLoop(){
    cancelAnimationFrame(raf);const loop=now=>{raf=requestAnimationFrame(loop);if(!active||paused)return;levelBar.style.width=`${Math.round(voiceProb*100)}%`;if(!speaking)renderQuiet(now)};raf=requestAnimationFrame(loop)
  }

  async function open(){
    if(active)return;setError('');start.disabled=true;active=true;paused=false;home.hidden=true;session.hidden=false;result.hidden=true;calibration.hidden=false;calValue.textContent='…';resetConversation(false);
    try{await requestWake();await setupVad()}
    catch(e){console.error(e);active=false;await stopVad();await releaseWake();session.hidden=true;home.hidden=false;setError(e?.name==='NotAllowedError'?'没有获得麦克风权限。允许后才能判断有没有人在说话。':'人声识别没有成功加载。请确认网络后再试。')}
    finally{start.disabled=false}
  }
  async function closeAll(){active=false;paused=false;await stopVad();await releaseWake();session.hidden=true;home.hidden=false;result.hidden=true;window.scrollTo({top:0,behavior:'instant'})}
  async function togglePause(){
    if(!active)return;paused=!paused;pauseBtn.textContent=paused?'继续':'暂停';micState.textContent=paused?'已暂停':'只听人声';
    if(paused){try{await vadInstance?.pause?.()}catch{}stage.classList.remove('cold');stateText.textContent='已暂停';timer.textContent='—';hint.textContent='继续后重新学习聊天节奏'}
    else{resetConversation(true);try{await vadInstance?.start?.()}catch{}startLoop()}
  }
  async function finishSession(){
    if(!active)return;active=false;paused=true;await stopVad();await releaseWake();micState.textContent='本次结束';stage.classList.remove('cold');
    resultLongest.textContent=longestCold?fmtClock(longestCold):'没有';resultCount.textContent=String(coldCount);resultUsual.textContent=fmtSec(usualGap());result.hidden=false
  }
  async function restart(){result.hidden=true;session.hidden=true;home.hidden=false;paused=false;active=false;await open()}
  async function shareResult(){
    const text=`冷场计时：最长冷场 ${longestCold?fmtSec(longestCold):'没有'}，共 ${coldCount} 次${Number.isFinite(usualGap())?`，平时停顿约 ${fmtSec(usualGap())}`:''}。`;
    try{if(navigator.share){await navigator.share({title:'冷场计时',text});return}}catch(e){if(e?.name==='AbortError')return}
    try{await navigator.clipboard.writeText(text);share.textContent='已复制';setTimeout(()=>share.textContent='分享结果',1200)}catch{share.textContent='复制失败';setTimeout(()=>share.textContent='分享结果',1200)}
  }

  start.onclick=open;exit.onclick=closeAll;pauseBtn.onclick=togglePause;finish.onclick=finishSession;again.onclick=restart;done.onclick=closeAll;share.onclick=shareResult;
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){paused=true;pauseBtn.textContent='继续';micState.textContent='已暂停';try{await vadInstance?.pause?.()}catch{}await releaseWake()}else{await requestWake();stateText.textContent='已暂停';hint.textContent='点继续后重新学习聊天节奏'}});
  window.addEventListener('pagehide',()=>{active=false;stopVad();releaseWake()});
  renderStats()
})();