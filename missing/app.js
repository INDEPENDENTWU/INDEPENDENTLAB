(()=>{
'use strict';
const $=s=>document.querySelector(s);
const intro=$('#intro'),rosterText=$('#rosterText'),rosterCount=$('#rosterCount'),rosterEdit=$('#rosterEdit'),editRoster=$('#editRoster'),pick=$('#pick'),filesInput=$('#files'),error=$('#error');
const result=$('#result'),back=$('#back'),again=$('#again'),batchMeta=$('#batchMeta'),submitted=$('#submitted'),total=$('#total'),summaryText=$('#summaryText');
const missingBlock=$('#missingBlock'),missingCount=$('#missingCount'),missingList=$('#missingList'),duplicateBlock=$('#duplicateBlock'),duplicateCount=$('#duplicateCount'),duplicateList=$('#duplicateList'),unmatchedBlock=$('#unmatchedBlock'),unmatchedCount=$('#unmatchedCount'),unmatchedList=$('#unmatchedList'),copyMissing=$('#copyMissing'),changeRoster=$('#changeRoster');
let roster=[],batch=[],manual=new Map(),lastMissing=[];
const STORE='missing-roster-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setError(t=''){error.hidden=!t;error.textContent=t}
function compact(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/\.[a-z0-9]{1,8}$/i,'').replace(/[\s\-_.—–·•~`!@#$%^&*+=|\\/:;；,，、()（）\[\]【】{}<>《》'"“”‘’]+/g,'')}
function normalizeAlias(s){return compact(s).replace(/^(姓名|名字|学号|编号|id)/i,'')}
function splitRoster(raw){let lines=String(raw||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean);if(lines.length===1&&/[，,、;；]/.test(lines[0]))lines=lines[0].split(/[，,、;；]+/).map(x=>x.trim()).filter(Boolean);return [...new Set(lines)]}
function personFromLine(line,index){
  let cols=line.includes('\t')?line.split(/\t+/):line.includes(',')?line.split(/,+/):line.split(/\s+/);cols=cols.map(x=>x.trim()).filter(Boolean);
  const ids=cols.filter(x=>/^(?=.*\d)[a-z0-9_-]{3,24}$/i.test(x));
  let nameParts=cols.filter(x=>!ids.includes(x));
  let name=nameParts.join(' ').trim()||line.trim();
  if(nameParts.length>1&&nameParts.every(x=>/[\u3400-\u9fff]/.test(x)&&x.length<=8))name=nameParts[0];
  const aliases=[];
  const add=(value,type)=>{const v=normalizeAlias(value);if(v.length>=2&&!aliases.some(a=>a.v===v))aliases.push({v,type})};
  ids.forEach(x=>add(x,'id'));
  add(name,'name');
  if(/^[a-z\s.'-]+$/i.test(name)&&name.trim().includes(' ')){const parts=name.toLowerCase().split(/\s+/).filter(Boolean);add(parts.join(''),'name');if(parts.length===2)add(parts.slice().reverse().join(''),'name')}
  if(cols.length>1){for(const c of cols){if(/^[\u3400-\u9fff]{2,5}$/.test(c))add(c,'name')}}
  return{index,line,label:name||line,ids,aliases}
}
function parseRoster(raw){
  const people=splitRoster(raw).map(personFromLine);
  const freq=new Map();for(const p of people)for(const a of p.aliases)freq.set(a.v,(freq.get(a.v)||0)+1);
  for(const p of people)p.aliases=p.aliases.filter(a=>a.type==='id'||freq.get(a.v)===1);
  return people
}
function saveRoster(){try{localStorage.setItem(STORE,rosterText.value)}catch{}}
function updateRoster(collapse=false){roster=parseRoster(rosterText.value);rosterCount.textContent=roster.length?`已记住 ${roster.length} 人`:'还没记名单';pick.disabled=!roster.length;editRoster.hidden=!roster.length;saveRoster();if(collapse&&roster.length)rosterEdit.hidden=true}
function fileCompact(name){return compact(String(name||'').replace(/\.(tar\.gz|tar\.bz2|tar\.xz)$/i,''))}
function autoMatch(file){
  const hay=fileCompact(file.name),hits=[];
  for(const p of roster){let best=0,why='';for(const a of p.aliases){if(!a.v||!hay.includes(a.v))continue;const score=(a.type==='id'?220:100)+a.v.length*4;if(score>best){best=score;why=a.v}}if(best)hits.push({person:p,score:best,why})}
  hits.sort((a,b)=>b.score-a.score||b.why.length-a.why.length);
  if(!hits.length)return null;
  if(hits.length>1&&hits[0].score===hits[1].score)return null;
  return hits[0].person.index
}
function compute(){
  const assignments=roster.map(()=>[]),unmatched=[];
  batch.forEach((file,i)=>{let pi=manual.has(i)?manual.get(i):autoMatch(file);if(Number.isInteger(pi)&&roster[pi])assignments[pi].push({file,index:i,manual:manual.has(i)});else unmatched.push({file,index:i})});
  const missing=[],dupes=[];assignments.forEach((arr,i)=>{if(!arr.length)missing.push(roster[i]);else if(arr.length>1)dupes.push({person:roster[i],files:arr})});
  return{assignments,missing,dupes,unmatched,submitted:assignments.filter(x=>x.length).length}
}
function row(name,note='',right=''){return`<div class="row"><div class="row-main"><strong>${esc(name)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>${right?`<em>${esc(right)}</em>`:''}</div>`}
function render(){
  const r=compute();lastMissing=r.missing;submitted.textContent=String(r.submitted);total.textContent=String(roster.length);batchMeta.textContent=`${batch.length} 个文件`;
  const extra=r.unmatched.length?`，另有 ${r.unmatched.length} 个文件名没认出来`:'';summaryText.textContent=r.missing.length?`${r.missing.length} 人还没匹配到文件${extra}。`:`名单里的人都匹配到了${extra}。`;
  missingCount.textContent=`${r.missing.length} 人`;missingList.innerHTML=r.missing.length?r.missing.map(p=>row(p.label,p.ids[0]?`学号 ${p.ids[0]}`:'','未匹配')).join(''):'<div class="empty-row">这批已经收齐。</div>';
  duplicateBlock.hidden=!r.dupes.length;duplicateCount.textContent=`${r.dupes.length} 人`;duplicateList.innerHTML=r.dupes.map(x=>row(x.person.label,x.files.map(y=>y.file.name).join(' · '),`${x.files.length} 份`)).join('');
  unmatchedBlock.hidden=!r.unmatched.length;unmatchedCount.textContent=`${r.unmatched.length} 个`;
  unmatchedList.innerHTML=r.unmatched.map(x=>{const opts=roster.map((p,i)=>`<option value="${i}">${esc(p.label)}</option>`).join('');return`<div class="row unmatched"><div class="row-main"><strong>${esc(x.file.name)}</strong><small>文件名里没有找到唯一姓名或学号</small></div><select data-file="${x.index}" aria-label="手动指定 ${esc(x.file.name)}"><option value="">归给谁</option>${opts}</select></div>`}).join('');
  unmatchedList.querySelectorAll('select').forEach(s=>s.onchange=()=>{const fi=Number(s.dataset.file),pi=Number(s.value);if(Number.isInteger(pi)&&s.value!=='')manual.set(fi,pi);else manual.delete(fi);render()});
}
function openBatch(list){setError('');if(!roster.length){setError('先贴一份名单。');rosterEdit.hidden=false;return}batch=[...list].filter(f=>f&&f.name);if(!batch.length){setError('没有选到文件。');return}manual.clear();intro.hidden=true;result.hidden=false;render();window.scrollTo({top:0,behavior:'instant'})}
function showIntro(edit=false){result.hidden=true;intro.hidden=false;if(edit){rosterEdit.hidden=false;setTimeout(()=>rosterText.focus(),80)}else if(roster.length)rosterEdit.hidden=true;window.scrollTo({top:0,behavior:'instant'})}
rosterText.value=(()=>{try{return localStorage.getItem(STORE)||''}catch{return''}})();updateRoster(true);
let inputTimer=0;rosterText.addEventListener('input',()=>{clearTimeout(inputTimer);inputTimer=setTimeout(()=>updateRoster(false),120)});
editRoster.onclick=()=>{rosterEdit.hidden=!rosterEdit.hidden;if(!rosterEdit.hidden)rosterText.focus()};
pick.onclick=()=>filesInput.click();filesInput.onchange=()=>{openBatch(filesInput.files);filesInput.value=''};
back.onclick=()=>showIntro(false);again.onclick=()=>filesInput.click();changeRoster.onclick=()=>showIntro(true);
copyMissing.onclick=async()=>{const text=lastMissing.map(x=>x.label).join('\n');if(!text){copyMissing.textContent='已经收齐';setTimeout(()=>copyMissing.textContent='复制没交名单',900);return}try{await navigator.clipboard.writeText(text);copyMissing.textContent='已复制';setTimeout(()=>copyMissing.textContent='复制没交名单',900)}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch{}ta.remove()}};
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault()});document.addEventListener('drop',e=>{if(!e.dataTransfer?.files?.length)return;e.preventDefault();openBatch(e.dataTransfer.files)});
})();