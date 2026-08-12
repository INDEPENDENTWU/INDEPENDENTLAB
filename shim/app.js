(()=>{
  const $=s=>document.querySelector(s);
  const home=$('#home'),start=$('#start'),error=$('#error'),widthInput=$('#widthInput'),depthInput=$('#depthInput');
  const meter=$('#meter'),exit=$('#exit'),cancel=$('#cancel'),statusTitle=$('#statusTitle'),statusSub=$('#statusSub');
  const measure=$('#measure'),measureValue=$('#measureValue'),measureText=$('#measureText'),turn=$('#turn'),second=$('#second'),result=$('#result');
  const lrValue=$('#lrValue'),fbValue=$('#fbValue'),lf=$('#lf'),rf=$('#rf'),lb=$('#lb'),rb=$('#rb'),instruction=$('#instruction'),again=$('#again'),finish=$('#finish');

  let permissionReady=false,active=false,phase='idle',wake=null,timer=0,samples=[],first=null,secondPass=null;
  const SETTLE_MS=900,SAMPLE_MS=2200;

  const savedW=localStorage.getItem('shim-width-cm'),savedD=localStorage.getItem('shim-depth-cm');
  if(savedW)widthInput.value=savedW;if(savedD)depthInput.value=savedD;

  function setError(t=''){error.hidden=!t;error.textContent=t}
  function saveDims(){if(widthInput.value)localStorage.setItem('shim-width-cm',widthInput.value);if(depthInput.value)localStorage.setItem('shim-depth-cm',depthInput.value)}
  function dims(){const w=Number(widthInput.value),d=Number(depthInput.value);return{w,d,ok:w>=5&&w<=500&&d>=5&&d<=500}}
  async function ensurePermission(){
    if(typeof DeviceMotionEvent==='undefined')throw new Error('unsupported');
    if(typeof DeviceMotionEvent.requestPermission==='function'){
      const p=await DeviceMotionEvent.requestPermission();if(p!=='granted')throw new Error('denied');
    }
    permissionReady=true;
  }
  async function requestWake(){if(!active||document.hidden||wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
  async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}

  function median(a){if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2}
  function mad(a,m=median(a)){if(!a.length)return NaN;return median(a.map(v=>Math.abs(v-m)))}
  function normalizeReading(e){
    const g=e.accelerationIncludingGravity;if(!g||![g.x,g.y,g.z].every(Number.isFinite))return null;
    const mag=Math.hypot(g.x,g.y,g.z);if(!(mag>7&&mag<13))return null;
    return{x:g.x,y:g.y,z:g.z,mag};
  }
  function onMotion(e){if(!active||(phase!=='settle'&&phase!=='sample'))return;const r=normalizeReading(e);if(!r)return;if(phase==='sample')samples.push(r)}
  window.addEventListener('devicemotion',onMotion,true);

  function analyzePass(){
    if(samples.length<18)return{ok:false,reason:'没有收到足够的传感器数据。'};
    const xs=samples.map(s=>s.x),ys=samples.map(s=>s.y),zs=samples.map(s=>s.z),ms=samples.map(s=>s.mag);
    const x=median(xs),y=median(ys),z=median(zs),g=median(ms);
    const nx=x/g,ny=y/g,nz=z/g;
    const noise=Math.max(mad(xs,x),mad(ys,y),mad(zs,z))/g;
    if(nz<.94)return{ok:false,reason:z<0?'手机需要屏幕朝上平放。':'手机倾斜太大，先粗略调平后再测。'};
    if(noise>.009)return{ok:false,reason:'手机还在晃动。放稳后再测这一遍。'};
    return{ok:true,x,y,z,g,nx,ny,nz,noise,count:samples.length};
  }

  function clearTimer(){clearInterval(timer);timer=0}
  function startPass(which){
    clearTimer();samples=[];measure.hidden=false;turn.hidden=true;result.hidden=true;phase='settle';
    statusTitle.textContent=which===1?'第一遍':'第二遍';statusSub.textContent=which===1?'手机顶部朝前':'手机底部朝前';
    measureText.textContent='放稳手机';let left=SETTLE_MS;measureValue.textContent=(left/1000).toFixed(1);
    const started=performance.now();timer=setInterval(()=>{
      const now=performance.now();
      if(phase==='settle'){
        left=Math.max(0,SETTLE_MS-(now-started));measureValue.textContent=(left/1000).toFixed(1);
        if(left<=0){phase='sample';samples=[];measureText.textContent='正在测量';measureValue.textContent=(SAMPLE_MS/1000).toFixed(1)}
      }else if(phase==='sample'){
        const passed=now-started-SETTLE_MS,remain=Math.max(0,SAMPLE_MS-passed);measureValue.textContent=(remain/1000).toFixed(1);
        if(remain<=0){clearTimer();finishPass(which)}
      }
    },40)
  }

  function finishPass(which){
    const out=analyzePass();if(!out.ok){phase='idle';measureText.textContent=out.reason;measureValue.textContent='—';setTimeout(()=>{if(active)startPass(which)},1250);return}
    if(which===1){first=out;phase='turn';measure.hidden=true;turn.hidden=false;statusTitle.textContent='第一遍完成';statusSub.textContent='原地转 180°'}
    else{secondPass=out;phase='result';showResult()}
  }

  function roundHalf(v){return Math.max(0,Math.round(v*2)/2)}
  function fmt(v){return Number.isFinite(v)?(Math.abs(v-Math.round(v))<.001?String(Math.round(v)):v.toFixed(1)):'—'}
  function showResult(){
    measure.hidden=true;turn.hidden=true;result.hidden=false;statusTitle.textContent='找平结果';statusSub.textContent='已抵消手机零偏';
    const {w,d}=dims(),W=w*10,D=d*10;
    const g=(first.g+secondPass.g)/2;
    const ux=(first.x-secondPass.x)/(2*g),uy=(first.y-secondPass.y)/(2*g);
    const lr=W*ux,fb=D*uy;
    lrValue.textContent=fmt(Math.abs(lr));fbValue.textContent=fmt(Math.abs(fb));
    const heights={
      lf:-ux*W/2+uy*D/2,
      rf: ux*W/2+uy*D/2,
      lb:-ux*W/2-uy*D/2,
      rb: ux*W/2-uy*D/2
    };
    const top=Math.max(...Object.values(heights));
    const shims={};for(const k of Object.keys(heights))shims[k]=roundHalf(top-heights[k]);
    lf.textContent=fmt(shims.lf);rf.textContent=fmt(shims.rf);lb.textContent=fmt(shims.lb);rb.textContent=fmt(shims.rb);
    const names={lf:'左前',rf:'右前',lb:'左后',rb:'右后'};
    const ordered=Object.entries(shims).sort((a,b)=>b[1]-a[1]);
    if(ordered[0][1]<.5)instruction.textContent='已经基本水平，不需要再垫。';
    else{
      const need=ordered.filter(([,v])=>v>=.5).map(([k,v])=>`${names[k]} ${fmt(v)} mm`).join('、');
      instruction.textContent=`保持最高脚不动，其余位置升高：${need}。可用垫片，或把对应调节脚升高相近尺寸。`;
    }
  }

  async function open(){
    setError('');const dm=dims();if(!dm.ok){setError('先填写左右脚距和前后脚距，范围 5–500 cm。');return}saveDims();start.disabled=true;
    try{
      if(!permissionReady)await ensurePermission();active=true;home.hidden=true;meter.hidden=false;first=null;secondPass=null;requestWake();startPass(1)
    }catch(e){setError(e?.message==='denied'?'没有获得运动与方向传感器权限。允许权限后才能找平。':'当前浏览器没有提供可用的运动传感器。')}
    finally{start.disabled=false}
  }
  async function close(){active=false;phase='idle';clearTimer();await releaseWake();meter.hidden=true;home.hidden=false;measure.hidden=false;turn.hidden=true;result.hidden=true;first=null;secondPass=null;window.scrollTo({top:0,behavior:'instant'})}

  start.onclick=open;second.onclick=()=>{if(active&&first)startPass(2)};again.onclick=()=>{if(active){first=null;secondPass=null;startPass(1)}};exit.onclick=close;cancel.onclick=close;finish.onclick=close;
  document.addEventListener('visibilitychange',async()=>{if(!active)return;if(document.hidden){clearTimer();phase='idle';await releaseWake()}else{await requestWake();if(!result.hidden)return;if(first) {measure.hidden=true;turn.hidden=false;statusTitle.textContent='重新确认';statusSub.textContent='原地转 180° 后继续'} else startPass(1)}});
  window.addEventListener('pagehide',()=>{active=false;clearTimer();releaseWake()});
})();