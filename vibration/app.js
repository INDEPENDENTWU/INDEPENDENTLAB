(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),startLabel=$('#startLabel'),error=$('#error'),meter=$('#meter'),exit=$('#exit'),cancel=$('#cancel');
  const statusTitle=$('#statusTitle'),statusSub=$('#statusSub'),trace=$('#trace'),overlay=$('#overlay'),overlayValue=$('#overlayValue'),overlayText=$('#overlayText'),liveValue=$('#liveValue');
  const result=$('#result'),resultTime=$('#resultTime'),rmsValue=$('#rmsValue'),peakValue=$('#peakValue'),freqValue=$('#freqValue'),freqNote=$('#freqNote'),quality=$('#quality');
  const compare=$('#compare'),compareValue=$('#compareValue'),compareNote=$('#compareNote'),baselineBtn=$('#baseline'),again=$('#again'),finish=$('#finish');
  const ctx=trace.getContext('2d');

  const SETTLE_MS=2000,MEASURE_MS=10000;
  let active=false,phase='idle',permissionReady=false,wake=null,raf=0,settleEnd=0,measureStart=0,measureEnd=0;
  let samples=[],history=[],validMotion=0,lastMotionAt=0,usedGravityFallback=false,currentResult=null;
  let gravity={ready:false,x:0,y:0,z:0};
  let baseline=null;try{baseline=JSON.parse(sessionStorage.getItem('vibration-baseline')||'null')}catch{}

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function formatAccel(v){if(!Number.isFinite(v))return'—';return v<1?v.toFixed(2):v.toFixed(1)}
  function median(a){if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
  function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;navigator.wakeLock.request('screen').then(w=>{wake=w;w.addEventListener?.('release',()=>wake=null,{once:true})}).catch(()=>{})}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  async function ensurePermission(){
    if(typeof DeviceMotionEvent==='undefined')throw new Error('unsupported');
    if(typeof DeviceMotionEvent.requestPermission==='function'){
      const state=await DeviceMotionEvent.requestPermission();if(state!=='granted')throw new Error('denied');
    }
    permissionReady=true;
  }

  function linearAcceleration(e){
    const a=e.acceleration;
    if(a&&[a.x,a.y,a.z].every(Number.isFinite))return{x:a.x,y:a.y,z:a.z,fallback:false};
    const g=e.accelerationIncludingGravity;if(!g||![g.x,g.y,g.z].every(Number.isFinite))return null;
    const now=performance.now(),dt=lastMotionAt?Math.max(.005,Math.min(.12,(now-lastMotionAt)/1000)):.02,lastMotionAt=now;
    if(!gravity.ready){gravity={ready:true,x:g.x,y:g.y,z:g.z};return{x:0,y:0,z:0,fallback:true}}
    const alpha=dt/(.72+dt);gravity.x+=alpha*(g.x-gravity.x);gravity.y+=alpha*(g.y-gravity.y);gravity.z+=alpha*(g.z-gravity.z);
    return{x:g.x-gravity.x,y:g.y-gravity.y,z:g.z-gravity.z,fallback:true};
  }

  function onMotion(e){
    if(!active||(phase!=='settle'&&phase!=='measure'))return;
    const v=linearAcceleration(e);if(!v)return;validMotion++;usedGravityFallback||=v.fallback;
    const t=performance.now(),mag=Math.hypot(v.x,v.y,v.z);liveValue.textContent=formatAccel(mag);
    history.push({t,mag});while(history.length&&t-history[0].t>4200)history.shift();
    if(phase==='measure')samples.push({t,x:v.x,y:v.y,z:v.z});
  }
  window.addEventListener('devicemotion',onMotion,true);

  function resetMeasurement(){
    samples=[];history=[];validMotion=0;lastMotionAt=0;usedGravityFallback=false;currentResult=null;gravity={ready:false,x:0,y:0,z:0};
    liveValue.textContent='0.00';result.hidden=true;compare.hidden=true;baselineBtn.textContent=baseline?'更新基准':'设为基准';cancel.hidden=false;
  }

  function beginMeasurement(){
    resetMeasurement();active=true;phase='settle';const now=performance.now();settleEnd=now+SETTLE_MS;measureStart=settleEnd;measureEnd=measureStart+MEASURE_MS;
    home.hidden=true;meter.hidden=false;overlay.hidden=false;overlayValue.textContent='2.0';overlayText.textContent='放稳手机';statusTitle.textContent='正在准备';statusSub.textContent='手机保持不动';requestWake();cancelAnimationFrame(raf);tick();
  }

  function abortMeasurement(message){
    active=false;phase='idle';cancelAnimationFrame(raf);raf=0;releaseWake();meter.hidden=true;home.hidden=false;result.hidden=true;setError(message);window.scrollTo({top:0,behavior:'instant'});
  }

  function tick(now=performance.now()){
    if(!active)return;raf=requestAnimationFrame(tick);drawTrace();
    if(phase==='settle'){
      const left=Math.max(0,(settleEnd-now)/1000);overlayValue.textContent=left.toFixed(1);
      if(now>=settleEnd){
        if(validMotion<4){abortMeasurement('没有收到可用的运动传感器数据。可以确认浏览器已允许“运动与方向”访问后再试。');return}
        phase='measure';samples=[];history=[];overlay.hidden=true;statusTitle.textContent='正在测量';statusSub.textContent='剩余 10.0 秒';
      }
    }else if(phase==='measure'){
      const left=Math.max(0,(measureEnd-now)/1000);statusSub.textContent=`剩余 ${left.toFixed(1)} 秒`;
      if(now>=measureEnd)finishMeasurement();
    }
  }

  function drawTrace(){
    const r=trace.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),w=Math.max(2,Math.round(r.width*dpr)),h=Math.max(2,Math.round(r.height*dpr));
    if(trace.width!==w||trace.height!==h){trace.width=w;trace.height=h}ctx.clearRect(0,0,w,h);
    const left=w*.07,right=w*.93,mid=h*.58;ctx.strokeStyle='rgba(16,19,17,.10)';ctx.lineWidth=Math.max(1,dpr);ctx.beginPath();ctx.moveTo(left,mid);ctx.lineTo(right,mid);ctx.stroke();
    ctx.fillStyle='#101311';ctx.fillRect(right-1*dpr,h*.12,2*dpr,h*.76);
    if(history.length<2)return;const now=history.at(-1).t,from=now-4000,visible=history.filter(p=>p.t>=from),max=Math.max(.12,...visible.map(p=>p.mag));
    ctx.strokeStyle='#008f79';ctx.lineWidth=Math.max(1.2,dpr);ctx.beginPath();let started=false;
    for(const p of visible){const x=left+Math.max(0,Math.min(1,(p.t-from)/4000))*(right-left),y=mid-Math.min(1,p.mag/max)*h*.34;if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y)}ctx.stroke();
  }

  function analyze(data){
    if(data.length<20)return null;const dts=[];for(let i=1;i<data.length;i++){const d=(data[i].t-data[i-1].t)/1000;if(d>.003&&d<.2)dts.push(d)}const dt=median(dts);if(!Number.isFinite(dt))return null;
    const fs=1/dt,mx=data.reduce((s,p)=>s+p.x,0)/data.length,my=data.reduce((s,p)=>s+p.y,0)/data.length,mz=data.reduce((s,p)=>s+p.z,0)/data.length;
    let sum=0,peak=0;const centered=data.map(p=>{const x=p.x-mx,y=p.y-my,z=p.z-mz,m=Math.hypot(x,y,z);sum+=m*m;peak=Math.max(peak,m);return{t:(p.t-data[0].t)/1000,x,y,z}});const rms=Math.sqrt(sum/centered.length);
    const duration=(data.at(-1).t-data[0].t)/1000,maxF=Math.min(25,fs*.44),minF=.8,powers=[];let bestF=null,bestP=-Infinity;
    if(duration>=6&&maxF>minF+1){
      const n=centered.length;
      for(let f=minF;f<=maxF;f+=.1){let pwr=0;for(const axis of ['x','y','z']){let re=0,im=0;for(let i=0;i<n;i++){const q=centered[i],win=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,n-1)),a=2*Math.PI*f*q.t,v=q[axis]*win;re+=v*Math.cos(a);im-=v*Math.sin(a)}pwr+=re*re+im*im}powers.push(pwr);if(pwr>bestP){bestP=pwr;bestF=f}}
    }
    const floor=powers.length?median(powers.filter(Number.isFinite)):0,confidence=floor>0?bestP/floor:0;const frequency=rms>=.025&&confidence>=6?bestF:null;
    return{rms,peak,frequency,confidence,fs,duration,count:data.length,fallback:usedGravityFallback};
  }

  function finishMeasurement(){
    if(phase!=='measure')return;phase='result';active=false;cancelAnimationFrame(raf);raf=0;releaseWake();const out=analyze(samples);
    if(!out){abortMeasurement('这次收到的传感器数据太少，无法形成可靠结果。重新测一次即可。');return}
    currentResult=out;cancel.hidden=true;statusTitle.textContent='测量完成';statusSub.textContent=`约 ${Math.round(out.fs)} Hz 采样`;
    rmsValue.textContent=formatAccel(out.rms);peakValue.textContent=formatAccel(out.peak);
    if(out.frequency!=null){freqValue.textContent=out.frequency.toFixed(1);freqNote.textContent='Hz · 周期明显'}else{freqValue.textContent='—';freqNote.textContent='无明显主频'}
    resultTime.textContent=`${out.duration.toFixed(1)} 秒`;quality.textContent=out.fallback?`当前设备只提供含重力加速度，已在本机滤除重力；同一位置前后比较比绝对数值更可靠。`:`采样率约 ${Math.round(out.fs)} Hz。同一台手机、同一位置、同一方向做前后比较最可靠。`;
    renderComparison();result.hidden=false;
  }

  function renderComparison(){
    if(!baseline||!currentResult||baseline.savedAt===currentResult.savedAt){compare.hidden=true;return}
    compare.hidden=false;const b=baseline.rms,c=currentResult.rms;if(!(b>.015)){compareValue.textContent='无法比较比例';compareNote.textContent=`基准 ${formatAccel(b)} → 本次 ${formatAccel(c)} m/s²；基准振动过低。`;return}
    const pct=(c/b-1)*100,abs=Math.abs(pct);compareValue.textContent=abs<3?'基本不变':pct<0?`降低 ${Math.round(abs)}%`:`增加 ${Math.round(abs)}%`;
    const freqText=baseline.frequency!=null&&currentResult.frequency!=null?`；主频 ${baseline.frequency.toFixed(1)} → ${currentResult.frequency.toFixed(1)} Hz`:'';
    compareNote.textContent=`RMS ${formatAccel(b)} → ${formatAccel(c)} m/s²${freqText}`;
  }

  function saveBaseline(){
    if(!currentResult)return;baseline={rms:currentResult.rms,peak:currentResult.peak,frequency:currentResult.frequency,fs:currentResult.fs,savedAt:Date.now()};try{sessionStorage.setItem('vibration-baseline',JSON.stringify(baseline))}catch{}baselineBtn.textContent='基准已保存';compare.hidden=true;statusTitle.textContent='基准已保存';statusSub.textContent='调整后再测一次';
  }

  async function open(){
    setError('');start.disabled=true;
    try{if(!permissionReady)await ensurePermission();beginMeasurement()}catch(e){if(e?.message==='denied')setError('没有获得运动与方向传感器权限。允许权限后才能测量振动。');else setError('当前浏览器没有提供可用的运动传感器。')}finally{start.disabled=false}
  }
  async function close(){active=false;phase='idle';cancelAnimationFrame(raf);raf=0;await releaseWake();meter.hidden=true;home.hidden=false;result.hidden=true;window.scrollTo({top:0,behavior:'instant'})}

  start.onclick=open;exit.onclick=close;cancel.onclick=close;finish.onclick=close;again.onclick=()=>{if(permissionReady)beginMeasurement();else open()};baselineBtn.onclick=saveBaseline;
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&meter.hidden===false&&(phase==='settle'||phase==='measure'))abortMeasurement('页面切到后台，本次测量已取消。重新开始时请保持页面在前台。')});
  window.addEventListener('pagehide',()=>{active=false;cancelAnimationFrame(raf);releaseWake()});
  if(baseline){startLabel.textContent='再测振动'}
})();