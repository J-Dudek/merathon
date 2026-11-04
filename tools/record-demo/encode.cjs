// Assemble frames/ en GIF : palette commune, pixels inchangés transparents. Usage : node encode.cjs <sortie.gif>
const fs=require('fs');const {PNG}=require('pngjs');const G=require('gifenc');const {GIFEncoder,quantize,applyPalette}=G.GIFEncoder?G:G.default;
const dir=__dirname+'/frames';const delays=JSON.parse(fs.readFileSync(dir+'/delays.json'));const out=process.argv[2];
const read=i=>PNG.sync.read(fs.readFileSync(`${dir}/${String(i).padStart(5,'0')}.png`));
const W=960,H=600;const samples=[];const step=Math.ceil(delays.length/40);
for(let i=0;i<delays.length;i+=step){const d=read(i).data;for(let p=0;p<d.length;p+=4*7){samples.push(d[p],d[p+1],d[p+2],255)}}
const palette=quantize(Uint8ClampedArray.from(samples),255,{format:'rgb565'});while(palette.length<255)palette.push([0,0,0]);const T=255;const full=[...palette,[0,0,0]];
const enc=GIFEncoder();let prev=null;let pending=null;let written=0;
function flush(){if(!pending)return;enc.writeFrame(pending.idx,W,H,{...(written===0?{palette:full,repeat:0}:{}),delay:pending.delay,transparent:written>0,transparentIndex:T,dispose:1});written++;pending=null}
for(let i=0;i<delays.length;i++){const im=read(i);if(im.width!==W||im.height!==H)throw new Error('size '+im.width+'x'+im.height);const idx=applyPalette(im.data,palette,'rgb565');
 if(prev){let same=true;const diff=new Uint8Array(idx.length);for(let k=0;k<idx.length;k++){if(idx[k]===prev[k])diff[k]=T;else{diff[k]=idx[k];same=false}}
  if(same){pending.delay+=delays[i];continue}flush();pending={idx:diff,delay:delays[i]}}else pending={idx,delay:delays[i]};prev=idx}
// dernière image tenue plus longtemps avant de reboucler
pending.delay+=1500;flush();enc.finish();fs.writeFileSync(out,enc.bytes());console.log('frames',written,'MB',(enc.bytes().length/1048576).toFixed(2));
