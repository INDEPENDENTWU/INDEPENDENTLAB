(()=>{
  let last=null,lastAt=0;
  window.addEventListener('devicemotion',e=>{
    const now=performance.now(),a=e.acceleration,g=e.accelerationIncludingGravity,r=e.rotationRate;
    let impact=false;
    if(a&&[a.x,a.y,a.z].every(Number.isFinite)&&Math.hypot(a.x,a.y,a.z)>2.15)impact=true;
    if(r){const v=[r.alpha,r.beta,r.gamma].filter(Number.isFinite);if(v.length&&Math.max(...v.map(Math.abs))>95)impact=true}
    if(g&&[g.x,g.y,g.z].every(Number.isFinite)){
      if(last&&now-lastAt<180&&Math.hypot(g.x-last.x,g.y-last.y,g.z-last.z)>1.35)impact=true;
      last={x:g.x,y:g.y,z:g.z};lastAt=now;
    }
    if(!impact)e.stopImmediatePropagation();
  },true);
})();