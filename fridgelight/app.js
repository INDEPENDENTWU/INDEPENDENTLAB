(()=>{
'use strict';
const $=s=>document.querySelector(s);
const home=$('#home'),start=$('#start'),error=$('#error'),setup=$('#setup'),exitSetup=$('#exitSetup'),video=$('#video'),readyText=$('#readyText'),test=$('#test');
const running=$('#running'),runSmall=$('#runSmall'),runTitle=$('#runTitle'),runHint=$('#runHint'),pulse=$('#pulse'),cancelRun=$('#cancelRun');
const result=$('#result'),resultBack=$('#resultBack'),again=$('#again'),verdict=$('#verdict'),resultText=$('#resultText'),lowValue=$('#lowValue'),returnValue=$('#returnValue'),chart=$('#chart'),copyResult=$('#copyResult'),resultNote=$('#resultNote');
const sample=$('#sample'),ctx=sample.getContext('2d',{willReadFrequently:true}),chartCtx=chart.getContext('2d');
let stream=null,raf=0,lastSampleAt=0,mode='idle',wake=null,lastOutcome=null;
let cal=[],baseline=0,baselineBright=0,referenceGrid=null,timeline=[],testStarted=0;
let darkSince=0,darkAt=0,darkReadyAt=0,recoverSince=0,minBrightness=255,minBright=255,maxAfterDark=0,bestScene=0,tooFastCount=0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));
function setError(t=''){error.hidden=!t;error.textContent=t}
async function requestWake(){if(wake||!navigator.wakeLock?.request)return;try{wake=await navigator.wakeLock.request('screen');wake.addEventListener?.('release',()=>wake=null,{once:true})}catch{}}
async function releaseWake(){const w=wake;wake=null;if(w)try{await w.release()}catch{}}
async function openCamera(){setError('');stopCamera();try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});video.srcObject=stream;await video.play();home.hidden=true;result.hidden=true;running.hidden=true;setup.hidden=false;readyText.textContent='镜头对着冰箱内部和灯，手机放稳后开始。';mode='preview'}catch(e){console.error(e);setError('没有打开后置相机。请允许相机权限后再试。')}}
function stopCamera(){cancelAnimationFrame(raf);raf=0;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}video.srcObject=null;mode='idle'}
function frameStats(){
 if(video.readyState<2)return null;
 ctx.drawImage(video,0,0,sample.width,sample.height);
 const d=ctx.getImageData(0,0,sample.width,sample.height).data;
 const cols=8,rows=6,cw=sample.width/cols,ch=sample.height/rows,grid=[];
 for(let gy=0;gy<rows;gy++)for(let gx=0;gx<cols;gx++){
   let sum=0,n=0;
   const x0=Math.floor(gx*cw)+1,x1=Math.floor((gx+1)*cw)-1,y0=Math.floor(gy*ch)+1,y1=Math.floor((gy+1)*ch)-1;
   for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const i=(y*sample.width+x)*4;sum+=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];n++}
   grid.push(n?sum/n:0);
 }
 const ordered=[...grid].sort((a,b)=>a-b),brightness=median(grid),top=ordered.slice(Math.floor(ordered.length*.72)),bright=median(top);
 return{brightness,bright,grid};
}
function averageGrid(frames){if(!frames.length)return null;const n=frames[0].grid.length,out=new Array(n).fill(0);for(const f of frames)for(let i=0;i<n;i++)out[i]+=f.grid[i];for(let i=0;i<n;i++)out[i]/=frames.length;return out}
function sceneScore(grid){if(!referenceGrid||!grid?.length)return 0;const diffs=[];for(let i=0;i<grid.length;i++)diffs.push(Math.abs(grid[i]-referenceGrid[i]));const d=median(diffs);return clamp(1-d/Math.max(24,baseline*.48),0,1)}
function darkCoverage(grid){if(!referenceGrid||!grid?.length)return 0;let n=0,hit=0;for(let i=0;i<grid.length;i++){const ref=referenceGrid[i];if(ref<18)continue;n++;if(grid[i]<Math.max(10,ref*.64))hit++}return n?hit/n:0}
function setPulse(v){const pct=baseline?clamp(v/baseline*100,0,120):0;pulse.firstElementChild.style.width=`${Math.min(100,pct)}%`}
function setRun(small,title,hint){runSmall.textContent=small;runTitle.textContent=title;runHint.textContent=hint}
function startSampling(){cancelAnimationFrame(raf);lastSampleAt=0;const loop=now=>{raf=requestAnimationFrame(loop);if(now-lastSampleAt<72)return;lastSampleAt=now;const f=frameStats();if(f)handleFrame(now,f)};raf=requestAnimationFrame(loop)}
function resetCloseAttempt(){darkSince=0;darkAt=0;darkReadyAt=0;recoverSince=0;bestScene=0;maxAfterDark=0;mode='waitClose'}
function handleCalibration(now,f){
 cal.push(f);if(cal.length>48)cal.shift();
 if(cal.length<18)return;
 const recent=cal.slice(-16),vals=recent.map(x=>x.brightness),brights=recent.map(x=>x.bright),m=median(vals),bm=median(brights),noise=mad(vals,m),brightNoise=mad(brights,bm);
 const stable=(noise<Math.max(4,m*.055))&&(brightNoise<Math.max(6,bm*.065));
 if(stable){baseline=m;baselineBright=bm;referenceGrid=averageGrid(recent.slice(-10));timeline=[];testStarted=performance.now();minBrightness=baseline;minBright=baselineBright;tooFastCount=0;resetCloseAttempt();setRun('现在','关门','关上后保持一会儿，再打开门。');return}
 if(cal.length>=44){mode='preview';running.hidden=true;setup.hidden=false;readyText.textContent='画面一直在变。把手机放稳、镜头对着冰箱内部，再开始。';releaseWake()}
}
function handleFrame(now,f){
 if(mode==='calibrating'){handleCalibration(now,f);return}
 if(!['waitClose','darkHold','waitOpen'].includes(mode))return;
 const t=performance.now()-testStarted;timeline.push({t,v:f.brightness});if(timeline.length>520)timeline.shift();minBrightness=Math.min(minBrightness,f.brightness);minBright=Math.min(minBright,f.bright);setPulse(f.brightness);
 const ratio=f.brightness/Math.max(1,baseline),brightRatio=f.bright/Math.max(1,baselineBright),coverage=darkCoverage(f.grid),looksDark=(brightRatio<.56)||(ratio<.62&&brightRatio<.70)||(coverage>.64&&brightRatio<.76);
 if(mode==='waitClose'){
   if(t<850){darkSince=0;return}
   if(looksDark){if(!darkSince)darkSince=now;if(now-darkSince>=680){darkAt=now;mode='darkHold';setRun('已经变暗','保持关门','再保持一会儿。')}}else darkSince=0;
   if(t>26000)finish(false,'no-close');
   return;
 }
 if(mode==='darkHold'){
   if(!looksDark){tooFastCount++;resetCloseAttempt();setRun('刚才太快','再关一次','关上约 2 秒，再打开门。');return}
   if(now-darkAt>=1250){darkReadyAt=now;mode='waitOpen';setRun('关门成立','再打开门','打开后先别拿走手机。')}
   return;
 }
 if(mode==='waitOpen'){
   if(looksDark){recoverSince=0;return}
   maxAfterDark=Math.max(maxAfterDark,f.brightness);bestScene=Math.max(bestScene,sceneScore(f.grid));
   const riseFromLow=f.brightness-Math.min(minBrightness,baseline),recovered=f.brightness>baseline*.69&&f.bright>baselineBright*.65&&riseFromLow>Math.max(28,baseline*.28);
   if(recovered){if(!recoverSince)recoverSince=now;if(now-recoverSince>=360){
     const total=performance.now()-testStarted,darkDuration=now-darkAt;
     if(total<2600||darkDuration<1250){resetCloseAttempt();setRun('刚才太快','再关一次','关上约 2 秒，再打开门。');return}
     if(bestScene<.20){finish(false,'scene-moved');return}
     finish(true,'cycle');
   }}else recoverSince=0;
   if(now-darkAt>42000)finish(false,'no-open');
 }
}
async function beginTest(){if(!stream)return;cal=[];baseline=0;baselineBright=0;referenceGrid=null;timeline=[];mode='calibrating';setup.hidden=true;running.hidden=false;setRun('准备','放稳手机','正在确认开门时的稳定画面。');pulse.firstElementChild.style.width='0';pulse.firstElementChild.style.background='#f5c928';await requestWake();startSampling()}
function drawChart(){const w=chart.width,h=chart.height;chartCtx.clearRect(0,0,w,h);chartCtx.fillStyle='#111';chartCtx.fillRect(0,0,w,h);if(timeline.length<2)return;const maxT=Math.max(...timeline.map(x=>x.t),1),maxV=Math.max(baseline,...timeline.map(x=>x.v),1);chartCtx.strokeStyle='#30322e';chartCtx.lineWidth=1;const by=h-(baseline/maxV)*(h-26)-12;chartCtx.beginPath();chartCtx.moveTo(0,by);chartCtx.lineTo(w,by);chartCtx.stroke();chartCtx.strokeStyle='#f5c928';chartCtx.lineWidth=3;chartCtx.lineJoin='round';chartCtx.beginPath();timeline.forEach((p,i)=>{const x=p.t/maxT*w,y=h-(p.v/maxV)*(h-26)-12;i?chartCtx.lineTo(x,y):chartCtx.moveTo(x,y)});chartCtx.stroke()}
function outcomeCopy(){if(!lastOutcome)return'';return['灯灭了吗',`结果：${verdict.textContent}`,`关门最低亮度：${lowValue.textContent}`,lastOutcome.ok?`再开门亮度：${returnValue.textContent}`:'',resultText.textContent].filter(Boolean).join('\n')}
async function finish(ok,reason){
 if(!['waitClose','darkHold','waitOpen'].includes(mode))return;mode='done';cancelAnimationFrame(raf);raf=0;
 const lowRatio=baseline?clamp(minBrightness/baseline,0,2):0,returnRatio=baseline?clamp((maxAfterDark||timeline[timeline.length-1]?.v||0)/baseline,0,2):0;
 lastOutcome={ok,reason,lowRatio,returnRatio,baseline,minBrightness,bestScene,tooFastCount};running.hidden=true;result.hidden=false;setup.hidden=true;
 if(ok){verdict.textContent='灭了';resultText.textContent='关门后持续变暗，重新开门后又回到接近开始时的画面。';resultNote.textContent='这次记录到完整的开门 → 关门变暗 → 再开门恢复。'}
 else if(reason==='scene-moved'){verdict.textContent='没测完整';resultText.textContent='画面重新变亮了，但和开始时差得太多。';resultNote.textContent='手机可能移动了。放稳后再测一次。'}
 else if(reason==='no-open'){verdict.textContent='没测完整';resultText.textContent='已经记录到持续变暗，但没有记录到重新开门后的恢复。';resultNote.textContent='重新测试时，关门后再打开门并停一下。'}
 else{verdict.textContent='没测完整';resultText.textContent='没有记录到一次完整、持续的关门变暗过程。';resultNote.textContent='镜头对着冰箱内部，手机放稳，关门约 2 秒再打开。'}
 lowValue.textContent=baseline?`${Math.round(lowRatio*100)}%`:'—';returnValue.textContent=ok?`${Math.round(returnRatio*100)}%`:'—';drawChart();stopCamera();await releaseWake();copyResult.textContent='复制结果'
}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true}catch{}try{const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok}catch{return false}}
async function copyOutcome(){const text=outcomeCopy();if(!text)return;const ok=await copyText(text);copyResult.textContent=ok?'已复制':'复制失败';setTimeout(()=>copyResult.textContent='复制结果',900)}
function goHome(){stopCamera();releaseWake();setup.hidden=true;running.hidden=true;result.hidden=true;home.hidden=false;lastOutcome=null;window.scrollTo({top:0,behavior:'instant'})}
start.onclick=openCamera;exitSetup.onclick=goHome;test.onclick=beginTest;cancelRun.onclick=goHome;resultBack.onclick=goHome;again.onclick=openCamera;copyResult.onclick=copyOutcome;
document.addEventListener('visibilitychange',()=>{if(document.hidden&&['calibrating','waitClose','darkHold','waitOpen'].includes(mode)){cancelAnimationFrame(raf);raf=0}else if(!document.hidden&&stream&&['calibrating','waitClose','darkHold','waitOpen'].includes(mode))startSampling()});
window.addEventListener('pagehide',()=>{stopCamera();releaseWake()});
})();