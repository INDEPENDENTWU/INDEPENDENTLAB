(()=>{
'use strict';
const video=document.getElementById('faceVideo');
const next=document.getElementById('next'),prev=document.getElementById('prev');
const status=document.getElementById('statusText'),dock=document.getElementById('mouthDock'),dockText=document.getElementById('mouthDockText');
const actionOptions=document.getElementById('actionOptions');
const commandBtn=actionOptions?.querySelector('[data-mode="command"]');
const mouthBtn=actionOptions?.querySelector('[data-mode="mouth"]');
const permissionAction=document.getElementById('permissionAction');
let mode=localStorage.getItem('handsfree-mode-v7')||'command';
let landmarker=null,raf=0,lastFrame=0,streamRef=null;
let calibrated=false,samples=[],baseYaw=0,basePitch=0,yawThr=.06,pitchThr=.038;
let sy=0,sp=0,haveSmooth=false,neutralSince=0,armed=false,cooldown=0;
let nod=null,shake=null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));
function syncSelected(m){mode=m;try{localStorage.setItem('handsfree-mode-v7',m)}catch{};[commandBtn,mouthBtn].forEach(b=>{if(!b)return;const on=b.dataset.mode===m;b.classList.toggle('active',on);const e=b.querySelector('em');if(e)e.textContent=on?'当前':'选择'});if(m==='mouth')setTimeout(startWhenReady,120)}
if(commandBtn){const old=commandBtn.onclick;commandBtn.onclick=async e=>{if(old)await old.call(commandBtn,e);syncSelected('command')}}
if(mouthBtn){const old=mouthBtn.onclick;mouthBtn.onclick=async e=>{if(old)await old.call(mouthBtn,e);syncSelected('mouth')}}
permissionAction?.addEventListener('click',()=>{if(mode==='mouth')setTimeout(startWhenReady,650)});
const obs=new MutationObserver(()=>{if(mode==='mouth'&&status?.textContent==='嘟嘴向前 · 张嘴返回')status.textContent='嘟嘴 / 点头向前 · 张嘴 / 摇头返回'});
if(status)obs.observe(status,{childList:true,subtree:true,characterData:true});
function pose(lm){
  const l=lm?.[234],r=lm?.[454],t=lm?.[10],c=lm?.[152],n=lm?.[1];
  if(!l||!r||!t||!c||!n)return null;
  const w=Math.abs(r.x-l.x),h=Math.abs(c.y-t.y);if(w<.08||h<.10)return null;
  const yaw=(n.x-(l.x+r.x)/2)/w;
  const pitch=(n.y-(t.y+c.y)/2)/h;
  return{yaw,pitch};
}
async function loadLandmarker(){
  if(landmarker)return landmarker;
  const sources=[{js:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm',wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'},{js:'https://esm.sh/@mediapipe/tasks-vision@0.10.35',wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'}];
  let last=null;
  for(const s of sources){try{const mod=await import(s.js),F=mod.FilesetResolver||mod.default?.FilesetResolver,L=mod.FaceLandmarker||mod.default?.FaceLandmarker;if(!F||!L)throw new Error('module');const vision=await F.forVisionTasks(s.wasm);landmarker=await L.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:false,minFaceDetectionConfidence:.20,minFacePresenceConfidence:.20,minTrackingConfidence:.20});return landmarker}catch(e){last=e}}
  throw last||new Error('face');
}
function resetCalibration(){calibrated=false;samples=[];haveSmooth=false;neutralSince=0;armed=false;nod=null;shake=null;cooldown=0;dockText&&(dockText.textContent='保持自然')}
function calibrate(){
  if(samples.length<10)return false;
  const ys=samples.map(x=>x.yaw),ps=samples.map(x=>x.pitch);baseYaw=median(ys);basePitch=median(ps);
  yawThr=clamp(Math.max(.052,mad(ys,baseYaw)*5.5),.052,.105);
  pitchThr=clamp(Math.max(.032,mad(ps,basePitch)*5.5),.032,.075);
  calibrated=true;dockText&&(dockText.textContent='动作已锁');return true;
}
function hit(dir,label){
  cooldown=performance.now()+680;armed=false;neutralSince=0;nod=null;shake=null;
  dir==='next'?next?.click():prev?.click();
  if(status){status.textContent=label;const dot=document.getElementById('statusDot');dot?.classList.add('hit');setTimeout(()=>dot?.classList.remove('hit'),240);setTimeout(()=>{if(mode==='mouth')status.textContent='嘟嘴 / 点头向前 · 张嘴 / 摇头返回'},620)}
}
function evaluate(now,yaw,pitch){
  if(!calibrated)return;
  const dy=yaw-baseYaw,dp=pitch-basePitch,neutral=Math.abs(dy)<yawThr*.42&&Math.abs(dp)<pitchThr*.46;
  if(neutral){if(!neutralSince)neutralSince=now;if(now-neutralSince>250)armed=true;if(!nod&&!shake&&now>cooldown){baseYaw=baseYaw*.997+yaw*.003;basePitch=basePitch*.997+pitch*.003}}else neutralSince=0;
  if(now<cooldown||!armed)return;
  // 摇头必须完成“一侧 -> 另一侧 -> 回中间”，普通看向一边不会触发。
  if(shake){
    if(now-shake.started>1500){shake=null;return}
    if(shake.stage===1&&Math.sign(dy)===-shake.side&&Math.abs(dy)>yawThr*1.02){shake.stage=2;shake.crossed=now;return}
    if(shake.stage===2&&neutral&&now-shake.crossed>80){hit('prev','摇头 · 返回');return}
  }else if(Math.abs(dy)>yawThr&&Math.abs(dp)<pitchThr*1.25){shake={stage:1,side:Math.sign(dy)||1,started:now};nod=null;return}
  // 点头采用相对脸部比例，不看脸在画面中的绝对位置；离开中性再回中性才算一次。
  if(!shake){
    if(nod){if(now-nod.started>950){nod=null;return}nod.peak=Math.max(nod.peak,Math.abs(dp));if(neutral&&now-nod.started>115&&nod.peak>pitchThr*1.05){hit('next','点头 · 向前');return}}
    else if(Math.abs(dp)>pitchThr&&Math.abs(dy)<yawThr*.88)nod={started:now,peak:Math.abs(dp)};
  }
}
async function startWhenReady(){
  if(mode!=='mouth'||!video)return;
  const stream=video.srcObject;if(!stream||video.readyState<2){setTimeout(startWhenReady,220);return}
  if(streamRef!==stream){streamRef=stream;resetCalibration()}
  try{await loadLandmarker()}catch{return}
  cancelAnimationFrame(raf);lastFrame=0;
  const loop=now=>{raf=requestAnimationFrame(loop);if(mode!=='mouth'||document.hidden||video.srcObject!==streamRef||video.readyState<2||now-lastFrame<88)return;lastFrame=now;try{const r=landmarker.detectForVideo(video,now),p=pose(r?.faceLandmarks?.[0]);if(!p)return;const a=.34;if(!haveSmooth){sy=p.yaw;sp=p.pitch;haveSmooth=true}else{sy=sy*(1-a)+p.yaw*a;sp=sp*(1-a)+p.pitch*a}if(!calibrated){samples.push({yaw:sy,pitch:sp});if(samples.length>=14)calibrate();return}evaluate(now,sy,sp)}catch{}};raf=requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelAnimationFrame(raf);else if(mode==='mouth')setTimeout(startWhenReady,180)});
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf));
syncSelected(mode);
})();