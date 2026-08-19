export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const med=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const pct=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.round((s.length-1)*p)))]};

function ink(r,g,b,mode='red'){
  const max=Math.max(r,g,b),min=Math.min(r,g,b),ch=max-min,sat=ch/Math.max(1,max),lum=.2126*r+.7152*g+.0722*b;
  if(lum>247||max<42)return 0;
  const red=r-Math.max(g,b);
  if(mode==='red')return red>16&&r>78&&sat>.11?clamp((red-12)/54,0,1)*clamp((247-lum)/92,.25,1):0;
  return ch>22&&sat>.14?clamp((ch-18)/70,0,1)*clamp((247-lum)/100,.22,1):0;
}

export function analyzeStrip(imageData,bins=192){
  const {data,width:w,height:h}=imageData,redHist=new Float32Array(bins),colorHist=new Float32Array(bins);let red=0,color=0;
  const step=h>950?2:1;
  for(let y=0;y<h;y+=step){const bin=Math.min(bins-1,Math.floor(y/h*bins));for(let x=0;x<w;x+=step){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2],rs=ink(r,g,b,'red'),cs=ink(r,g,b,'color');if(rs){red+=rs;redHist[bin]+=rs}if(cs){color+=cs;colorHist[bin]+=cs}}}
  return{red,color,redHist,colorHist,width:w,height:h};
}

function addHist(target,src){for(let i=0;i<target.length;i++)target[i]+=src[i]||0}
function bestBand(hist){
  const n=hist.length,win=Math.max(30,Math.round(n*.24));let sum=0,best=-1,start=0;
  for(let i=0;i<n;i++){sum+=hist[i];if(i>=win)sum-=hist[i-win];if(sum>best){best=sum;start=Math.max(0,i-win+1)}}
  const local=Array.from(hist.slice(start,start+win)),peak=pct(local,.82);let a=start,b=Math.min(n-1,start+win-1);
  for(let i=start;i<=b;i++){if(hist[i]>=peak*.18){a=Math.max(0,i-8);break}}
  for(let i=b;i>=a;i--){if(hist[i]>=peak*.18){b=Math.min(n-1,i+8);break}}
  if(b-a<n*.13){const c=(a+b)/2;a=Math.max(0,Math.round(c-n*.075));b=Math.min(n-1,Math.round(c+n*.075))}
  return{start:a/n,end:(b+1)/n,score:best};
}

export function chooseDetection(pages,forcedSide='auto'){
  const bins=192,sides=['left','right'],stats={};
  for(const side of sides){const redHist=new Float32Array(bins),colorHist=new Float32Array(bins);let red=0,color=0,redPages=0,colorPages=0;
    for(const p of pages){const a=p[side].analysis;red+=a.red;color+=a.color;addHist(redHist,a.redHist);addHist(colorHist,a.colorHist);if(a.red>12)redPages++;if(a.color>16)colorPages++}
    stats[side]={red,color,redPages,colorPages,redHist,colorHist};
  }
  const pageN=Math.max(1,pages.length),score=s=>Math.max(stats[s].red*(.65+.35*stats[s].redPages/pageN),stats[s].color*(.52+.48*stats[s].colorPages/pageN));
  const side=forcedSide==='left'||forcedSide==='right'?forcedSide:(score('right')>=score('left')?'right':'left'),s=stats[side];
  const redEnough=s.redPages>=Math.max(2,Math.ceil(pageN*.18))&&s.red>=Math.max(80,pageN*12),mode=redEnough?'red':'color',hist=mode==='red'?s.redHist:s.colorHist,total=mode==='red'?s.red:s.color,pagesWith=mode==='red'?s.redPages:s.colorPages;
  return{side,mode,band:bestBand(hist),total,pagesWith,sideScores:{left:score('left'),right:score('right')}};
}

function bandMetrics(imageData,band,mode){
  const {data,width:w,height:h}=imageData,y0=clamp(Math.floor(band.start*h),0,h-1),y1=clamp(Math.ceil(band.end*h),y0+1,h);let amount=0,minX=w,maxX=-1,yWeight=0;
  for(let y=y0;y<y1;y++){for(let x=0;x<w;x++){const i=(y*w+x)*4,s=ink(data[i],data[i+1],data[i+2],mode);if(s>.08){amount+=s;minX=Math.min(minX,x);maxX=Math.max(maxX,x);yWeight+=y*s}}}
  if(maxX<0)return{amount:0,span:0,centerY:(y0+y1)/2,y0,y1};
  return{amount,span:maxX-minX+1,centerY:yWeight/Math.max(.001,amount),y0,y1,minX,maxX};
}

