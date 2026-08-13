(()=>{
'use strict';
const state=document.getElementById('rosterState');
const pick=document.getElementById('pickRoster');
if(!state||!pick)return;
const bar=state.querySelector('.roster-quick');
if(!bar)return;
const buttons=[...bar.querySelectorAll('button')];
const paste=buttons.find(b=>b.textContent.includes('粘贴'));
const clear=buttons.find(b=>b.textContent.includes('清空'));
pick.textContent='选择';
if(paste)paste.textContent='粘贴';
if(clear)clear.textContent='清空';
bar.prepend(pick);
})();