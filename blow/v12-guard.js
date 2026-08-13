(()=>{
'use strict';
const video=document.getElementById('faceVideo');
const status=document.getElementById('statusText');
const page=document.getElementById('pageNow');
const prev=document.getElementById('prev');
const next=document.getElementById('next');
if(!video||!status||!page||!prev||!next)return;
let lock=null,resumeTimer=0,restoring=false,lastStatus='';
const EVENTS=[
  {needle:'嘟嘴 · 向前',dir:'next',hold:250},
  {needle:'点头 · 向前',dir:'next',hold:310},
  {needle:'张嘴 · 返回',dir:'prev',hold:270},
  {needle:'摇头 · 返回',dir:'prev',hold:420}
];
function currentPage(){return Number(page.textContent)||1}
function pauseInference(ms){
  clearTimeout(resumeTimer);
  try{video.pause()}catch{}
  resumeTimer=setTimeout(async()=>{try{await video.play()}catch{}},ms);
}
function restore(target){
  if(restoring)return;
  restoring=true;
  requestAnimationFrame(()=>{
    let now=currentPage(),guard=0;
    while(now!==target&&guard++<4){
      if(now>target)prev.click();else next.click();
      now=currentPage();
    }
    restoring=false;
  });
}
function onStatus(){
  const text=status.textContent||'';
  if(text===lastStatus)return;
  lastStatus=text;
  const ev=EVENTS.find(x=>text.includes(x.needle));
  if(!ev||restoring)return;
  const now=performance.now();
  const after=currentPage();
  if(lock&&now<lock.until){
    restore(lock.page);
    lock.until=Math.max(lock.until,now+180);
    pauseInference(Math.max(180,lock.until-now));
    return;
  }
  lock={dir:ev.dir,page:after,until:now+ev.hold};
  pauseInference(ev.hold);
}
const observer=new MutationObserver(onStatus);
observer.observe(status,{childList:true,subtree:true,characterData:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(resumeTimer);lock=null}});
window.addEventListener('pagehide',()=>{observer.disconnect();clearTimeout(resumeTimer)});
})();