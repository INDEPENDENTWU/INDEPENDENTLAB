(()=>{
'use strict';
const $=s=>document.querySelector(s);
const intro=$('#intro'),startBtn=$('#start'),error=$('#error'),session=$('#session'),result=$('#result');
const cancel=$('#cancel'),finish=$('#finish'),restart=$('#restart'),back=$('#back'),share=$('#share');
const listenState=$('#listenState'),caughtLabel=$('#caughtLabel'),caughtWord=$('#caughtWord'),caughtCount=$('#caughtCount'),lastHeard=$('#lastHeard');
const repeatFlash=$('#repeatFlash'),repeatFlashWord=$('#repeatFlashWord'),ranking=$('#ranking'),utteranceCount=$('#utteranceCount'),timeEl=$('#time'),heard=$('#heard'),pulse=$('#pulse');
const resultTop=$('#resultTop'),resultMeta=$('#resultMeta'),resultList=$('#resultList');
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
const segmenter=typeof Intl!=='undefined'&&Intl.Segmenter?new Intl.Segmenter('zh-CN',{granularity:'word'}):null;
const HABITS=['然后','就是','其实','所以','但是','不过','因为','可能','感觉','我觉得','我认为','我想','这个','那个','就是说','等于说','怎么说','怎么讲','反正','基本上','实际上','事实上','然后呢','所以说','对吧','是吧','你知道','你懂吧','有一点','有点','大概','应该','好像','嗯','呃','额','啊'];
const STOP=new Set(['的','了','是','我','你','他','她','它','我们','你们','他们','她们','这个','那个','这些','那些','一个','一种','一下','一些','什么','怎么','为什么','可以','能够','没有','不是','还有','或者','如果','那么','就','也','都','在','有','和','跟','与','而','而且','把','被','让','给','对','从','到','上','下','里','外','中','会','要','很','太','更','最','比较','非常','这样','那样','这里','那里','现在','今天','时候','东西','事情']);
let recognition=null,wanted=false,restartTimer=0,startedAt=0,timer=0,utterances=[],latest=[],lastFlashAt=0;
const clean=s=>String(s||'').normalize('NFKC').replace(/[，。！？、,.!?；;：:“”‘’"'（）()\[\]【】]/g,' ').replace(/\s+/g,' ').trim();
const compact=s=>clean(s).replace(/\s+/g,'');
const fmtTime=ms=>{const s=Math.max(0,Math.floor(ms/1000)),m=Math.floor(s/60),r=s%60;return`${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`};
function setError(t=''){error.hidden=!t;error.textContent=t}
function add(map,key,type,uIndex,n=1){key=compact(key);if(!key||key.length>12)return;let x=map.get(key);if(!x){x={phrase:key,count:0,utter:new Set(),type};map.set(key,x)}x.count+=n;x.utter.add(uIndex);if(type==='habit')x.type='habit'}
function occurrences(text,needle){let n=0,i=0;while((i=text.indexOf(needle,i))>=0){n++;i+=Math.max(1,needle.length)}return n}
function tokenize(text){
  if(segmenter){const out=[];for(const x of segmenter.segment(text)){if(x.isWordLike===false)continue;const w=compact(x.segment);if(!w||/^\d+$/.test(w))continue;out.push(w)}return out}
  return clean(text).split(/\s+/).map(compact).filter(Boolean)
}
function analyze(){
  const map=new Map();
  utterances.forEach((u,idx)=>{
    const plain=compact(u);
    for(const h of HABITS){const n=occurrences(plain,h);if(n)add(map,h,'habit',idx,n)}
    const words=tokenize(u).filter(w=>w.length>=2&&w.length<=6&&!STOP.has(w));
    words.forEach(w=>add(map,w,'word',idx,1));
    for(let i=0;i<words.length-1;i++){const a=words[i],b=words[i+1],p=a+b;if(p.length>=4&&p.length<=10&&!STOP.has(a)&&!STOP.has(b))add(map,p,'phrase',idx,1)}
  });
  let arr=[...map.values()].filter(x=>x.type==='habit'?(x.count>=2&&x.utter.size>=2):(x.count>=3&&x.utter.size>=2));
  arr.forEach(x=>{const base=x.count+x.utter.size*.85;x.score=base+(x.type==='habit'?3.4:x.type==='phrase'?1.1:0)+Math.min(1.2,x.phrase.length*.08)});
  arr.sort((a,b)=>b.score-a.score||b.count-a.count||b.phrase.length-a.phrase.length);
  const out=[];
  for(const x of arr){const dup=out.find(y=>(y.phrase.includes(x.phrase)||x.phrase.includes(y.phrase))&&Math.abs(y.count-x.count)<=1);if(dup){if(x.phrase.length>dup.phrase.length&&x.type==='habit'){const i=out.indexOf(dup);out[i]=x}continue}out.push(x);if(out.length>=8)break}
  return out
}
function renderLive(lastText=''){
  latest=analyze();const top=latest[0];
  if(top){caughtLabel.textContent='现在最明显';caughtWord.textContent=top.phrase;caughtCount.textContent=`已经出现 ${top.count} 次`}else{caughtLabel.textContent=utterances.length<3?'先随便说一会儿':'还在找重复';caughtWord.textContent='—';caughtCount.textContent='还没有明显重复'}
  if(lastText)lastHeard.textContent=`刚才听到：${lastText.length>32?lastText.slice(0,32)+'…':lastText}`;
  ranking.innerHTML=latest.length?latest.slice(0,5).map((x,i)=>`<li><i>${String(i+1).padStart(2,'0')}</i><span>${x.phrase}</span><strong>× ${x.count}</strong></li>`).join(''):'<li class="empty">再说几句，它不会因为同一个词出现两次就急着下结论。</li>';
  utteranceCount.textContent=`${utterances.length} 段`;heard.textContent=`${utterances.length} 段`;
  if(lastText&&latest.length){const plain=compact(lastText),hit=latest.find(x=>x.count>=3&&plain.includes(x.phrase));if(hit&&performance.now()-lastFlashAt>900){lastFlashAt=performance.now();repeatFlashWord.textContent=hit.phrase;repeatFlash.hidden=false;clearTimeout(renderLive.flashTimer);renderLive.flashTimer=setTimeout(()=>repeatFlash.hidden=true,900)}}
}
function makeRecognition(){if(!SpeechRecognition)return null;const r=new SpeechRecognition();r.lang='zh-CN';r.continuous=true;r.interimResults=true;r.maxAlternatives=3;return r}
function stopRecognition(){wanted=false;clearTimeout(restartTimer);restartTimer=0;if(recognition){recognition.onend=null;try{recognition.abort()}catch{}recognition=null}pulse.classList.remove('live')}
function startRecognition(){
  if(!SpeechRecognition)throw new Error('unsupported');stopRecognition();wanted=true;const r=makeRecognition();recognition=r;
  r.onstart=()=>{listenState.textContent='正在听'};
  r.onspeechstart=()=>pulse.classList.add('live');r.onspeechend=()=>pulse.classList.remove('live');
  r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){const res=e.results[i];if(!res.isFinal)continue;const text=clean(res[0]?.transcript);if(!text)continue;utterances.push(text);renderLive(text)}};
  r.onerror=e=>{pulse.classList.remove('live');if(['not-allowed','service-not-allowed','audio-capture'].includes(e.error)){wanted=false;listenState.textContent='麦克风未开启';setError('需要允许浏览器使用麦克风和语音识别。')}};
  r.onend=()=>{pulse.classList.remove('live');if(wanted&&!document.hidden){clearTimeout(restartTimer);restartTimer=setTimeout(()=>{try{r.start()}catch{}},240)}};
  r.start()
}
function startTimer(){clearInterval(timer);startedAt=Date.now();timeEl.textContent='00:00';timer=setInterval(()=>timeEl.textContent=fmtTime(Date.now()-startedAt),500)}
function showSession(){intro.hidden=true;result.hidden=true;session.hidden=false;utterances=[];latest=[];lastFlashAt=0;repeatFlash.hidden=true;ranking.innerHTML='<li class="empty">再说几句，它不会因为同一个词出现两次就急着下结论。</li>';caughtLabel.textContent='先随便说一会儿';caughtWord.textContent='—';caughtCount.textContent='还没有明显重复';lastHeard.textContent='声音会被转成文字后统计，不保存录音。';utteranceCount.textContent='0 段';heard.textContent='0 段';setError('');startTimer();try{startRecognition()}catch{session.hidden=true;intro.hidden=false;clearInterval(timer);setError('当前浏览器没有提供可用的语音识别。')}}
function renderResult(){latest=analyze();const elapsed=Date.now()-startedAt;const top=latest[0];resultTop.textContent=top?top.phrase:'没抓到';resultMeta.textContent=top?`${fmtTime(elapsed)} 内出现 ${top.count} 次 · 共听到 ${utterances.length} 段`:`${fmtTime(elapsed)} · 暂时没有足够明显的重复`;resultList.innerHTML=latest.length?latest.slice(0,6).map((x,i)=>`<li><i>${String(i+1).padStart(2,'0')}</i><span>${x.phrase}</span><strong>× ${x.count}</strong></li>`).join(''):'<li><i>—</i><span>这次没有明显重复</span><strong></strong></li>'}
function finishSession(){stopRecognition();clearInterval(timer);session.hidden=true;result.hidden=false;renderResult();window.scrollTo({top:0,behavior:'instant'})}
function cancelSession(){stopRecognition();clearInterval(timer);session.hidden=true;result.hidden=true;intro.hidden=false;window.scrollTo({top:0,behavior:'instant'})}
function shareText(){const list=latest.slice(0,5);const text=list.length?`我刚才最常重复：${list.map(x=>`${x.phrase} × ${x.count}`).join('、')}`:'我刚才居然没有抓到明显口头禅。';if(navigator.share){navigator.share({title:'口头禅',text}).catch(()=>{})}else if(navigator.clipboard){navigator.clipboard.writeText(text).then(()=>{share.textContent='已复制';setTimeout(()=>share.textContent='分享结果',900)}).catch(()=>{})}}
startBtn.onclick=showSession;finish.onclick=finishSession;cancel.onclick=cancelSession;restart.onclick=showSession;back.onclick=cancelSession;share.onclick=shareText;
document.addEventListener('visibilitychange',()=>{if(session.hidden)return;if(document.hidden){stopRecognition();listenState.textContent='已暂停'}else{try{startRecognition()}catch{}}});
window.addEventListener('pagehide',()=>{stopRecognition();clearInterval(timer)});
})();