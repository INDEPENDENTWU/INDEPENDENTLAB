(()=>{
  const $=s=>document.querySelector(s);
  const socketCount=$('#socketCount'),stripPreview=$('#stripPreview'),devicesEl=$('#devices'),minus=$('#minus'),plus=$('#plus'),add=$('#add'),solve=$('#solve');
  const intro=$('#intro'),result=$('#result'),back=$('#back'),reset=$('#reset'),edit=$('#edit'),resultMeta=$('#resultMeta'),verdict=$('#verdict'),verdictNote=$('#verdictNote'),planStrip=$('#planStrip'),planList=$('#planList'),notFit=$('#notFit'),notFitNames=$('#notFitNames');
  let n=6,nextId=4;
  let devices=[
    {id:1,name:'插头 1',shape:'solo',flip:false},
    {id:2,name:'插头 2',shape:'right',flip:true},
    {id:3,name:'插头 3',shape:'both',flip:false}
  ];
  const SHAPES={solo:{l:0,r:0,label:'不挡'},left:{l:1,r:0,label:'挡左'},right:{l:0,r:1,label:'挡右'},both:{l:1,r:1,label:'两边'}};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function renderStrip(el,count,plan=null){
    el.style.setProperty('--n',count);el.innerHTML='';
    const pins=new Map(),used=new Array(count).fill(null);
    if(plan){for(const p of plan){pins.set(p.pos,p);for(let k=p.pos-p.l;k<=p.pos+p.r;k++){if(k>=0&&k<count)used[k]=p}}}
    for(let i=0;i<count;i++){
      const cell=document.createElement('div');cell.className='socket';cell.dataset.i=String(i+1);
      if(plan&&used[i]&&!pins.has(i))cell.classList.add('blocked');
      if(plan&&pins.has(i)){cell.classList.add('occupied');const tag=document.createElement('span');tag.className='plug-tag';tag.textContent=String(pins.get(i).device.order);cell.appendChild(tag)}
      el.appendChild(cell)
    }
  }
  function shapeButtons(d){return Object.entries(SHAPES).map(([k,v])=>`<button type="button" data-shape="${k}" class="${d.shape===k?'active':''}">${v.label}</button>`).join('')}
  function renderDevices(){
    devicesEl.innerHTML=devices.map((d,i)=>`<div class="device" data-id="${d.id}"><div class="device-name"><input value="${esc(d.name)}" maxlength="18" aria-label="插头名称"><small>第 ${i+1} 个</small></div><div class="footprints">${shapeButtons(d)}</div><div class="device-side"><button class="flip ${d.flip?'on':''}" type="button">${d.flip?'可翻 180°':'固定方向'}</button><button class="remove" type="button">移除</button></div></div>`).join('');
    devicesEl.querySelectorAll('.device').forEach(row=>{
      const id=Number(row.dataset.id),d=devices.find(x=>x.id===id);if(!d)return;
      row.querySelector('input').oninput=e=>d.name=e.target.value.trim()||`插头 ${devices.indexOf(d)+1}`;
      row.querySelectorAll('[data-shape]').forEach(b=>b.onclick=()=>{d.shape=b.dataset.shape;row.querySelectorAll('[data-shape]').forEach(x=>x.classList.toggle('active',x===b));if(d.shape==='solo'||d.shape==='both'){d.flip=false;const f=row.querySelector('.flip');f.classList.remove('on');f.textContent='固定方向'}});
      row.querySelector('.flip').onclick=e=>{if(d.shape==='solo'||d.shape==='both')return;d.flip=!d.flip;e.currentTarget.classList.toggle('on',d.flip);e.currentTarget.textContent=d.flip?'可翻 180°':'固定方向'};
      row.querySelector('.remove').onclick=()=>{if(devices.length<=1)return;devices=devices.filter(x=>x.id!==id);renderDevices()}
    })
  }
  function renderSetup(){socketCount.textContent=String(n);renderStrip(stripPreview,n);renderDevices();minus.disabled=n<=3;plus.disabled=n>=12;add.disabled=devices.length>=10}

  function orientations(d){
    const s=SHAPES[d.shape]||SHAPES.solo,out=[{l:s.l,r:s.r,turned:false}];
    if(d.flip&&s.l!==s.r)out.push({l:s.r,r:s.l,turned:true});return out
  }
  function solvePlan(){
    const input=devices.map((d,i)=>({...d,order:i+1,name:d.name||`插头 ${i+1}`}));
    const ordered=[...input].sort((a,b)=>{const A=SHAPES[a.shape],B=SHAPES[b.shape];return (B.l+B.r)-(A.l+A.r)||a.order-b.order});
    const used=new Array(n).fill(false),placements=[];let best=[],bestScore=-Infinity;
    function scorePlan(arr){let priority=0,edge=0;for(const p of arr){priority+=(input.length-p.device.order+1);if(p.pos===0||p.pos===n-1)edge+=(p.l+p.r)}return arr.length*100000+priority*20+edge}
    function consider(){const sc=scorePlan(placements);if(sc>bestScore){bestScore=sc;best=placements.map(p=>({...p}))}}
    function can(pos,o){for(let k=pos-o.l;k<=pos+o.r;k++){if(k>=0&&k<n&&used[k])return false}return true}
    function mark(pos,o,v){for(let k=pos-o.l;k<=pos+o.r;k++){if(k>=0&&k<n)used[k]=v}}
    function rec(i){if(i>=ordered.length){consider();return}if(placements.length+(ordered.length-i)<best.length)return;const d=ordered[i],opts=orientations(d);
      const positions=[...Array(n).keys()].sort((a,b)=>Math.min(a,n-1-a)-Math.min(b,n-1-b));
      for(const o of opts){for(const pos of positions){if(!can(pos,o))continue;mark(pos,o,true);placements.push({device:d,pos,l:o.l,r:o.r,turned:o.turned});rec(i+1);placements.pop();mark(pos,o,false)}}
      rec(i+1)
    }
    rec(0);return{plan:best,input}
  }
  function directionText(p){const base=p.l&&p.r?'两边都占空间':p.l?'外壳向左':p.r?'外壳向右':'不挡旁边';return p.turned?`${base} · 翻 180°`:base}
  function showResult(){
    const {plan,input}=solvePlan(),placedIds=new Set(plan.map(p=>p.device.id)),missing=input.filter(d=>!placedIds.has(d.id));
    resultMeta.textContent=`${n} 孔 · ${input.length} 个插头`;verdict.textContent=missing.length?`最多插下 ${plan.length} / ${input.length} 个`:'全部塞下';
    verdictNote.textContent=missing.length?'已经把能翻面的方向一起算过；下面这套是当前描述下能放下数量最多的一种排法。':'已经同时尝试了插孔位置和可翻 180° 的方向，下面直接照顺序插。';
    renderStrip(planStrip,n,plan);planList.innerHTML=[...plan].sort((a,b)=>a.pos-b.pos).map(p=>`<li><strong>${esc(p.device.name)} → 第 ${p.pos+1} 孔</strong><span>${directionText(p)}</span></li>`).join('');
    notFit.hidden=!missing.length;if(missing.length)notFitNames.textContent=missing.map(x=>x.name).join('、');intro.hidden=true;result.hidden=false;window.scrollTo({top:0,behavior:'instant'})
  }
  function returnEdit(){result.hidden=true;intro.hidden=false;window.scrollTo({top:0,behavior:'instant'})}
  function resetAll(){n=6;nextId=4;devices=[{id:1,name:'插头 1',shape:'solo',flip:false},{id:2,name:'插头 2',shape:'right',flip:true},{id:3,name:'插头 3',shape:'both',flip:false}];returnEdit();renderSetup()}

  minus.onclick=()=>{n=Math.max(3,n-1);renderSetup()};plus.onclick=()=>{n=Math.min(12,n+1);renderSetup()};add.onclick=()=>{if(devices.length>=10)return;devices.push({id:nextId,name:`插头 ${devices.length+1}`,shape:'solo',flip:false});nextId++;renderDevices();add.disabled=devices.length>=10};solve.onclick=showResult;back.onclick=returnEdit;edit.onclick=returnEdit;reset.onclick=resetAll;
  renderSetup();
})();