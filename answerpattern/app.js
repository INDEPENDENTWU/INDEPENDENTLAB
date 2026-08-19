const $=s=>document.querySelector(s);
const input=$('#input'),inputMeta=$('#inputMeta'),error=$('#error'),result=$('#result'),verdict=$('#verdict'),summary=$('#summary'),countEl=$('#count'),kindsEl=$('#kinds'),findingCount=$('#findingCount'),findings=$('#findings'),findingMeta=$('#findingMeta'),findingList=$('#findingList'),grid=$('#grid'),rangeText=$('#rangeText'),distribution=$('#distribution'),copyBtn=$('#copy'),clearBtn=$('#clear');
let current=null,selected=0,timer=0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setError(t=''){error.hidden=!t;error.textContent=t}
function normalizeRaw(raw){return String(raw||'').normalize('NFKC').toUpperCase().replace(/\r/g,'\n').replace(/[“”"']/g,'')}
function parseAnswers(raw){
  let s=normalizeRaw(raw).replace(/(?:参考)?答案(?:是|为|[:：])?/g,' ').replace(/ANSWER\s*KEY|ANSWERS?|KEY/g,' '),out=[];
  const numbered=/((?:^|[\s,;，；|]))(\d{1,4})\s*(?:[.、)）\]:：\-]\s*)?([A-H]{1,4}|T|F|√|×)(?=$|[\s,;，；|])/g;
  let m;while((m=numbered.exec(s)))out.push(m[3]);
  if(out.length>=3)return{answers:out,mode:'numbered'};
  const compact=s.replace(/[\s,;，；|/\\._:：、()（）\[\]{}<>《》\-]/g,'');
  if(/^[A-H]{4,1000}$/.test(compact))return{answers:[...compact],mode:'compact'};
  const pieces=s.replace(/\d{1,4}\s*[.、)）\]:：\-]/g,' ').split(/[\s,;，；|/\\]+/).map(x=>x.trim()).filter(Boolean);
  const letterTokens=pieces.filter(x=>/^(?:[A-H]{1,4}|T|F|√|×)$/.test(x));
  if(letterTokens.length>=3)return{answers:letterTokens,mode:'tokens'};
  if(!/[.、)）:：\-]/.test(s)){const nums=pieces.filter(x=>/^[1-8]$/.test(x));if(nums.length>=4&&nums.length===pieces.length)return{answers:nums,mode:'numeric'}}
  return{answers:letterTokens,mode:'tokens'};
}
function countsOf(a){const m=new Map;for(const x of a)m.set(x,(m.get(x)||0)+1);return m}
function longestRun(a){let best={len:0,start:0,end:0,token:''},start=0;for(let i=1;i<=a.length;i++){if(i<a.length&&a[i]===a[start])continue;const len=i-start;if(len>best.len)best={len,start,end:i-1,token:a[start]};start=i}return best}
function longestGap(a,token){let best={len:-1,start:0,end:-1},last=-1;for(let i=0;i<=a.length;i++){if(i<a.length&&a[i]!==token)continue;const start=last+1,end=i-1,len=end-start+1;if(len>best.len)best={len,start,end};last=i}return best}
function bestCluster(a,token,w){let c=0;for(let i=0;i<w;i++)if(a[i]===token)c++;let best={count:c,start:0,end:w-1};for(let i=w;i<a.length;i++){if(a[i]===token)c++;if(a[i-w]===token)c--;if(c>best.count)best={count:c,start:i-w+1,end:i}}return best}
function repeatedBlock(a){let best=null;for(let start=0;start<a.length-3;start++){for(let len=2;len<=Math.min(8,Math.floor((a.length-start)/2));len++){const block=a.slice(start,start+len);if(new Set(block).size===1)continue;let reps=1;while(start+(reps+1)*len<=a.length){let same=true;for(let j=0;j<len;j++)if(a[start+reps*len+j]!==block[j]){same=false;break}if(!same)break;reps++}const cover=reps*len;if(reps>=2&&cover>=6&&(!best||cover>best.cover||(cover===best.cover&&len>best.len)))best={start,end:start+cover-1,len,reps,block,cover}}}return best}
function hashSeed(a){let h=2166136261;for(const s of a){for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}h^=31;h=Math.imul(h,16777619)}return h>>>0}
function rngFrom(seed){let x=seed||123456789;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296}}
function shuffled(base,rng){const a=[...base];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function quantile(arr,q){if(!arr.length)return 0;const s=[...arr].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*q))]}
function analyze(a){
  const counts=countsOf(a),tokens=[...counts.keys()],n=a.length,w=n>=12?clamp(Math.round(n*.18),8,20):0,run=longestRun(a),repeat=repeatedBlock(a),samples=n<=180?420:n<=500?280:160,rng=rngFrom(hashSeed(a));
  const runSim=[],repeatSim=[],gapSim=new Map(tokens.map(t=>[t,[]])),clusterSim=new Map(tokens.map(t=>[t,[]]));
  for(let k=0;k<samples;k++){const s=shuffled(a,rng),rp=repeatedBlock(s);runSim.push(longestRun(s).len);repeatSim.push(rp?.cover||0);for(const t of tokens){gapSim.get(t).push(longestGap(s,t).len);if(w)clusterSim.get(t).push(bestCluster(s,t,w).count)}}
  const found=[];
  const runCut=quantile(runSim,.975);if(run.len>=4&&run.len>=runCut)found.push({type:'run',start:run.start,end:run.end,title:`${run.token} 连续 ${run.len} 题`,detail:`第 ${run.start+1}–${run.end+1} 题`,tag:'连续'});
  const repeatCut=quantile(repeatSim,.98);if(repeat&&repeat.cover>=8&&repeat.cover>=repeatCut)found.push({type:'repeat',start:repeat.start,end:repeat.end,title:`${repeat.block.join('')} 连续重复 ${repeat.reps} 轮`,detail:`第 ${repeat.start+1}–${repeat.end+1} 题`,tag:'重复'});
  for(const t of tokens){if((counts.get(t)||0)<2)continue;const g=longestGap(a,t),cut=quantile(gapSim.get(t),.98);if(g.len>=9&&g.len>=cut)found.push({type:'gap',start:g.start,end:g.end,title:`${t} 连续 ${g.len} 题没出现`,detail:g.start===0?`前 ${g.len} 题`:g.end===n-1?`最后 ${g.len} 题`:`第 ${g.start+1}–${g.end+1} 题`,tag:'空档'});if(w){const c=bestCluster(a,t,w),ccut=quantile(clusterSim.get(t),.985);if(c.count>=Math.ceil(w*.58)&&c.count>=ccut)found.push({type:'cluster',start:c.start,end:c.end,title:`${w} 题里有 ${c.count} 个 ${t}`,detail:`第 ${c.start+1}–${c.end+1} 题`,tag:'扎堆'})}}
  found.sort((x,y)=>{const pr={run:4,repeat:3,gap:2,cluster:1};return(pr[y.type]-pr[x.type])||((y.end-y.start)-(x.end-x.start))});
  const kept=[];for(const f of found){const dup=kept.some(k=>f.type===k.type&&Math.max(f.start,k.start)<=Math.min(f.end,k.end)&&Math.min(f.end,k.end)-Math.max(f.start,k.start)>=(Math.min(f.end-f.start,k.end-k.start)*.6));if(!dup)kept.push(f);if(kept.length>=5)break}
  return{answers:a,counts,tokens,findings:kept,window:w};
}
function renderGrid(){if(!current)return;const a=current.answers,f=current.findings[selected]||null,frag=document.createDocumentFragment();a.forEach((x,i)=>{const d=document.createElement('div');d.className='cell'+(f&&i>=f.start&&i<=f.end?' marked':'');d.dataset.i=String(i);d.innerHTML=`<i>${String(i+1).padStart(a.length>=100?3:2,'0')}</i><b>${esc(x)}</b>`;frag.appendChild(d)});grid.replaceChildren(frag);rangeText.textContent=`01–${a.length}`}
function renderDistribution(){const max=Math.max(...current.counts.values(),1);distribution.innerHTML=[...current.counts.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))).map(([k,v])=>`<div class="distribution-row"><b>${esc(k)}</b><div class="bar"><i style="width:${v/max*100}%"></i></div><span>${v}</span></div>`).join('')}
function chooseFinding(i){selected=i;renderFindings();renderGrid();const f=current?.findings[i];if(f)grid.querySelector(`[data-i="${f.start}"]`)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'})}
function renderFindings(){const fs=current.findings;findings.hidden=!fs.length;findingMeta.textContent=fs.length?`${fs.length} 处`:'';findingList.innerHTML=fs.map((f,i)=>`<button class="finding${i===selected?' active':''}" data-i="${i}" type="button"><i>${String(i+1).padStart(2,'0')}</i><span><strong>${esc(f.title)}</strong><small>${esc(f.detail)}</small></span><b>${f.tag}</b></button>`).join('');findingList.querySelectorAll('.finding').forEach(b=>b.onclick=()=>chooseFinding(Number(b.dataset.i)))}
function render(a){current=analyze(a);selected=0;result.hidden=false;const fs=current.findings;verdict.textContent=fs.length?`${fs.length} 处很显眼`:'没看到特别显眼的排列';summary.textContent=fs.length?'点一条，下面会标出对应位置。':'';summary.hidden=!summary.textContent;countEl.textContent=String(a.length);kindsEl.textContent=String(current.tokens.length);findingCount.textContent=String(fs.length);inputMeta.textContent=`识别 ${a.length} 题 · ${current.tokens.join(' / ')}`;renderFindings();renderGrid();renderDistribution();copyBtn.hidden=!fs.length}
function resetResult(){current=null;result.hidden=true;inputMeta.textContent='支持 A B C D、1.A 2.B、Excel 一列等常见格式';setError('')}
function process(){const raw=input.value;if(!raw.trim()){resetResult();return}const parsed=parseAnswers(raw),a=parsed.answers.slice(0,1000);if(a.length<4){result.hidden=true;inputMeta.textContent='至少需要 4 个答案';return}if(new Set(a).size>18){result.hidden=true;setError('识别出的答案种类太多，检查一下粘贴内容。');return}setError('');render(a);if(parsed.answers.length>1000)inputMeta.textContent=`识别前 1000 题 · ${current.tokens.join(' / ')}`}
input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(process,90)});
copyBtn.onclick=async()=>{if(!current)return;const lines=['答案纹路',...current.findings.map(f=>`${f.title}（${f.detail}）`)];try{await navigator.clipboard.writeText(lines.join('\n'));copyBtn.textContent='已复制';setTimeout(()=>copyBtn.textContent='复制结果',900)}catch{copyBtn.textContent='复制失败';setTimeout(()=>copyBtn.textContent='复制结果',900)}};
clearBtn.onclick=()=>{input.value='';resetResult();input.focus();window.scrollTo(0,0)};