function maskSignature(imageData,band,mode,side){
  const {data,width:w,height:h}=imageData,y0=clamp(Math.floor(band.start*h),0,h-1),y1=clamp(Math.ceil(band.end*h),y0+1,h),out=new Float32Array(y1-y0),depth=clamp(Math.round(w*.18),8,22);let max=0;
  for(let y=y0;y<y1;y++){let s=0;for(let d=0;d<depth;d++){const x=side==='right'?w-1-d:d;if(x<0||x>=w)continue;const i=(y*w+x)*4;s=Math.max(s,ink(data[i],data[i+1],data[i+2],mode))}out[y-y0]=s;max=Math.max(max,s)}
  if(max>.001)for(let i=0;i<out.length;i++)out[i]/=max;return out;
}

function signatureSimilarity(a,b){
  if(!a?.length||!b?.length)return 0;let best=0;
  for(let shift=-7;shift<=7;shift++){let hit=0,union=0,n=0;for(let i=0;i<a.length;i++){const j=i+shift;if(j<0||j>=b.length)continue;const x=a[i],y=b[j];hit+=Math.min(x,y);union+=Math.max(x,y);n++}if(n&&union>0)best=Math.max(best,hit/union)}return best;
}

export function measurePages(pages,detection){
  const {side,mode,band}=detection,rows=pages.map((p,index)=>{const m=bandMetrics(p[side].image,band,mode),sig=maskSignature(p[side].image,band,mode,side);return{index,page:index+1,...m,sig}});
  const nonzero=rows.filter(x=>x.amount>10),amountMed=med(nonzero.map(x=>x.amount)),spanMed=med(nonzero.map(x=>x.span));
  for(const r of rows){r.found=amountMed>0&&r.amount>Math.max(7,amountMed*.13);r.weak=r.found&&r.amount<amountMed*.34}
  const seams=[];for(let i=0;i<rows.length-1;i++){const eligible=rows[i].found&&rows[i+1].found,score=eligible?signatureSimilarity(rows[i].sig,rows[i+1].sig):0;seams.push({after:i+1,before:i+2,score,eligible})}
  const useful=seams.filter(x=>x.eligible&&x.score>0).map(x=>x.score),sMed=med(useful),sLow=sMed?Math.max(.045,sMed*.34):0;
  for(const s of seams)s.suspicious=s.eligible&&sLow>0&&s.score<sLow;
  const stripW=pages[0]?.[side]?.image?.width||80,autoWidth=clamp(Math.round(Math.max(8,spanMed+5)),8,Math.round(stripW*.72));
  return{rows,seams,amountMed,spanMed,autoWidth,suspiciousPages:rows.filter(x=>!x.found),suspiciousSeams:seams.filter(x=>x.suspicious)};
}

function drawImageDataCrop(ctx,img,sx,sy,sw,sh,dx,dy,dw,dh){
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').putImageData(img,0,0);ctx.drawImage(c,sx,sy,sw,sh,dx,dy,dw,dh);
}

export function buildReconstruction(pages,detection,measure,{reverse=false,widthScale=1}={}){
  const {side,band}=detection,src=[...pages];if(reverse)src.reverse();const stripW=pages[0]?.[side]?.image?.width||80,baseW=clamp(Math.round(measure.autoWidth*widthScale),6,Math.round(stripW*.85));
  const targetH=420,gap=1,labelH=30,totalW=Math.max(1,src.length*baseW+(src.length-1)*gap),canvas=document.createElement('canvas');canvas.width=Math.min(9000,totalW);canvas.height=targetH+labelH;const ctx=canvas.getContext('2d');ctx.fillStyle='#f3f2ed';ctx.fillRect(0,0,canvas.width,canvas.height);
  const scaleX=canvas.width/totalW;let x=0;const marks=[];
  src.forEach((p,idx)=>{const img=p[side].image,y0=clamp(Math.floor(band.start*img.height),0,img.height-1),y1=clamp(Math.ceil(band.end*img.height),y0+1,img.height),sw=Math.min(baseW,img.width),sx=side==='right'?img.width-sw:0,dw=Math.max(1,Math.round(baseW*scaleX)),dx=Math.round(x*scaleX);drawImageDataCrop(ctx,img,sx,y0,sw,y1-y0,dx,0,dw,targetH);ctx.fillStyle='rgba(17,18,15,.14)';if(idx<src.length-1)ctx.fillRect(dx+dw,0,1,targetH);ctx.fillStyle='#6f706a';ctx.font='11px system-ui,-apple-system,sans-serif';ctx.textAlign='center';ctx.fillText(String(p.page).padStart(2,'0'),dx+dw/2,targetH+19);marks.push({page:p.page,x:dx,w:dw});x+=baseW+gap});
  return{canvas,marks,width:baseW};
}

export function issueSummary(measure){const pages=measure.suspiciousPages.map(x=>x.page),seams=measure.suspiciousSeams.map(x=>[x.after,x.before]);return{pages,seams,count:pages.length+seams.length}}
