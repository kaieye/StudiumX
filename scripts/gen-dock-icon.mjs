import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'
function decodePNG(file){const buf=readFileSync(file);let p=8;const cs=[];while(p<buf.length){const len=buf.readUInt32BE(p);p+=4;const t=buf.toString('ascii',p,p+4);p+=4;const d=buf.subarray(p,p+len);p+=len+4;cs.push({t,d})}
const ih=cs[0].d;const W=ih.readUInt32BE(0),H=ih.readUInt32BE(4);const ch={0:1,2:3,3:1,4:2,6:4}[ih[9]]
const raw=inflateSync(Buffer.concat(cs.filter(c=>c.t==='IDAT').map(c=>c.d)));const st=W*ch+1;const out=Buffer.alloc(W*H*ch);const prev=Buffer.alloc(W*ch)
const pa=(a,b,c)=>{const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
for(let y=0;y<H;y++){const f=raw[y*st];const cur=out.subarray(y*W*ch,(y+1)*W*ch);cur.set(raw.subarray(y*st+1,y*st+1+W*ch));for(let x=0;x<W*ch;x++){const L=x>=ch?cur[x-ch]:0,U=prev[x],UL=x>=ch?prev[x-ch]:0;let v=cur[x];if(f===1)v=(v+L)&255;else if(f===2)v=(v+U)&255;else if(f===3)v=(v+((L+U)>>1))&255;else if(f===4)v=(v+pa(L,U,UL))&255;cur[x]=v}prev.set(cur)}
return{W,H,ch,data:out}}
const crcTab=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcTab[(c^b[i])&0xFF]^(c>>>8);const r=Buffer.alloc(4);r.writeUInt32BE((c^0xFFFFFFFF)>>>0,0);return r}
function chunk(t,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length,0);const tb=Buffer.from(t,'ascii');return Buffer.concat([len,tb,d,crc32(Buffer.concat([tb,d]))])}
function encodePNG(W,H,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;const st=W*4;const raw=Buffer.alloc((st+1)*H);for(let y=0;y<H;y++){raw[y*(st+1)]=0;rgba.subarray(y*st,(y+1)*st).copy(raw,y*(st+1)+1)}return Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])}
const{W,H,ch,data}=decodePNG('build/icon.png')
// macOS-style squircle (superellipse n=5), inscribed to touch edge midpoints,
// with 4x4 supersampling for a smooth anti-aliased edge.
const N=5,CX=(W-1)/2,CY=(H-1)/2,RX=W/2,RY=H/2,SS=4
const rgba=Buffer.alloc(W*H*4)
let opaqueEdge=0
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const i=(y*W+x)*ch, sr=data[i],sg=data[i+1],sb=data[i+2]
  let cov=0
  for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){
    const px=(x+(sx+0.5)/SS-CX)/RX, py=(y+(sy+0.5)/SS-CY)/RY
    const f=Math.pow(Math.abs(px),N)+Math.pow(Math.abs(py),N)
    if(f<=1)cov++
  }
  const a=cov/(SS*SS)
  const a255=Math.round(a*255)
  if(a255>10&&a255<245)opaqueEdge++
  // premultiply by coverage for clean edges
  rgba[i*4/3? (y*W+x)*4 :0] // no-op to keep linter quiet
  const o=(y*W+x)*4
  rgba[o]=Math.round(sr*a);rgba[o+1]=Math.round(sg*a);rgba[o+2]=Math.round(sb*a);rgba[o+3]=a255
}
writeFileSync('build/icon-dock.png',encodePNG(W,H,rgba))
console.log(`wrote build/icon-dock.png (${W}x${H} RGBA, squircle n=${N}, ${opaqueEdge} edge pixels)`)
// quick corner/center alpha sanity
const at=(x,y)=>rgba[((y|0)*W+(x|0))*4+3]
console.log('corner(2,2) alpha=',at(2,2),' edge-mid(512,2) alpha=',at(512,2),' center(512,512) alpha=',at(512,512))
