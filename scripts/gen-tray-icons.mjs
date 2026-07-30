import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

// ---------- PNG decode (RGB/RGBA -> {W,H,ch,data}) ----------
function decodePNG(file){
  const buf=readFileSync(file);let p=8;const cs=[]
  while(p<buf.length){const len=buf.readUInt32BE(p);p+=4;const t=buf.toString('ascii',p,p+4);p+=4;const d=buf.subarray(p,p+len);p+=len+4;cs.push({t,d})}
  const ih=cs[0].d;const W=ih.readUInt32BE(0),H=ih.readUInt32BE(4);const ch={0:1,2:3,3:1,4:2,6:4}[ih[9]]
  const raw=inflateSync(Buffer.concat(cs.filter(c=>c.t==='IDAT').map(c=>c.d)));const st=W*ch+1;const out=Buffer.alloc(W*H*ch);const prev=Buffer.alloc(W*ch)
  const pa=(a,b,c)=>{const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
  for(let y=0;y<H;y++){const f=raw[y*st];const cur=out.subarray(y*W*ch,(y+1)*W*ch);cur.set(raw.subarray(y*st+1,y*st+1+W*ch));for(let x=0;x<W*ch;x++){const L=x>=ch?cur[x-ch]:0,U=prev[x],UL=x>=ch?prev[x-ch]:0;let v=cur[x];if(f===1)v=(v+L)&255;else if(f===2)v=(v+U)&255;else if(f===3)v=(v+((L+U)>>1))&255;else if(f===4)v=(v+pa(L,U,UL))&255;cur[x]=v}prev.set(cur)}
  return{W,H,ch,data:out}
}
// ---------- PNG encode (RGBA, ch=4) ----------
const crcTab=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcTab[(c^b[i])&0xFF]^(c>>>8);const r=Buffer.alloc(4);r.writeUInt32BE((c^0xFFFFFFFF)>>>0,0);return r}
function chunk(t,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length,0);const tb=Buffer.from(t,'ascii');return Buffer.concat([len,tb,d,crc32(Buffer.concat([tb,d]))])}
function encodePNG(W,H,rgba){
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13)
  ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;ih[10]=0;ih[11]=0;ih[12]=0
  const st=W*4;const raw=Buffer.alloc((st+1)*H)
  for(let y=0;y<H;y++){raw[y*(st+1)]=0;rgba.subarray(y*st,(y+1)*st).copy(raw,y*(st+1)+1)}
  return Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])
}
// ---------- source ----------
const{W,H,ch,data}=decodePNG('build/icon.png') // RGB ch=3
const lum=(x,y)=>{const i=(y*W+x)*ch;return 0.299*data[i]+0.587*data[i+1]+0.114*data[i+2]}
// logo bbox (lum>100)
let minX=W,maxX=0,minY=H,maxY=0
for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(lum(x,y)>100){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y}}
const bw=maxX-minX+1,bh=maxY-minY+1,bcx=(minX+maxX)/2,bcy=(minY+maxY)/2,maxd=Math.max(bw,bh)
// coverage downscale of a square crop region -> Float32 coverage [0..1] per output px
function covDown(x0,y0,side,N){
  const a=new Float32Array(N*N);const bx=side/N,by=side/N
  for(let oy=0;oy<N;oy++)for(let ox=0;ox<N;ox++){
    const xb=x0+Math.floor(ox*bx),xe=x0+Math.floor((ox+1)*bx),yb=y0+Math.floor(oy*by),ye=y0+Math.floor((oy+1)*by)
    let s=0,c=0;for(let y=yb;y<ye;y++)for(let x=xb;x<xe;x++){s+=lum(x,y);c++}
    a[oy*N+ox]=c?(s/c)/255:0
  }
  return a
}
// smoothstep contrast: lo->0, hi->1, smooth between (keeps bg clean, bolds strokes)
const ss=(v,lo,hi)=>{if(v<=lo)return 0;if(v>=hi)return 1;const t=(v-lo)/(hi-lo);return t*t*(3-2*t)}
const LO=0.05,HI=0.22
// brand blue #4f7cf5
const BL=[79,124,245],WH=[255,255,255]
// rounded-square opacity mask (AA) for a filled tile
function tileMask(N,radius){
  const m=new Float32Array(N*N);const r=radius
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    // distance from rounded-rect edge (inside positive)
    const dx=Math.max(r-x,x-(N-1-r)),dy=Math.max(r-y,y-(N-1-r))
    let d
    if(dx<=0&&dy<=0)d=1 // fully inside, far from corners
    else if(dx<=0)d=Math.min(1,1+dy) // edge along x (dy>0 means beyond top/bottom)
    else if(dy<=0)d=Math.min(1,1+dx)
    else{ // corner: distance from corner center
      const cd=Math.sqrt(dx*dx+dy*dy)-r // 0 at corner arc
      d=cd<=0?1:cd>=1?0:1-cd
    }
    m[y*N+x]=Math.max(0,Math.min(1,d))
  }
  return m
}
// ---- mac template: bbox-crop (fill ~0.82), black rgb, alpha=smoothstep(coverage) ----
function macIcon(N){
  const side=Math.round(maxd/0.82)
  let x0=Math.round(bcx-side/2),y0=Math.round(bcy-side/2)
  x0=Math.max(0,Math.min(W-side,x0));y0=Math.max(0,Math.min(H-side,y0))
  const cov=covDown(x0,y0,side,N);const rgba=Buffer.alloc(N*N*4)
  for(let i=0;i<N*N;i++){const b=ss(cov[i],LO,HI);rgba[i*4]=0;rgba[i*4+1]=0;rgba[i*4+2]=0;rgba[i*4+3]=Math.round(b*255)}
  return rgba
}
// ---- win/linux color: full icon, blue tile bg + white emblem, smoothstep blend, rounded opaque tile ----
function winIcon(N){
  const cov=covDown(0,0,W,N);const rgba=Buffer.alloc(N*N*4)
  const m=tileMask(N,Math.round(N*0.18))
  for(let i=0;i<N*N;i++){
    const b=ss(cov[i],LO,HI) // 0=bg(blue) 1=emblem(white)
    let r=BL[0]*(1-b)+WH[0]*b,g=BL[1]*(1-b)+WH[1]*b,bl=BL[2]*(1-b)+WH[2]*b
    const a=m[i];r*=a;g*=a;bl*=a // premult by tile opacity (clean rounded edges)
    rgba[i*4]=Math.round(r);rgba[i*4+1]=Math.round(g);rgba[i*4+2]=Math.round(bl);rgba[i*4+3]=Math.round(a*255)
  }
  return rgba
}
// ---------- write ----------
writeFileSync('build/trayTemplate.png',encodePNG(16,16,macIcon(16)))
writeFileSync('build/trayTemplate@2x.png',encodePNG(32,32,macIcon(32)))
writeFileSync('build/trayIcon.png',encodePNG(16,16,winIcon(16)))
writeFileSync('build/trayIcon@2x.png',encodePNG(32,32,winIcon(32)))
console.log('wrote: trayTemplate.png, trayTemplate@2x.png, trayIcon.png, trayIcon@2x.png')
// ---------- verify: ASCII grids + alpha counts ----------
const ramp=' .:-=+*#%@'
function show(rgba,N,label,mode){
  let out=`\n=== ${label} (${N}x${N}) ===\n`;let op=0,tr=0,mid=0
  for(let y=0;y<N;y++){let line=''
    for(let x=0;x<N;x++){const i=(y*N+x)*4;const a=rgba[i+3]
      let ch
      if(mode==='mac'){const t=a/255;line+=a<10?' ':ramp[Math.min(ramp.length-1,Math.floor(t*ramp.length))];ch=0}
      else{ // win: show blue(#)/white(@)/transparent(space)
        if(a<20)ch=' ';else{const r=rgba[i],g=rgba[i+1],b=rgba[i+2];const wh=(r+g+b)/(3*255);ch=wh>0.85?'@':wh>0.55?'+':wh>0.3?'=':'#'}}
      line+=ch
      if(a>200)op++;else if(a<10)tr++;else mid++
    }
    out+=line+'\n'
  }
  out+=`alpha: opaque(>200)=${op} mid=${mid} transparent(<10)=${tr} / ${N*N}\n`
  return out
}
process.stdout.write(show(macIcon(16),16,'MAC template','mac'))
process.stdout.write(show(winIcon(16),16,'WIN color (#=blue @=white)','win'))
