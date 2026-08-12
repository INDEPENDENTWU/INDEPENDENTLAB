(()=>{
  const $=s=>document.querySelector(s),form=$('#form'),intro=$('#intro'),result=$('#result'),error=$('#error');
  const ids=['boxL','boxW','boxH','itemL','itemW','itemH'],inputs=Object.fromEntries(ids.map(id=>[id,$('#'+id)]));
  const paddingBox=$('#padding'),back=$('#back'),reset=$('#reset'),planType=$('#planType'),targetSize=$('#targetSize'),orientationText=$('#orientationText'),scoreLine=$('#scoreLine'),cutDepth=$('#cutDepth'),cutCaption=$('#cutCaption'),steps=$('#steps'),advanced=$('#advanced'),flat=$('#flat'),flatSvg=$('#flatSvg'),marks=$('#marks');
  let padding=1,last=null;
  const n=v=>Number(String(v).replace(',','.')),fmt=v=>Number.isFinite(v)?(Math.abs(v-Math.round(v))<.04?String(Math.round(v)):v.toFixed(1)):'—',clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function setError(t=''){error.hidden=!t;error.textContent=t}
  function vals(){const o={};for(const id of ids)o[id]=n(inputs[id].value);return o}
  function valid(v){return Object.values(v).every(x=>Number.isFinite(x)&&x>0&&x<=500)}
  function chooseBase(v){
    const a=v.itemL+padding*2,b=v.itemW+padding*2,h=v.itemH+padding*2,candidates=[{l:a,w:b,h,turn:false},{l:b,w:a,h,turn:true}].filter(x=>x.l<=v.boxL+.001&&x.w<=v.boxW+.001&&x.h<=v.boxH+.001);
    if(!candidates.length)return null;return candidates.sort((x,y)=>{const sx=(v.boxL-x.l)+(v.boxW-x.w),sy=(v.boxL-y.l)+(v.boxW-y.w);return sx-sy})[0]
  }
  function stepList(arr){steps.innerHTML=arr.map(t=>`<li>${t}</li>`).join('')}
  function showSimple(v,c){
    const targetH=Math.min(v.boxH,c.h),drop=Math.max(0,v.boxH-targetH),ratio=drop/v.boxH;last={v,c,targetH,drop};flat.hidden=true;advanced.querySelector('b').textContent='+';
    targetSize.textContent=`${fmt(v.boxL)} × ${fmt(v.boxW)} × ${fmt(targetH)} cm`;
    orientationText.textContent=c.turn?`把物品在箱底转 90° 放，底面按 ${fmt(c.l)} × ${fmt(c.w)} cm 占用；四周和上下按约 ${fmt(padding)} cm 余量计算。`:`物品按现在的长宽方向放，底面按 ${fmt(c.l)} × ${fmt(c.w)} cm 占用；四周和上下按约 ${fmt(padding)} cm 余量计算。`;
    if(drop<.8){planType.textContent='不用改';cutDepth.textContent='0 cm';cutCaption.textContent='现有高度已经很接近';scoreLine.style.bottom='12px';stepList(['先把物品按上面的方向放进箱子确认一次。','现有纸箱高度和需要的高度只差很少，继续切箱反而增加结构损失。','直接用填充物固定空隙并正常封箱。']);advanced.hidden=false;return}
    planType.textContent='只改高度';cutDepth.textContent=`${fmt(drop)} cm`;cutCaption.textContent='从箱顶往下';scoreLine.style.bottom=`${clamp(12+ratio*70,18,78)}px`;
    stepList([`从纸箱顶部沿四个竖角分别往下量 ${fmt(drop)} cm，各做一个小记号。`,`把四个记号沿纸箱四面连成一圈；沿这条线轻压出新折痕，不要切穿。`,`只沿四条竖角从箱顶剪到新折线，剪 ${fmt(drop)} cm 深。`,`把原来的四片顶盖沿新折线向内折，装入物品和填充物后封箱。`]);advanced.hidden=false
  }
  function drawFlat(v,c){
    let L=Math.max(c.l,c.w),W=Math.min(c.l,c.w),H=c.h,tab=Math.min(3,Math.max(2,W*.14)),per=2*(L+W),blankW=per+tab,blankH=H+W;
    const sx=620/blankW,sy=290/blankH,s=Math.min(sx,sy),ox=40,oy=32,ww=blankW*s,hh=blankH*s,y1=oy+(W/2)*s,y2=oy+(W/2+H)*s,xs=[L,L+W,2*L+W,per].map(x=>ox+x*s),cutX=ox+(per+tab)*s;
    const ns='http://www.w3.org/2000/svg';flatSvg.innerHTML='';
    const add=(tag,a)=>{const el=document.createElementNS(ns,tag);for(const [k,val] of Object.entries(a))el.setAttribute(k,val);flatSvg.appendChild(el);return el};
    add('rect',{x:ox,y:oy,width:ww,height:hh,fill:'none',stroke:'#11120f','stroke-width':'2'});
    for(const x of xs)add('line',{x1:x,y1:oy,x2:x,y2:oy+hh,stroke:'#bf5a2e','stroke-width':'2','stroke-dasharray':'7 6'});
    add('line',{x1:ox,y1:y1,x2:cutX,y2:y1,stroke:'#11120f','stroke-width':'1.6','stroke-dasharray':'6 6'});add('line',{x1:ox,y1:y2,x2:cutX,y2:y2,stroke:'#11120f','stroke-width':'1.6','stroke-dasharray':'6 6'});
    for(const x of xs.slice(0,3)){add('line',{x1:x,y1:oy,x2:x,y2:y1,stroke:'#11120f','stroke-width':'2'});add('line',{x1:x,y1:y2,x2:x,y2:oy+hh,stroke:'#11120f','stroke-width':'2'})}
    add('line',{x1:xs[3],y1:oy,x2:xs[3],y2:oy+hh,stroke:'#bf5a2e','stroke-width':'3'});
    const label=(x,y,t,anchor='middle')=>{const el=add('text',{x,y,fill:'#6f6d67','font-size':'13','text-anchor':anchor,'font-family':'sans-serif'});el.textContent=t};
    label(ox+L*s/2,oy+hh/2,`长 ${fmt(L)}`);label(ox+(L+W/2)*s,oy+hh/2,`宽 ${fmt(W)}`);label(ox+(L+W+L/2)*s,oy+hh/2,`长 ${fmt(L)}`);label(ox+(2*L+W+W/2)*s,oy+hh/2,`宽 ${fmt(W)}`);label(xs[3]+tab*s/2,oy+hh/2,'粘合');
    marks.innerHTML=`<div><span>竖折线 1</span><strong>${fmt(L)} cm</strong></div><div><span>竖折线 2</span><strong>${fmt(L+W)} cm</strong></div><div><span>竖折线 3</span><strong>${fmt(2*L+W)} cm</strong></div><div><span>一圈到这里</span><strong>${fmt(per)} cm</strong></div><div><span>下折线</span><strong>离边 ${fmt(W/2)} cm</strong></div><div><span>上折线</span><strong>离下折线 ${fmt(H)} cm</strong></div><div><span>保留粘合舌</span><strong>${fmt(tab)} cm</strong></div><div><span>新展开总高</span><strong>${fmt(blankH)} cm</strong></div>`;
  }
  function showAdvanced(){if(!last)return;flat.hidden=!flat.hidden;advanced.querySelector('b').textContent=flat.hidden?'+':'−';if(flat.hidden)return;drawFlat(last.v,last.c)}
  function submit(e){e.preventDefault();setError('');const v=vals();if(!valid(v)){setError('六个尺寸都填上 0–500 cm 的数字。');return}if(v.boxL<v.boxW){setError('纸箱“长”请填较长的一边，“宽”填较短的一边。');return}const c=chooseBase(v);if(!c){setError('按当前物品高度和留边，这个纸箱内部放不下。先确认长宽高有没有填反。');return}intro.hidden=true;result.hidden=false;showSimple(v,c);window.scrollTo({top:0,behavior:'instant'})}
  paddingBox.querySelectorAll('button').forEach(b=>b.onclick=()=>{padding=Number(b.dataset.v)||1;paddingBox.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b))});
  form.onsubmit=submit;advanced.onclick=showAdvanced;back.onclick=()=>{result.hidden=true;intro.hidden=false;window.scrollTo({top:0,behavior:'instant'})};reset.onclick=()=>{for(const id of ids)inputs[id].value='';result.hidden=true;intro.hidden=false;setError('');window.scrollTo({top:0,behavior:'instant'})};
})();