(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),modeChoice=$('#modeChoice'),start=$('#start'),startLabel=$('#startLabel'),error=$('#error');
  const meter=$('#meter'),exit=$('#exit'),cancel=$('#cancel'),statusTitle=$('#statusTitle'),statusSub=$('#statusSub'),measure=$('.measure');
  const progressValue=$('#progressValue'),progressText=$('#progressText'),result=$('#result'),resultLabel=$('#resultLabel'),resultQuality=$('#resultQuality');
  const distanceValue=$('#distanceValue'),distanceUnit=$('#distanceUnit'),repeatDetail=$('#repeatDetail'),echoDetail=$('#echoDetail'),qualityNote=$('#qualityNote');
  const roomStep=$('#roomStep'),firstWallValue=$('#firstWallValue'),measureSecond=$('#measureSecond'),resultActions=$('#resultActions'),again=$('#again'),finish=$('#finish');

  const TRIALS=5,SOUND_SPEED=343.2,PRE_MS=70,POST_MS=230,MIN_DISTANCE=.45,MAX_DISTANCE=6.5;
  let mode=localStorage.getItem('echo-mode')||'wall';if(!['wall','room'].includes(mode))mode='wall';
  let stream=null,audio=null,source=null,node=null,silent=null,wake=null,captureActive=false,captureParts=[],chirp=null,usingWorklet=false;
  let firstWall=null,lastStage='first',busy=false,trackSettings={};

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function setError(t=''){error.hidden=!t;error.textContent=t}
  function median(a){if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
  function formatDistance(m){if(!Number.isFinite(m))return'—';return m<1?`${Math.round(m*100)} cm`:`${m.toFixed(2)} m`}
  function renderMode(){modeChoice.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));startLabel.textContent=mode==='wall'?'测一下墙距':'量一下房间宽度'}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function disconnectAudio(){
    captureActive=false;captureParts=[];
    if(node){try{node.port&&(node.port.onmessage=null)}catch{}try{node.onaudioprocess=null}catch{}try{node.disconnect()}catch{}node=null}
    if(source){try{source.disconnect()}catch{}source=null}if(silent){try{silent.disconnect()}catch{}silent=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}usingWorklet=false;chirp=null;
  }
  function createChirp(){
    const rate=audio.sampleRate,n=Math.max(96,Math.round(rate*.0075)),buf=audio.createBuffer(1,n,rate),d=buf.getChannelData(0),f0=2800,f1=Math.min(9800,rate*.21);
    let phase=0;for(let i=0;i<n;i++){const x=i/(n-1),f=f0+(f1-f0)*x,win=Math.sin(Math.PI*x)**2;phase+=2*Math.PI*f/rate;d[i]=Math.sin(phase)*win*.92}return buf;
  }
  async function buildAudio(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
    const supported=navigator.mediaDevices.getSupportedConstraints?.()||{},c={channelCount:1};
    if(supported.echoCancellation)c.echoCancellation=false;if(supported.noiseSuppression)c.noiseSuppression=false;if(supported.autoGainControl)c.autoGainControl=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:c,video:false});trackSettings=stream.getAudioTracks()[0]?.getSettings?.()||{};
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);silent=audio.createGain();silent.gain.value=0;
    if(audio.audioWorklet&&window.AudioWorkletNode){
      try{await audio.audioWorklet.addModule('./capture-worklet.js?v=202608121453');node=new AudioWorkletNode(audio,'echo-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});node.port.onmessage=e=>{if(captureActive)captureParts.push(new Float32Array(e.data))};source.connect(node);node.connect(silent);silent.connect(audio.destination);usingWorklet=true}
      catch{node=null}
    }
    if(!node){
      node=audio.createScriptProcessor(2048,1,1);node.onaudioprocess=e=>{const out=e.outputBuffer.getChannelData(0);out.fill(0);if(!captureActive)return;const input=e.inputBuffer.getChannelData(0),copy=new Float32Array(input.length);copy.set(input);captureParts.push(copy)};source.connect(node);node.connect(silent);silent.connect(audio.destination)
    }
    chirp=createChirp();
  }
  function combine(parts){const n=parts.reduce((s,p)=>s+p.length,0),out=new Float32Array(n);let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out}
  function playChirp(){const s=audio.createBufferSource(),g=audio.createGain();s.buffer=chirp;g.gain.value=.42;s.connect(g);g.connect(audio.destination);s.start()}

  function normalizedTemplate(a){let mean=0;for(const v of a)mean+=v;mean/=Math.max(1,a.length);const out=new Float32Array(a.length);let e=0;for(let i=0;i<a.length;i++){const v=a[i]-mean;out[i]=v;e+=v*v}return{a:out,e:Math.max(e,1e-9)}}
  function downsample(a,f=2){const n=Math.floor(a.length/f),out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=a[i*f];return out}
  function corrAt(rec,tpl,te,off){let dot=0,e=0;for(let i=0;i<tpl.length;i++){const v=rec[off+i];dot+=v*tpl[i];e+=v*v}return Math.abs(dot)/Math.sqrt(Math.max(1e-12,e*te))}
  function findDirect(rec,tpl,te){
    const limit=rec.length-tpl.length;if(limit<=0)return null;let max=0,maxAt=0,scores=new Float32Array(limit+1);
    for(let o=0;o<=limit;o++){const s=corrAt(rec,tpl,te,o);scores[o]=s;if(s>max){max=s;maxAt=o}}
    if(max<.12)return null;const threshold=Math.max(.12,max*.55);for(let o=2;o<limit-2;o++){if(scores[o]>=threshold&&scores[o]>=scores[o-1]&&scores[o]>=scores[o+1])return{at:o,score:scores[o]}}
    return{at:maxAt,score:max};
  }
  function analyzeTrial(raw,trial){
    if(!raw?.length||!audio||!chirp)return[];const factor=2,rate=audio.sampleRate/factor,rec=downsample(raw,factor),tplRaw=downsample(chirp.getChannelData(0),factor),base=normalizedTemplate(tplRaw),direct=findDirect(rec,base.a,base.e);if(!direct)return[];
    const deviceSlice=rec.slice(direct.at,Math.min(rec.length,direct.at+base.a.length));if(deviceSlice.length<base.a.length*.85)return[];const dev=normalizedTemplate(deviceSlice);
    const minGap=Math.ceil((MIN_DISTANCE*2/SOUND_SPEED)*rate),maxGap=Math.floor((MAX_DISTANCE*2/SOUND_SPEED)*rate),start=Math.min(rec.length-dev.a.length,direct.at+minGap),end=Math.min(rec.length-dev.a.length,direct.at+maxGap);if(end<=start+4)return[];
    const vals=[];for(let o=start;o<=end;o++){vals.push({o,s:corrAt(rec,dev.a,dev.e,o)})}const floor=median(vals.map(x=>x.s)),threshold=Math.max(.075,direct.score*.075,(Number.isFinite(floor)?floor:0)*2.8);const peaks=[];
    for(let i=1;i<vals.length-1;i++){const p=vals[i];if(p.s<threshold||p.s<vals[i-1].s||p.s<vals[i+1].s)continue;const delta=p.o-direct.at,dist=delta/rate*SOUND_SPEED/2;if(dist<MIN_DISTANCE||dist>MAX_DISTANCE)continue;peaks.push({trial,dist,score:p.s,rel:p.s/Math.max(.001,direct.score)})}
    peaks.sort((a,b)=>b.score-a.score);const picked=[];for(const p of peaks){if(picked.some(q=>Math.abs(q.dist-p.dist)<.10))continue;picked.push(p);if(picked.length>=5)break}return picked;
  }
  function clusterTrials(all){
    if(!all.length)return null;let best=null;
    for(const seed of all){const tol=Math.max(.075,seed.dist*.035),chosen=[];for(let t=0;t<TRIALS;t++){const same=all.filter(x=>x.trial===t&&Math.abs(x.dist-seed.dist)<=tol).sort((a,b)=>b.score-a.score)[0];if(same)chosen.push(same)}if(chosen.length<3)continue;const d=median(chosen.map(x=>x.dist)),devs=chosen.map(x=>Math.abs(x.dist-d)),spread=median(devs),meanRel=chosen.reduce((s,x)=>s+x.rel,0)/chosen.length;if(spread>Math.max(.10,d*.055))continue;const score=chosen.length*10+meanRel*2-d*.03;if(!best||score>best.score)best={distance:d,spread,support:chosen.length,score,meanRel}}
    if(!best)return null;best.quality=best.support===5&&best.spread<=.035?'稳定':best.support>=4&&best.spread<=.07?'可用':'参考';return best;
  }

  async function oneTrial(i){
    progressValue.textContent=`${i+1} / ${TRIALS}`;progressText.textContent='正在听回声';captureParts=[];captureActive=true;await sleep(PRE_MS);playChirp();await sleep(POST_MS);captureActive=false;const raw=combine(captureParts);captureParts=[];return analyzeTrial(raw,i);
  }
  async function runBatch(){const all=[];for(let i=0;i<TRIALS;i++){const c=await oneTrial(i);all.push(...c);if(i<TRIALS-1)await sleep(115)}return clusterTrials(all)}

  function showFailure(stage){
    lastStage=stage;measure.hidden=true;result.hidden=false;resultLabel.textContent=mode==='room'&&stage==='second'?'另一面墙':'墙距';resultQuality.textContent='没有稳定回声';distanceValue.textContent='—';distanceUnit.textContent='';repeatDetail.textContent='多次测试没有落在同一距离';echoDetail.textContent='未采用结果';roomStep.hidden=true;resultActions.hidden=false;again.textContent=mode==='room'&&firstWall&&stage==='second'?'重测另一面':'再测一次';qualityNote.textContent='把手机底边对准面积更大、更平整的墙，调高媒体音量，不要连接耳机，并尽量避开说话声和强噪声。';
  }
  function commonQuality(out){const cm=Math.max(2,Math.round(out.spread*100));return{repeat:`${out.support} / ${TRIALS} 次找到同一回声`,echo:`重复波动约 ±${cm} cm`}}
  function showSuccess(out,stage){
    lastStage=stage;measure.hidden=true;result.hidden=false;const detail=commonQuality(out),echoProcessed=trackSettings.echoCancellation===true;qualityNote.textContent=echoProcessed?'当前浏览器仍然启用了回声消除，结果可能比正常情况更不稳定；重复测量一致时再采用。':'距离来自多次回声的一致结果。软质墙面、窗帘、复杂家具和很嘈杂的房间会降低可靠性。';
    if(mode==='room'&&stage==='first'){
      firstWall=out;resultLabel.textContent='第一面墙';resultQuality.textContent=out.quality;distanceValue.textContent=out.distance.toFixed(2);distanceUnit.textContent='m';repeatDetail.textContent=detail.repeat;echoDetail.textContent=detail.echo;firstWallValue.textContent=formatDistance(out.distance);roomStep.hidden=false;resultActions.hidden=true;return;
    }
    roomStep.hidden=true;resultActions.hidden=false;
    if(mode==='room'&&stage==='second'&&firstWall){
      const total=firstWall.distance+out.distance,spread=firstWall.spread+out.spread,support=Math.min(firstWall.support,out.support);resultLabel.textContent='房间宽度';resultQuality.textContent=support>=4&&spread<=.12?'可用':'参考';distanceValue.textContent=total.toFixed(2);distanceUnit.textContent='m';repeatDetail.textContent=`前墙 ${firstWall.distance.toFixed(2)} m + 后墙 ${out.distance.toFixed(2)} m`;echoDetail.textContent=`合计波动约 ±${Math.max(3,Math.round(spread*100))} cm`;qualityNote.textContent='房间宽度是两次墙距相加。适合两面大致相对、平整的墙；开放门洞、窗帘和复杂反射会影响结果。';again.textContent='重新量房间';return;
    }
    resultLabel.textContent='墙距';resultQuality.textContent=out.quality;distanceValue.textContent=out.distance.toFixed(2);distanceUnit.textContent='m';repeatDetail.textContent=detail.repeat;echoDetail.textContent=detail.echo;again.textContent='再测一次';
  }

  async function startMeasurement(stage='first'){
    if(busy)return;busy=true;setError('');lastStage=stage;result.hidden=true;measure.hidden=false;meter.hidden=false;home.hidden=true;statusTitle.textContent=stage==='second'?'正在测另一面墙':'正在测量';statusSub.textContent='保持手机不动';progressValue.textContent=`1 / ${TRIALS}`;progressText.textContent='正在准备';requestWake();
    try{disconnectAudio();await buildAudio();await sleep(180);const out=await runBatch();disconnectAudio();if(out)showSuccess(out,stage);else showFailure(stage);statusTitle.textContent=out?'测量完成':'没有得到稳定结果';statusSub.textContent=out?'已完成多次回声比对':'可以调整位置后再测'}
    catch(e){disconnectAudio();showFailure(stage);statusTitle.textContent='测量没有完成';statusSub.textContent='检查麦克风权限';if(e?.name==='NotAllowedError')qualityNote.textContent='没有获得麦克风权限。允许麦克风后才能监听回声。';else qualityNote.textContent='当前浏览器没有完成扬声器与麦克风的同时测量。可以重新打开页面再试。'}finally{busy=false;releaseWake()}
  }
  async function close(){busy=false;disconnectAudio();await releaseWake();meter.hidden=true;home.hidden=false;result.hidden=true;measure.hidden=false;firstWall=null;window.scrollTo({top:0,behavior:'instant'})}

  modeChoice.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;localStorage.setItem('echo-mode',mode);firstWall=null;renderMode()};
  start.onclick=()=>{firstWall=null;startMeasurement('first')};measureSecond.onclick=()=>startMeasurement('second');
  again.onclick=()=>{if(mode==='room'&&firstWall&&lastStage==='second')startMeasurement('second');else{if(mode==='room')firstWall=null;startMeasurement('first')}};
  exit.onclick=close;cancel.onclick=close;finish.onclick=close;
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&busy){disconnectAudio();busy=false;showFailure(lastStage);statusTitle.textContent='页面已暂停';statusSub.textContent='本次测量已取消';releaseWake()}});
  window.addEventListener('pagehide',()=>{disconnectAudio();releaseWake()});renderMode();
})();