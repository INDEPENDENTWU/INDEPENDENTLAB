(()=>{
'use strict';
const state=document.getElementById('rosterState'),pick=document.getElementById('pickRoster');
if(!state||!pick)return;
const STORE='missing-roster-v2';
const bar=document.createElement('div');bar.className='roster-quick';
const pasteBtn=document.createElement('button');pasteBtn.type='button';pasteBtn.textContent='粘贴名单';
const clearBtn=document.createElement('button');clearBtn.type='button';clearBtn.textContent='清空';
bar.append(pasteBtn,clearBtn);state.appendChild(bar);
const sheet=document.createElement('section');sheet.className='roster-paste-sheet';sheet.hidden=true;sheet.innerHTML='<div class="roster-paste-card"><header><strong>粘贴名单</strong><button type="button" data-close>关闭</button></header><textarea placeholder="直接从 Excel、群名单或文本里复制。\n\n张三\n李四\n王五\n\n或者：\n2026001\t张三\n2026002\t李四"></textarea><small>一人一行最稳。只有姓名也可以；带学号时会优先用学号匹配文件。</small><p data-error hidden></p><button class="roster-paste-use" type="button">记住这份名单</button></div>';
document.body.appendChild(sheet);
const ta=sheet.querySelector('textarea'),close=sheet.querySelector('[data-close]'),use=sheet.querySelector('.roster-paste-use'),err=sheet.querySelector('[data-error]');
function compact(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\-_.—–·•~`!@#$%^&*+=|\\/:;；,，、()（）\[\]【】{}<>《》'"“”‘’]+/g,'')}
function maybeId(s){return /^(?=.*\d)[a-z0-9_-]{3,24}$/i.test(s)}
function splitLines(raw){return String(raw||'').replace(/\r/g,'').split('\n').map(x=>x.trim()).filter(Boolean)}
function makePerson(line,index){let cells=line.includes('\t')?line.split(/\t+/):line.includes(',')?line.split(/,+/):line.split(/\s{2,}|\s+/);cells=cells.map(x=>x.trim()).filter(Boolean);if(!cells.length)return null;const ids=cells.filter(maybeId);let name='';for(const c of cells){if(/^[\u3400-\u9fff·]{2,12}$/.test(c)&&!maybeId(c)){name=c;break}}if(!name){const latin=cells.find(x=>!maybeId(x)&&/^[A-Za-z][A-Za-z .'-]{1,48}$/.test(x));if(latin)name=latin.trim()}if(!name&&cells.length===1&&!/^\d+$/.test(cells[0]))name=cells[0];if(!name&&!ids.length)return null;const aliases=[];const add=(v,type)=>{const x=compact(v);if(x.length>=2&&!aliases.some(a=>a.v===x))aliases.push({v:x,type})};ids.forEach(x=>add(x,'id'));if(name){add(name,'name');if(/^[A-Za-z .'-]+$/.test(name)&&name.includes(' ')){const p=name.toLowerCase().split(/\s+/).filter(Boolean);add(p.join(''),'name');add([...p].reverse().join(''),'name')}}return{index,label:name||ids[0],ids,aliases,raw:cells}}
function parse(raw){const people=[];for(const line of splitLines(raw)){const p=makePerson(line,people.length);if(p)people.push(p)}const freq=new Map();for(const p of people)for(const a of p.aliases)freq.set(a.v,(freq.get(a.v)||0)+1);for(const p of people)p.aliases=p.aliases.filter(a=>a.type==='id'||freq.get(a.v)===1);const out=[],seen=new Set();for(const p of people){const key=p.ids[0]||compact(p.label);if(!key||seen.has(key))continue;seen.add(key);p.index=out.length;out.push(p)}return out}
async function openPaste(){sheet.hidden=false;err.hidden=true;ta.value='';try{const text=await navigator.clipboard?.readText?.();if(text&&text.trim())ta.value=text}catch{}setTimeout(()=>ta.focus(),80)}
pasteBtn.onclick=openPaste;close.onclick=()=>sheet.hidden=true;sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.hidden=true});
use.onclick=()=>{const people=parse(ta.value);if(people.length<2){err.textContent='至少需要两个人。每人一行最稳。';err.hidden=false;return}try{localStorage.setItem(STORE,JSON.stringify({source:'粘贴的名单',people}));location.reload()}catch{err.textContent='这台浏览器没有保存成功。';err.hidden=false}};
clearBtn.onclick=()=>{try{localStorage.removeItem(STORE)}catch{}location.reload()};
function sync(){let has=false;try{has=!!JSON.parse(localStorage.getItem(STORE)||'null')?.people?.length}catch{}clearBtn.hidden=!has}
sync();
})();