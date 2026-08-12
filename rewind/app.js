(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error'),listen=$('#listen'),exit=$('#exit');
  const statusTitle=$('#statusTitle'),statusSub=$('#statusSub'),pauseBtn=$('#pauseBtn');
  const windowBtn=$('#windowBtn'),windowValue=$('#windowValue'),modeBtn=$('#modeBtn'),modeValue=$('#modeValue');
  const wave=$('#wave'),retainedValue=$('#retainedValue'),eventHint=$('#eventHint'),tail=$('#tail'),tailValue=$('#tailValue');
  const liveControls=$('#liveControls'),keep=$('#keep'),keepLabel=$('#keepLabel');
  const clip=$('#clip'),clipDuration=$('#clipDuration'),player=$('#player'),backLive=$('#backLive'),save=$('#save'),saveLabel=$('#saveLabel'),deleteClip=$('#deleteClip');
  const wctx=wave.getContext('2d');

  const WINDOWS=[15,30,60,120,300],TAIL_SECONDS=3,MAX_SECONDS=305;
  let selected=Number(localStorage.getItem('rewind-audio-window'))||30;if(!WINDOWS.includes(selected))selected=30;
  let soundMode=localStorage.getItem('rewind-audio-mode')||'voice';if(!['voice','raw'].includes(soundMode))soundMode='voice';

  let stream=null,audio=null,source=null,node=null,silent=null,wake=null;
  let active=false,buffering=false,paused=false,tailing=false,finishing=false,usingWorklet=false;
  let sampleRate=48000,totalSamples=0,chunks=[],levels=[],events=[],capture=null,clipBlob=null,clipUrl='',raf=0,lastDraw=0;
  let baseline=.012,lastEventSample=-Infinity;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function updateControls(){
    windowValue.textContent=selected>=60?`${selected/60} 分钟`:`${selected} 秒`;
    keepLabel.textContent=`留住刚才 ${selected>=60?`${selected/60} 分钟`:`${selected} 秒`}`;
    statusSub.textContent=`最近 ${selected>=60?`${selected/60} 分钟`:`${selected} 秒`}`;
    modeValue.textContent=soundMode==='voice'?'人声':'原声';
  }
  function clearClip(){
    if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}clipBlob=null;player.pause();player.removeAttribute('src');clip.hidden=true;
    save.classList.remove('done');saveLabel.textContent='保存录音';
  }
  function clearBuffer(){
    chunks=[];levels=[];events=[];totalSamples=0;capture=null;tailing=false;finishing=false;baseline=.012;lastEventSample=-Infinity;
    retainedValue.textContent='0.0 秒';eventHint.hidden=true;keep.disabled=true;tail.hidden=true;
  }
  function retainedSeconds(){return Math.min(selected,totalSamples/Math.max(1,sampleRate))}
  function updateRetained(){
    const sec=retainedSeconds();retainedValue.textContent=sec>=60?`${(sec/60).toFixed(sec>=120?1:2)} 分钟`:`${sec.toFixed(1)} 秒`;
    keep.disabled=!active||tailing||!clip.hidden||sec<1.2;
    pauseBtn.textContent=paused?'继续':'暂停';
  }
  function prune(){
    const cutoff=totalSamples-MAX_SECONDS*sampleRate;
    while(chunks.length&&chunks[0].end<=cutoff)chunks.shift();
    const now=totalSamples/sampleRate,levelCut=now-MAX_SECONDS;
    while(levels.length&&levels[0].t<levelCut)levels.shift();
    while(events.length&&events[0].t<levelCut)events.shift();
  }
  function levelOf(data){
    let s=0,n=0;for(let i=0;i<data.length;i+=8){const v=data[i]/32768;s+=v*v;n++}
    return Math.sqrt(s/Math.max(1,n));
  }
  function snapshotParts(seconds){
    const wanted=Math.min(totalSamples,Math.floor(seconds*sampleRate)),start=totalSamples-wanted,parts=[];
    for(const ch of chunks){const chStart=ch.end-ch.data.length;if(ch.end<=start)continue;const from=Math.max(0,start-chStart);parts.push(ch.data.subarray(from))}
    return parts;
  }
  function encodeWavParts(parts,rate){
    const count=parts.reduce((n,p)=>n+p.length,0),ab=new ArrayBuffer(44+count*2),v=new DataView(ab);
    const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
    str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);
    let o=44;for(const p of parts){for(let i=0;i<p.length;i++,o+=2)v.setInt16(o,p[i],true)}
    return {blob:new Blob([ab],{type:'audio/wav'}),count};
  }

  function processChunk(data){
    if(!active||!buffering||!data?.length)return;
    const copy=data instanceof Int16Array?data:new Int16Array(data);totalSamples+=copy.length;chunks.push({data:copy,end:totalSamples});
    const lv=levelOf(copy),t=totalSamples/sampleRate;
    baseline=Math.max(.003,baseline*.985+lv*.015);
    const isEvent=lv>Math.max(.055,baseline*3.6)&&totalSamples-lastEventSample>sampleRate*1.35&&retainedSeconds()>1;
    levels.push({t,v:Math.min(1,lv*7.4)});
    if(isEvent){events.push({t});lastEventSample=totalSamples}
    prune();updateRetained();
    if(capture&&tailing){
      const take=Math.min(capture.remaining,copy.length);
      if(take>0){capture.tail.push(copy.subarray(0,take));capture.remaining-=take;tailValue.textContent=(Math.max(0,capture.remaining/sampleRate)).toFixed(1)}
      if(capture.remaining<=0&&!finishing){finishing=true;setTimeout(finishCapture,0)}
    }
  }

  function startCapture(){
    if(!active||tailing||!clip.hidden||retainedSeconds()<1.2)return;
    capture={pre:snapshotParts(selected),tail:[],remaining:paused?0:Math.floor(TAIL_SECONDS*sampleRate)};
    if(paused){finishCapture();return}
    tailing=true;finishing=false;keep.disabled=true;pauseBtn.disabled=true;tail.hidden=false;tailValue.textContent=TAIL_SECONDS.toFixed(1);statusTitle.textContent='正在补尾音';
  }
  function finishCapture(){
    if(!capture)return;
    const result=encodeWavParts([...capture.pre,...capture.tail],sampleRate);clipBlob=result.blob;
    if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(clipBlob);player.src=clipUrl;
    const duration=result.count/sampleRate;clipDuration.textContent=duration>=60?`${(duration/60).toFixed(2)} 分钟`:`${duration.toFixed(1)} 秒`;
    tail.hidden=true;tailing=false;finishing=false;capture=null;buffering=false;paused=false;liveControls.hidden=true;clip.hidden=false;statusTitle.textContent='刚才已经留下';pauseBtn.disabled=true;keep.disabled=true;
  }

  function draw(now=performance.now()){
    raf=requestAnimationFrame(draw);if(now-lastDraw<45)return;lastDraw=now;
    const dpr=Math.min(2,window.devicePixelRatio||1),r=wave.getBoundingClientRect(),ww=Math.max(2,Math.round(r.width*dpr)),hh=Math.max(2,Math.round(r.height*dpr));if(wave.width!==ww||wave.height!==hh){wave.width=ww;wave.height=hh}
    wctx.clearRect(0,0,ww,hh);const mid=hh*.5,left=ww*.07,right=ww*.93,width=right-left,nowSec=totalSamples/Math.max(1,sampleRate),from=nowSec-selected;
    wctx.lineWidth=Math.max(1,dpr);wctx.strokeStyle='#2448ff';wctx.beginPath();
    const visible=levels.filter(p=>p.t>=from),step=Math.max(1,Math.ceil(visible.length/190));
    if(visible.length){for(let i=0;i<visible.length;i+=step){const p=visible[i],x=left+Math.max(0,Math.min(1,(p.t-from)/selected))*width,a=Math.max(1.3*dpr,p.v*hh*.29);wctx.moveTo(x,mid-a);wctx.lineTo(x,mid+a)}}else{wctx.moveTo(left,mid);wctx.lineTo(right,mid)}wctx.stroke();
    wctx.fillStyle='#11120f';for(const e of events){if(e.t<from)continue;const x=left+Math.max(0,Math.min(1,(e.t-from)/selected))*width;wctx.fillRect(x-1.5*dpr,mid-4*dpr,3*dpr,8*dpr)}
    const last=events.at(-1);if(last&&last.t>=from){eventHint.hidden=false;eventHint.textContent=`突发声 · ${Math.max(0,nowSec-last.t).toFixed(1)} 秒前`}else eventHint.hidden=true;
  }

  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function audioConstraints(){
    const supported=navigator.mediaDevices?.getSupportedConstraints?.()||{};
    const c={channelCount:1};if(supported.sampleRate)c.sampleRate={ideal:48000};
    if(soundMode==='voice'){
      if(supported.echoCancellation)c.echoCancellation=true;if(supported.noiseSuppression)c.noiseSuppression=true;if(supported.autoGainControl)c.autoGainControl=true;if(supported.voiceIsolation)c.voiceIsolation=true;
    }else{
      if(supported.echoCancellation)c.echoCancellation=false;if(supported.noiseSuppression)c.noiseSuppression=false;if(supported.autoGainControl)c.autoGainControl=false;if(supported.voiceIsolation)c.voiceIsolation=false;
    }
    return c;
  }
  function disconnectAudio(){
    if(node){try{node.port&&(node.port.onmessage=null)}catch{}try{node.disconnect()}catch{}node=null}
    if(source){try{source.disconnect()}catch{}source=null}if(silent){try{silent.disconnect()}catch{}silent=null}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}usingWorklet=false;
  }
  async function buildAudio(){
    stream=await navigator.mediaDevices.getUserMedia({audio:audioConstraints(),video:false});
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('audio-context');audio=new AC({latencyHint:'interactive'});await audio.resume();sampleRate=audio.sampleRate||48000;source=audio.createMediaStreamSource(stream);silent=audio.createGain();silent.gain.value=0;
    if(audio.audioWorklet&&window.AudioWorkletNode){
      try{
        await audio.audioWorklet.addModule('./pcm-worklet.js?v=202608121316');
        node=new AudioWorkletNode(audio,'rewind-pcm',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});node.port.onmessage=e=>processChunk(new Int16Array(e.data));source.connect(node);node.connect(silent);silent.connect(audio.destination);usingWorklet=true;return;
      }catch{if(node){try{node.disconnect()}catch{}node=null}}
    }
    node=audio.createScriptProcessor(4096,1,1);node.onaudioprocess=e=>{const input=e.inputBuffer.getChannelData(0),out=new Int16Array(input.length);for(let i=0;i<input.length;i++){const x=Math.max(-1,Math.min(1,input[i]));out[i]=x<0?Math.round(x*32768):Math.round(x*32767)}processChunk(out)};source.connect(node);node.connect(silent);silent.connect(audio.destination);
  }

  async function open(){
    setError('');if(!navigator.mediaDevices?.getUserMedia){setError('当前浏览器没有提供麦克风访问能力。');return}start.disabled=true;
    try{
      await buildAudio();active=true;buffering=true;paused=false;home.hidden=true;listen.hidden=false;liveControls.hidden=false;clearClip();clearBuffer();buffering=true;statusTitle.textContent='正在保留';pauseBtn.disabled=false;updateControls();updateRetained();requestWake();cancelAnimationFrame(raf);draw();
    }catch(e){disconnectAudio();active=false;setError(e?.name==='NotAllowedError'?'没有获得麦克风权限。请允许麦克风后再试。':'麦克风没有开始工作。可以检查浏览器权限后再试。')}
    finally{start.disabled=false}
  }
  async function close(){
    active=false;buffering=false;paused=false;tailing=false;disconnectAudio();cancelAnimationFrame(raf);raf=0;clearBuffer();clearClip();await releaseWake();listen.hidden=true;home.hidden=false;liveControls.hidden=false;statusTitle.textContent='正在保留';pauseBtn.disabled=false;window.scrollTo({top:0,behavior:'instant'});
  }
  function cycleWindow(){
    if(tailing||!clip.hidden)return;const i=WINDOWS.indexOf(selected);selected=WINDOWS[(i+1)%WINDOWS.length];localStorage.setItem('rewind-audio-window',String(selected));updateControls();updateRetained();
  }
  async function switchMode(){
    if(tailing||!clip.hidden)return;modeBtn.disabled=true;buffering=false;statusTitle.textContent='正在切换声音';soundMode=soundMode==='voice'?'raw':'voice';localStorage.setItem('rewind-audio-mode',soundMode);updateControls();
    try{disconnectAudio();await buildAudio();clearBuffer();paused=false;buffering=true;statusTitle.textContent='正在保留';pauseBtn.disabled=false;requestWake()}catch{statusTitle.textContent='麦克风需要重新打开';active=false;listen.hidden=true;home.hidden=false;setError('切换声音模式时麦克风中断了。重新打开即可。')}finally{modeBtn.disabled=false;updateRetained()}
  }
  function togglePause(){
    if(!active||tailing||!clip.hidden)return;paused=!paused;buffering=!paused;statusTitle.textContent=paused?'已暂停':'正在保留';updateRetained();
  }
  function resetToLive(){
    player.pause();clearClip();clearBuffer();paused=false;buffering=true;liveControls.hidden=false;statusTitle.textContent='正在保留';pauseBtn.disabled=false;try{audio?.resume()}catch{}requestWake();updateRetained();
  }
  function discard(){resetToLive()}
  async function deliver(){
    if(!clipBlob)return;const name=`刚才录音-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`,file=new File([clipBlob],name,{type:'audio/wav'});
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}
    const u=URL.createObjectURL(clipBlob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1600);
  }
  async function saveClip(){if(!clipBlob)return;save.disabled=true;try{await deliver();save.classList.add('done');saveLabel.textContent='已保存';setTimeout(()=>{save.classList.remove('done');saveLabel.textContent='保存录音'},1300)}catch{}finally{save.disabled=false}}

  start.onclick=open;exit.onclick=close;pauseBtn.onclick=togglePause;windowBtn.onclick=cycleWindow;modeBtn.onclick=switchMode;keep.onclick=startCapture;backLive.onclick=resetToLive;save.onclick=saveClip;deleteClip.onclick=discard;
  document.addEventListener('visibilitychange',async()=>{
    if(!active)return;
    if(document.hidden){await releaseWake();if(clip.hidden){buffering=false;paused=true;clearBuffer();statusTitle.textContent='页面已暂停';updateRetained()}}
    else{await requestWake();if(clip.hidden){try{await audio?.resume()}catch{}paused=false;buffering=true;clearBuffer();statusTitle.textContent='重新开始保留';updateRetained()}}
  });
  window.addEventListener('pagehide',()=>{active=false;buffering=false;disconnectAudio();clearBuffer();clearClip();releaseWake()});
  updateControls();
})();