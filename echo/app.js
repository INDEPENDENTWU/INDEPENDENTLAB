(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),modeChoice=$('#modeChoice'),start=$('#start'),startLabel=$('#startLabel'),error=$('#error');
  const meter=$('#meter'),exit=$('#exit'),cancel=$('#cancel'),statusTitle=$('#statusTitle'),statusSub=$('#statusSub'),measure=$('.measure');
  const progressValue=$('#progressValue'),progressText=$('#progressText'),result=$('#result'),resultLabel=$('#resultLabel'),resultQuality=$('#resultQuality');
  const distanceValue=$('#distanceValue'),distanceUnit=$('#distanceUnit'),repeatDetail=$('#repeatDetail'),echoDetail=$('#echoDetail'),qualityNote=$('#qualityNote');
  const roomStep=$('#roomStep'),firstWallValue=$('#firstWallValue'),measureSecond=$('#measureSecond'),resultActions=$('#resultActions'),again=$('#again'),finish=$('#finish');
  const calibrateToggle=$('#calibrateToggle'),calibrationPanel=$('#calibrationPanel'),calibrationInput=$('#calibrationInput'),saveCalibrationBtn=$('#saveCalibration'),calibrationState=$('#calibrationState');

  const TRIALS=7,SOUND_SPEED=343.2,PRE_MS=85,POST_MS=285,MIN_DISTANCE=.55,MAX_DISTANCE=5.5;
  const PROBE_MS=26,PROBE_GAIN=.34,DOWNSAMPLE=3;
  let mode=localStorage.getItem('echo-mode')||'wall';if(!['wall','room'].includes(mode))mode='wall';
  let stream=null,audio=null,source=null,node=null,silent=null,wake=null,captureActive=false,captureParts=[],probes=null,usingWorklet=false;
  let firstWall=null,lastStage='first',busy=false,trackSettings={},outputChannel=0,currentEcho=null;
  let calibration=null;try{calibration=JSON.parse(localStorage.getItem('echo-calibration-v2')||'null')}catch{}

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function setError(t=''){error.hidden=!t;error.textContent=t}
  function median(a){if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
  function formatDistance(m,digits=2){if(!Number.isFinite(m))return'—';return m<1?`${Math.round(m*100)} cm`:`${m.toFixed(digits)} m`}
  function renderMode(){modeChoice.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));startLabel.textContent=mode==='wall'?'测一下墙距':'量一下房间宽度'}
  async function requestWake(){if(document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function disconnectAudio(){
    captureActive=false;captureParts=[];
    if(node){try{node.port&&(node.port.onmessage=null)}catch{}try{node.onaudioprocess=null}catch{}try{node.disconnect()}catch{}node=null}
    if(source){try{source.disconnect()}catch{}source=null}if(silent){try{silent.disconnect()}catch{}silent=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}
    usingWorklet=false;probes=null;
  }

  function buildProbe(kind){
    const rate=audio.sampleRate,n=Math.max(256,Math.round(rate*PROBE_MS/1000)),mono=new Float32Array(n);
    const up=kind==='up',f0=up?1800:6900,f1=up?6900:1800;let phase=0;
    for(let i=0;i<n;i++){
      const x=i/(n-1),f=f0+(f1-f0)*x,win=.5-.5*Math.cos(2*Math.PI*x);phase+=2*Math.PI*f/rate;mono[i]=Math.sin(phase)*win;
    }
    const buffers=[];
    for(let channel=0;channel<2;channel++){
      const b=audio.createBuffer(2,n,rate);b.getChannelData(channel).set(mono);buffers.push(b);
    }
    return{mono,buffers};
  }

  async function buildAudio(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
    const supported=navigator.mediaDevices.getSupportedConstraints?.()||{},c={channelCount:1};
    if(supported.echoCancellation)c.echoCancellation=false;if(supported.noiseSuppression)c.noiseSuppression=false;if(supported.autoGainControl)c.autoGainControl=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:c,video:false});
    const track=stream.getAudioTracks()[0];
    try{
      const exact={};if(supported.echoCancellation)exact.echoCancellation=false;if(supported.noiseSuppression)exact.noiseSuppression=false;if(supported.autoGainControl)exact.autoGainControl=false;
      if(Object.keys(exact).length)await track.applyConstraints(exact);
    }catch{}
    trackSettings=track?.getSettings?.()||{};
    if(trackSettings.echoCancellation===true)throw new Error('echo-processing');
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('unsupported');audio=new AC({latencyHint:'interactive'});await audio.resume();source=audio.createMediaStreamSource(stream);silent=audio.createGain();silent.gain.value=0;
    if(audio.audioWorklet&&window.AudioWorkletNode){
      try{await audio.audioWorklet.addModule('./capture-worklet.js?v=202608121510');node=new AudioWorkletNode(audio,'echo-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});node.port.onmessage=e=>{if(captureActive)captureParts.push(new Float32Array(e.data))};source.connect(node);node.connect(silent);silent.connect(audio.destination);usingWorklet=true}catch{node=null}
    }
    if(!node){
      node=audio.createScriptProcessor(2048,1,1);node.onaudioprocess=e=>{const out=e.outputBuffer.getChannelData(0);out.fill(0);if(!captureActive)return;const input=e.inputBuffer.getChannelData(0),copy=new Float32Array(input.length);copy.set(input);captureParts.push(copy)};source.connect(node);node.connect(silent);silent.connect(audio.destination)
    }
    probes={up:buildProbe('up'),down:buildProbe('down')};
  }

  function combine(parts){const n=parts.reduce((s,p)=>s+p.length,0),out=new Float32Array(n);let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out}
  function playProbe(kind,channel=outputChannel,gain=PROBE_GAIN){const s=audio.createBufferSource(),g=audio.createGain();s.buffer=probes[kind].buffers[channel];g.gain.value=gain;s.connect(g);g.connect(audio.destination);s.start()}
  function downsample(a,f=DOWNSAMPLE){const n=Math.floor(a.length/f),out=new Float32Array(n);for(let i=0;i<n;i++){let sum=0;for(let j=0;j<f;j++)sum+=a[i*f+j];out[i]=sum/f}return out}
  function templateOf(kind){const a=downsample(probes[kind].mono),out=new Float32Array(a.length);let mean=0;for(const v of a)mean+=v;mean/=a.length;let energy=0;for(let i=0;i<a.length;i++){out[i]=a[i]-mean;energy+=out[i]*out[i]}return{a:out,energy:Math.max(energy,1e-9)}}
  function profile(raw,kind){
    const rec=downsample(raw),tpl=templateOf(kind),limit=rec.length-tpl.a.length;if(limit<10)return null;
    const prefix=new Float64Array(rec.length+1);for(let i=0;i<rec.length;i++)prefix[i+1]=prefix[i]+rec[i]*rec[i];
    const scores=new Float32Array(limit+1);let best=0,bestAt=0;
    for(let o=0;o<=limit;o++){
      let dot=0;for(let i=0;i<tpl.a.length;i++)dot+=rec[o+i]*tpl.a[i];
      const e=Math.max(1e-10,prefix[o+tpl.a.length]-prefix[o]),s=Math.abs(dot)/Math.sqrt(e*tpl.energy);scores[o]=s;if(s>best){best=s;bestAt=o}
    }
    return{scores,direct:{at:bestAt,score:best},rate:audio.sampleRate/DOWNSAMPLE};
  }
  function directScore(raw,kind){const p=profile(raw,kind);return p?.direct?.score||0}

  function analyzeTrial(raw,trial,kind){
    const p=profile(raw,kind);if(!p||p.direct.score<.09)return[];
    const {scores,direct,rate}=p,minGap=Math.ceil((MIN_DISTANCE*2/SOUND_SPEED)*rate),maxGap=Math.floor((MAX_DISTANCE*2/SOUND_SPEED)*rate);
    const start=Math.max(direct.at+minGap,3),end=Math.min(scores.length-4,direct.at+maxGap);if(end<=start)return[];
    const region=[];for(let i=start;i<=end;i++)region.push(scores[i]);const floor=median(region),threshold=Math.max(.045,(Number.isFinite(floor)?floor:0)*2.35,direct.score*.055);
    const peaks=[];
    for(let i=start+3;i<=end-3;i++){
      const s=scores[i];if(s<threshold)continue;let localMax=true;for(let j=-3;j<=3;j++){if(j&&scores[i+j]>s){localMax=false;break}}if(!localMax)continue;
      let shoulder=0,n=0;for(let j=8;j<=26;j+=3){if(i-j>=start){shoulder+=scores[i-j];n++}if(i+j<=end){shoulder+=scores[i+j];n++}}shoulder/=Math.max(1,n);
      const prominence=s-Math.max(floor||0,shoulder),delta=i-direct.at,dist=delta/rate*SOUND_SPEED/2;if(prominence<.012||dist<MIN_DISTANCE||dist>MAX_DISTANCE)continue;
      peaks.push({trial,kind,dist,score:s,prominence,rel:s/Math.max(.001,direct.score)});
    }
    peaks.sort((a,b)=>(b.prominence*1.8+b.score)-(a.prominence*1.8+a.score));const picked=[];
    for(const q of peaks){if(picked.some(x=>Math.abs(x.dist-q.dist)<.075))continue;picked.push(q);if(picked.length>=7)break}return picked;
  }

  function buildClusters(all){
    const clusters=[];
    for(const seed of all){
      const tol=Math.max(.065,seed.dist*.028),chosen=[];
      for(let t=0;t<TRIALS;t++){const same=all.filter(x=>x.trial===t&&Math.abs(x.dist-seed.dist)<=tol).sort((a,b)=>(b.prominence*2+b.score)-(a.prominence*2+a.score))[0];if(same)chosen.push(same)}
      if(chosen.length<5)continue;const kinds=new Set(chosen.map(x=>x.kind));if(kinds.size<2)continue;
      const d=median(chosen.map(x=>x.dist)),spread=median(chosen.map(x=>Math.abs(x.dist-d)));if(spread>Math.max(.065,d*.035))continue;
      const meanProm=chosen.reduce((s,x)=>s+x.prominence,0)/chosen.length,meanRel=chosen.reduce((s,x)=>s+x.rel,0)/chosen.length;
      const score=chosen.length*24+kinds.size*8+meanProm*45+meanRel*3-spread*90-d*.15;
      if(clusters.some(c=>Math.abs(c.rawDistance-d)<Math.max(.08,d*.025)))continue;
      clusters.push({rawDistance:d,spread,support:chosen.length,kinds:kinds.size,meanProm,meanRel,score});
    }
    return clusters.sort((a,b)=>b.score-a.score);
  }
  function selectEcho(all){
    const clusters=buildClusters(all);if(!clusters.length)return{ok:false,reason:'none'};
    const top=clusters[0],second=clusters[1];
    if(second&&second.support>=5&&Math.abs(second.rawDistance-top.rawDistance)>.20&&second.score>top.score-9)return{ok:false,reason:'ambiguous',clusters:clusters.slice(0,3)};
    if(top.support<5||top.spread>Math.max(.055,top.rawDistance*.03))return{ok:false,reason:'unstable'};
    return{ok:true,...top};
  }

  async function captureProbe(kind,channel=outputChannel,gain=PROBE_GAIN,post=POST_MS){captureParts=[];captureActive=true;await sleep(PRE_MS);playProbe(kind,channel,gain);await sleep(post);captureActive=false;const raw=combine(captureParts);captureParts=[];return raw}
  async function chooseOutputChannel(){
    progressValue.textContent='··';progressText.textContent='正在准备声音';
    const left=await captureProbe('up',0,.22,180);await sleep(90);const right=await captureProbe('up',1,.22,180);
    const a=directScore(left,'up'),b=directScore(right,'up');outputChannel=b>a*1.08?1:0;await sleep(130);
  }
  async function oneTrial(i){const kind=i%2===0?'up':'down';progressValue.textContent=`${i+1} / ${TRIALS}`;progressText.textContent='正在比对回声';const raw=await captureProbe(kind);return analyzeTrial(raw,i,kind)}
  async function runBatch(){await chooseOutputChannel();const all=[];for(let i=0;i<TRIALS;i++){const c=await oneTrial(i);all.push(...c);if(i<TRIALS-1)await sleep(105)}return selectEcho(all)}

  function correctionFor(raw){
    if(!calibration||!Number.isFinite(calibration.offset)||Math.abs(calibration.offset)>.5)return{distance:raw,calibrated:false};
    return{distance:raw+calibration.offset,calibrated:true};
  }
  function showCalibrationAvailable(show){if(!calibrateToggle)return;calibrateToggle.hidden=!show;calibrationPanel&&(calibrationPanel.hidden=true)}
  function calibrationText(){if(!calibration)return'未校准这台手机';const cm=Math.round(calibration.offset*100);return`已保存本机校准 ${cm>=0?'+':''}${cm} cm`}
  function setDistanceDisplay(m,calibrated){distanceValue.textContent=`≈${m.toFixed(calibrated?2:2)}`;distanceUnit.textContent='m'}

  function showFailure(stage,out={reason:'none'}){
    currentEcho=null;lastStage=stage;measure.hidden=true;result.hidden=false;resultLabel.textContent=mode==='room'&&stage==='second'?'另一面墙':'墙距';resultQuality.textContent=out.reason==='ambiguous'?'有多个反射':'没有可信结果';distanceValue.textContent='—';distanceUnit.textContent='';repeatDetail.textContent=out.reason==='ambiguous'?'检测到多个重复出现的反射距离':'多次测量没有形成同一反射';echoDetail.textContent='未采用结果';roomStep.hidden=true;resultActions.hidden=false;again.textContent=mode==='room'&&firstWall&&stage==='second'?'重测另一面':'再测一次';showCalibrationAvailable(false);
    qualityNote.textContent=out.reason==='ambiguous'?'房间里有不止一个稳定反射，无法确认哪一个才是目标墙。换到更空的位置、缩短与目标墙的距离或避开桌面和大件家具后再测。':'让手机平放并保持不动，扬声器不要贴近耳朵；媒体音量保持中等偏高，不连接耳机，尽量对着面积较大的硬墙。';
  }
  function commonQuality(out){const cm=Math.max(2,Math.round(out.spread*100));return{repeat:`${out.support} / ${TRIALS} 次落在同一反射`,echo:`重复波动约 ±${cm} cm`}}
  function showSuccess(out,stage){
    currentEcho=out;lastStage=stage;measure.hidden=true;result.hidden=false;const detail=commonQuality(out),corrected=correctionFor(out.rawDistance),echoProcessed=trackSettings.echoCancellation===true;
    if(mode==='room'&&stage==='first'){
      firstWall={...out,distance:corrected.distance,calibrated:corrected.calibrated};resultLabel.textContent='第一面墙';resultQuality.textContent=`${out.support}/${TRIALS} 次一致`;setDistanceDisplay(corrected.distance,corrected.calibrated);repeatDetail.textContent=detail.repeat;echoDetail.textContent=corrected.calibrated?`${detail.echo} · 已用本机校准`:`${detail.echo} · 未做绝对校准`;firstWallValue.textContent=formatDistance(corrected.distance);roomStep.hidden=false;resultActions.hidden=true;showCalibrationAvailable(false);qualityNote.textContent='重复一致只表示同一个反射被反复找到，不等于绝对距离已经校准。房间家具、地面和天花板仍可能形成其他反射。';return;
    }
    roomStep.hidden=true;resultActions.hidden=false;
    if(mode==='room'&&stage==='second'&&firstWall){
      const second=corrected.distance,total=firstWall.distance+second,spread=firstWall.spread+out.spread;resultLabel.textContent='房间宽度';resultQuality.textContent=`两面都重复一致`;setDistanceDisplay(total,firstWall.calibrated&&corrected.calibrated);repeatDetail.textContent=`前墙 ${firstWall.distance.toFixed(2)} m + 后墙 ${second.toFixed(2)} m`;echoDetail.textContent=`两次重复波动合计约 ±${Math.max(3,Math.round(spread*100))} cm`;qualityNote.textContent='房间宽度来自两次墙距相加。两侧任何一次选错反射都会影响结果，因此复杂房间仍应和真尺交叉验证。';again.textContent='重新量房间';showCalibrationAvailable(false);return;
    }
    resultLabel.textContent='墙距';resultQuality.textContent=`${out.support}/${TRIALS} 次一致`;setDistanceDisplay(corrected.distance,corrected.calibrated);repeatDetail.textContent=detail.repeat;echoDetail.textContent=corrected.calibrated?`${detail.echo} · 已用本机校准`:`${detail.echo} · 未做绝对校准`;again.textContent='再测一次';showCalibrationAvailable(true);
    qualityNote.textContent=echoProcessed?'当前浏览器仍启用了回声消除，因此本次结果不应采用。':`新版直接用已知编码声恢复反射峰；${calibrationText()}。重复一致不代表绝对精度，第一次建议用真尺做一次交叉验证。`;
  }

  function saveCalibration(){
    if(!currentEcho||!calibrationInput)return;const actual=Number(calibrationInput.value);if(!(actual>=MIN_DISTANCE&&actual<=MAX_DISTANCE)){calibrationState.textContent=`请输入 ${MIN_DISTANCE.toFixed(2)}–${MAX_DISTANCE.toFixed(1)} m 的真实墙距。`;return}
    if(currentEcho.support<5||currentEcho.spread>.08){calibrationState.textContent='这次回声本身不够一致，先重新测量再校准。';return}
    const offset=actual-currentEcho.rawDistance;if(Math.abs(offset)>.5){calibrationState.textContent='当前结果与真实值差得过大，不适合写入设备校准；这更像是选到了错误反射。';return}
    calibration={offset,actual,raw:currentEcho.rawDistance,savedAt:Date.now()};try{localStorage.setItem('echo-calibration-v2',JSON.stringify(calibration))}catch{}
    const corrected=correctionFor(currentEcho.rawDistance);setDistanceDisplay(corrected.distance,true);echoDetail.textContent=`${commonQuality(currentEcho).echo} · 已用本机校准`;calibrationState.textContent=`已保存。之后同一台手机会补偿 ${offset>=0?'+':''}${Math.round(offset*100)} cm。`;qualityNote.textContent='设备校准主要修正较稳定的系统偏差，不能修正家具、多墙反射造成的选峰错误。';
  }

  async function startMeasurement(stage='first'){
    if(busy)return;busy=true;setError('');lastStage=stage;result.hidden=true;measure.hidden=false;meter.hidden=false;home.hidden=true;statusTitle.textContent=stage==='second'?'正在测另一面墙':'正在测量';statusSub.textContent='保持手机不动';progressValue.textContent='··';progressText.textContent='正在准备';requestWake();
    try{
      disconnectAudio();await buildAudio();await sleep(520);const out=await runBatch();disconnectAudio();if(out.ok)showSuccess(out,stage);else showFailure(stage,out);statusTitle.textContent=out.ok?'测量完成':'没有采用结果';statusSub.textContent=out.ok?'已完成多次编码声比对':'调整位置后再测'
    }catch(e){disconnectAudio();showFailure(stage,{reason:'none'});statusTitle.textContent='测量没有完成';statusSub.textContent='检查麦克风权限';if(e?.name==='NotAllowedError')qualityNote.textContent='没有获得麦克风权限。允许麦克风后才能监听回声。';else if(e?.message==='echo-processing')qualityNote.textContent='这台浏览器仍在主动消除扬声器回声，正好会删除测距需要的信号，因此本次不输出距离。';else qualityNote.textContent='当前浏览器没有完成可用的扬声器与麦克风同步测量。重新打开页面后可以再试。'
    }finally{busy=false;releaseWake()}
  }
  async function close(){busy=false;disconnectAudio();await releaseWake();meter.hidden=true;home.hidden=false;result.hidden=true;measure.hidden=false;firstWall=null;currentEcho=null;window.scrollTo({top:0,behavior:'instant'})}

  modeChoice.onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;localStorage.setItem('echo-mode',mode);firstWall=null;renderMode()};
  start.onclick=()=>{firstWall=null;startMeasurement('first')};measureSecond.onclick=()=>startMeasurement('second');
  again.onclick=()=>{if(mode==='room'&&firstWall&&lastStage==='second')startMeasurement('second');else{if(mode==='room')firstWall=null;startMeasurement('first')}};
  calibrateToggle&&(calibrateToggle.onclick=()=>{calibrationPanel.hidden=!calibrationPanel.hidden;if(!calibrationPanel.hidden){calibrationInput.focus();calibrationState.textContent=calibrationText()}});
  saveCalibrationBtn&&(saveCalibrationBtn.onclick=saveCalibration);
  exit.onclick=close;cancel.onclick=close;finish.onclick=close;
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&busy){disconnectAudio();busy=false;showFailure(lastStage,{reason:'none'});statusTitle.textContent='页面已暂停';statusSub.textContent='本次测量已取消';releaseWake()}});
  window.addEventListener('pagehide',()=>{disconnectAudio();releaseWake()});renderMode();
})();