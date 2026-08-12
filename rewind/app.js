(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error'),listen=$('#listen'),exit=$('#exit'),statusTitle=$('#statusTitle'),statusSub=$('#statusSub');
  const windowBtn=$('#windowBtn'),windowValue=$('#windowValue'),wave=$('#wave'),retainedValue=$('#retainedValue'),tail=$('#tail'),tailValue=$('#tailValue');
  const liveControls=$('#liveControls'),keep=$('#keep'),keepLabel=$('#keepLabel'),clip=$('#clip'),clipDuration=$('#clipDuration'),player=$('#player'),backLive=$('#backLive'),save=$('#save'),saveLabel=$('#saveLabel');
  const wctx=wave.getContext('2d');
  const WINDOWS=[15,30,60],TAIL_SECONDS=3,MAX_SECONDS=64;
  let selected=Number(localStorage.getItem('rewind-audio-window'))||30;if(!WINDOWS.includes(selected))selected=30;
  let stream=null,audio=null,source=null,processor=null,silent=null,wake=null,active=false,buffering=false,tailing=false,finishing=false;
  let sampleRate=44100,totalSamples=0,chunks=[],levels=[],capture=null,clipBlob=null,clipUrl='',raf=0;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function updateWindow(){windowValue.textContent=`${selected} 秒`;keepLabel.textContent=`保存刚才 ${selected} 秒`;statusSub.textContent=`最近 ${selected} 秒`}
  function clearClip(){if(clipUrl){URL.revokeObjectURL(clipUrl);clipUrl=''}clipBlob=null;player.removeAttribute('src');clip.hidden=true;save.classList.remove('done');saveLabel.textContent='保存录音'}
  function clearBuffer(){chunks=[];levels=[];totalSamples=0;capture=null;tailing=false;finishing=false;retainedValue.textContent='0.0 秒';keep.disabled=true;tail.hidden=true}
  function retainedSeconds(){return Math.min(selected,totalSamples/Math.max(1,sampleRate))}
  function updateRetained(){const sec=retainedSeconds();retainedValue.textContent=`${sec.toFixed(1)} 秒`;keep.disabled=!active||!buffering||tailing||sec<1.2}
  function prune(){const cutoff=totalSamples-MAX_SECONDS*sampleRate;while(chunks.length&&chunks[0].end<=cutoff)chunks.shift()}
  function rms(data){let s=0,n=0;for(let i=0;i<data.length;i+=8){const v=data[i];s+=v*v;n++}return Math.min(1,Math.sqrt(s/Math.max(1,n))*5.2)}
  function combine(list,total=null){const len=total??list.reduce((n,a)=>n+a.length,0),out=new Float32Array(len);let at=0;for(const a of list){const take=Math.min(a.length,len-at);if(take<=0)break;out.set(take===a.length?a:a.subarray(0,take),at);at+=take}return at===out.length?out:out.slice(0,at)}
  function lastSamples(seconds){const wanted=Math.min(totalSamples,Math.floor(seconds*sampleRate)),start=totalSamples-wanted,parts=[];for(const ch of chunks){const chStart=ch.end-ch.data.length;if(ch.end<=start)continue;const from=Math.max(0,start-chStart);parts.push(ch.data.slice(from))}return combine(parts,wanted)}
  function encodeWav(samples,rate){const bytes=44+samples.length*2,ab=new ArrayBuffer(bytes),v=new DataView(ab);const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};str(0,'RIFF');v.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,samples.length*2,true);let o=44;for(let i=0;i<samples.length;i++,o+=2){const x=Math.max(-1,Math.min(1,samples[i]));v.setInt16(o,x<0?x*0x8000:x*0x7fff,true)}return new Blob([ab],{type:'audio/wav'})}

  function processAudio(e){
    if(!active||!buffering)return;
    const input=e.inputBuffer.getChannelData(0),data=new Float32Array(input);totalSamples+=data.length;chunks.push({data,end:totalSamples});prune();
    levels.push(rms(data));if(levels.length>150)levels.shift();updateRetained();
    if(capture&&tailing){const take=Math.min(capture.remaining,data.length);if(take>0){capture.tail.push(data.slice(0,take));capture.remaining-=take;tailValue.textContent=(Math.max(0,capture.remaining/sampleRate)).toFixed(1)}if(capture.remaining<=0&&!finishing){finishing=true;setTimeout(finishCapture,0)}}
  }

  function startCapture(){
    if(!active||!buffering||tailing||retainedSeconds()<1.2)return;
    const pre=lastSamples(selected);capture={pre,tail:[],remaining:Math.floor(TAIL_SECONDS*sampleRate)};tailing=true;finishing=false;keep.disabled=true;tail.hidden=false;tailValue.textContent=TAIL_SECONDS.toFixed(1);statusTitle.textContent='正在补尾音';
  }

  function finishCapture(){
    if(!capture)return;const all=combine([capture.pre,...capture.tail]);clipBlob=encodeWav(all,sampleRate);if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=URL.createObjectURL(clipBlob);player.src=clipUrl;clipDuration.textContent=`${(all.length/sampleRate).toFixed(1)} 秒`;tail.hidden=true;tailing=false;finishing=false;capture=null;buffering=false;liveControls.hidden=true;clip.hidden=false;statusTitle.textContent='刚才已经留下';keep.disabled=true;
  }

  function draw(){
    const dpr=Math.min(2,window.devicePixelRatio||1),r=wave.getBoundingClientRect(),ww=Math.max(2,Math.round(r.width*dpr)),hh=Math.max(2,Math.round(r.height*dpr));if(wave.width!==ww||wave.height!==hh){wave.width=ww;wave.height=hh}wctx.clearRect(0,0,ww,hh);const mid=hh*.5,left=ww*.07,right=ww*.93,width=right-left;wctx.lineWidth=Math.max(1,dpr);wctx.strokeStyle='#2448ff';wctx.beginPath();if(levels.length){for(let i=0;i<levels.length;i++){const x=right-(levels.length-1-i)/149*width,a=Math.max(1.5*dpr,levels[i]*hh*.26);wctx.moveTo(x,mid-a);wctx.lineTo(x,mid+a)}}else{wctx.moveTo(left,mid);wctx.lineTo(right,mid)}wctx.stroke();raf=requestAnimationFrame(draw)
  }

  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  async function open(){
    setError('');if(!navigator.mediaDevices?.getUserMedia){setError('当前浏览器没有提供麦克风访问能力。');return}start.disabled=true;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('audio-context');audio=new AC();await audio.resume();sampleRate=audio.sampleRate||44100;source=audio.createMediaStreamSource(stream);processor=audio.createScriptProcessor(4096,1,1);silent=audio.createGain();silent.gain.value=0;processor.onaudioprocess=processAudio;source.connect(processor);processor.connect(silent);silent.connect(audio.destination);
      active=true;buffering=true;home.hidden=true;listen.hidden=false;liveControls.hidden=false;clearClip();clearBuffer();buffering=true;statusTitle.textContent='正在保留';updateWindow();updateRetained();requestWake();cancelAnimationFrame(raf);draw();
    }catch(e){stopAudio();setError(e?.name==='NotAllowedError'?'没有获得麦克风权限。请允许麦克风后再试。':'麦克风没有开始工作。可以检查浏览器权限后再试。')}
    finally{start.disabled=false}
  }

  function stopAudio(){active=false;buffering=false;tailing=false;if(processor){processor.onaudioprocess=null;try{processor.disconnect()}catch{}processor=null}if(source){try{source.disconnect()}catch{}source=null}if(silent){try{silent.disconnect()}catch{}silent=null}if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}if(audio){try{audio.close()}catch{}audio=null}cancelAnimationFrame(raf);raf=0}
  async function close(){stopAudio();clearBuffer();clearClip();await releaseWake();listen.hidden=true;home.hidden=false;liveControls.hidden=false;statusTitle.textContent='正在保留';window.scrollTo({top:0,behavior:'instant'})}
  function cycleWindow(){if(tailing||!buffering)return;const i=WINDOWS.indexOf(selected);selected=WINDOWS[(i+1)%WINDOWS.length];localStorage.setItem('rewind-audio-window',String(selected));updateWindow();updateRetained()}
  async function resumeBuffer(){if(!active)return;player.pause();clearClip();clearBuffer();buffering=true;liveControls.hidden=false;statusTitle.textContent='正在保留';try{await audio?.resume()}catch{}requestWake();updateRetained()}
  async function deliver(){if(!clipBlob)return;const name=`刚才录音-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`,file=new File([clipBlob],name,{type:'audio/wav'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}const u=URL.createObjectURL(clipBlob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1600)}
  async function saveClip(){if(!clipBlob)return;save.disabled=true;try{await deliver();save.classList.add('done');saveLabel.textContent='已保存';setTimeout(()=>{save.classList.remove('done');saveLabel.textContent='保存录音'},1300)}catch{}finally{save.disabled=false}}

  start.onclick=open;exit.onclick=close;windowBtn.onclick=cycleWindow;keep.onclick=startCapture;backLive.onclick=resumeBuffer;save.onclick=saveClip;
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){await releaseWake();if(buffering){buffering=false;clearBuffer();statusTitle.textContent='页面已暂停'}}else{await requestWake();if(clip.hidden){try{await audio?.resume()}catch{}clearBuffer();buffering=true;statusTitle.textContent='重新开始保留';updateRetained()}}});
  window.addEventListener('pagehide',()=>{stopAudio();clearBuffer();clearClip();releaseWake()});
  updateWindow();
})();