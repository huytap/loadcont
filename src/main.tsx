import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Container, Orient, PackItem, PackResult, PackState, Product, ProductImages, AUTO_ORIENTS, DEFAULT_GAP, Gap, ORIENTS, boxDimsKey, dimsKey, emptyState, isValid, orderOf, orientKey, removeProduct, requiredHeights, patternInfo, normalizePattern, PatternSeg } from './packing';
import { PlansDialog, SavedPlan, loadPlans, storePlans } from './savedPlans';
import './styles.css';

const CONTAINERS:Container[]=[
 {name:'20GP',w:2352,d:5898,h:2393,maxWeight:28200},
 {name:'40GP',w:2352,d:12032,h:2393,maxWeight:26700},
 {name:'40HC',w:2352,d:12032,h:2698,maxWeight:26500}
];
const PALETTE=['#4f8cff','#35b779','#f39c3d','#e0548e','#8e6cf0','#1fb5c9','#c9a227','#e5533d','#6b8e23','#8d6e63'];
const DEFAULT_PRODUCTS:Product[]=[
 {uid:'p1',code:'SP-001',name:'Carton A',w:600,d:400,h:300,qty:120,weight:18,color:PALETTE[0]},
 {uid:'p2',code:'SP-002',name:'Carton B',w:500,d:400,h:250,qty:80,weight:14,color:PALETTE[1]},
 {uid:'p3',code:'SP-003',name:'Carton C',w:1200,d:800,h:700,qty:20,weight:42,color:PALETTE[2]}
];
const SPEEDS=[{label:'Chậm',step:1,ms:120},{label:'Vừa',step:1,ms:35},{label:'Nhanh',step:5,ms:30},{label:'Tức thì',step:Infinity,ms:0}];
const IMAGE_SLOTS:{key:keyof ProductImages;label:string}[]=[{key:'long',label:'Mặt dài'},{key:'short',label:'Mặt ngang'},{key:'top',label:'Nắp'}];
const QUALITIES=[{label:'Nhanh',ms:0},{label:'Kỹ (~1s)',ms:1000},{label:'Rất kỹ (~3s)',ms:3000}];
const STORAGE_KEY='loadcont.v1';

function loadSaved():{products:Product[];container:string;gap:Gap}{
 try{const s=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); if(s&&Array.isArray(s.products)) return {products:s.products,container:s.container||'40HC',gap:{...DEFAULT_GAP,...(s.gap&&'x' in s.gap?s.gap:{})}};}catch{}
 return {products:DEFAULT_PRODUCTS,container:'40HC',gap:DEFAULT_GAP};
}

// Thu nhỏ ảnh về tối đa 512px để lưu được trong localStorage và nhẹ cho GPU
function readImage(file:File):Promise<string>{
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file); const img=new Image();
  img.onload=()=>{
   const k=Math.min(1,512/Math.max(img.width,img.height)); const cv=document.createElement('canvas');
   cv.width=Math.round(img.width*k); cv.height=Math.round(img.height*k);
   cv.getContext('2d')!.drawImage(img,0,0,cv.width,cv.height); URL.revokeObjectURL(url);
   resolve(cv.toDataURL('image/jpeg',0.82));
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Không đọc được ảnh'));};
  img.src=url;
 });
}

// Chạy thuật toán xếp trong Web Worker (bỏ ảnh khỏi dữ liệu gửi đi cho nhẹ)
function runPack(state:PackState,items:PackItem[],c:Container,budget:number,strict:boolean,even=false):Promise<PackResult>{
 return new Promise((resolve,reject)=>{
  const w=new Worker(new URL('./packWorker.ts',import.meta.url),{type:'module'});
  w.onmessage=e=>{w.terminate();resolve(e.data);};
  w.onerror=e=>{w.terminate();reject(e);};
  w.postMessage({state,items:items.map(i=>({...i,p:{...i.p,images:undefined}})),c,budget,opts:{strict},even});
 });
}

const texCache=new Map<string,THREE.Texture>();
function texture(url:string){
 let t=texCache.get(url);
 if(!t){t=new THREE.TextureLoader().load(url); t.colorSpace=THREE.SRGBColorSpace; texCache.set(url,t);}
 return t;
}

// faces[i]: vật liệu của mặt vuông góc với kích thước gốc i (0=dài → mặt ngang, 1=rộng → mặt dài, 2=cao → nắp)
type BoxMaterials={plain?:THREE.Material;faces:THREE.Material[]};
const matCache=new Map<string,BoxMaterials>();
function boxMaterials(p:Product):BoxMaterials{
 const im=p.images||{}; const long=im.long??im.short, short=im.short??im.long, top=im.top;
 const key=`${p.color}|${long}|${short}|${top}`;
 let m=matCache.get(key);
 if(!m){
  // Vật liệu đặc (không trong suốt) và đẩy lùi mặt một chút để đường viền luôn nằm trên → hết chớp khi xoay
  const base={polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1};
  if(!long&&!top){const plain=new THREE.MeshStandardMaterial({color:p.color,...base}); m={plain,faces:[]};}
  else {
   const mk=(url?:string)=>url?new THREE.MeshStandardMaterial({map:texture(url),...base}):new THREE.MeshStandardMaterial({color:p.color,...base});
   m={faces:[mk(short),mk(long),mk(top)]};
  }
  matCache.set(key,m);
 }
 return m;
}
// Thứ tự mặt của BoxGeometry: +x,-x,+y,-y,+z,-z
const faceMaterials=(m:BoxMaterials,o:Orient)=>m.plain??[m.faces[o[0]],m.faces[o[0]],m.faces[o[1]],m.faces[o[1]],m.faces[o[2]],m.faces[o[2]]];
const HIGHLIGHT=new THREE.MeshStandardMaterial({color:'#fff200',polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
// Vẽ thùng nhỏ hơn thật 1mm mỗi phía để mặt các thùng sát nhau / sát vách không trùng nhau (gây chớp)
const INSET=2;

// Đường viền, chữ không nhận click (mặc định đường thẳng "trúng" trong phạm vi 1m → chọn nhầm thùng bên cạnh)
const noRaycast=()=>null;
const Box3D=memo(function Box3D({box,c,mat,selected,drop,onSelect}:{box:Box;c:Container;mat:BoxMaterials|undefined;selected:boolean;drop:boolean;onSelect:(key:string)=>void}){
 const ref=useRef<THREE.Group>(null); const t=useRef(drop?0:1);
 const pos:[number,number,number]=[(box.x-c.w/2)/1000,(box.y-c.h/2)/1000,(box.z-c.d/2)/1000];
 // Hiệu ứng thùng rơi từ trên xuống khi được cho vào container
 useFrame((_,dt)=>{
  if(t.current>=1||!ref.current) return;
  t.current=Math.min(1,t.current+dt*3); ref.current.position.y=pos[1]+(1-t.current)**3*2;
 });
 const sw=(box.w-INSET)/1000, sh=(box.h-INSET)/1000, sd=(box.d-INSET)/1000;
 const edges=useMemo(()=>new THREE.EdgesGeometry(new THREE.BoxGeometry(sw,sh,sd)),[sw,sh,sd]);
 const material=useMemo(()=>selected||!mat?HIGHLIGHT:faceMaterials(mat,box.orient),[selected,mat,box.orient]);
 return <group ref={ref} position={pos}>
   <mesh material={material} onClick={(e)=>{e.stopPropagation();onSelect(box.key);}}><boxGeometry args={[sw,sh,sd]}/></mesh>
   <lineSegments geometry={edges} raycast={noRaycast}><lineBasicMaterial color="#111"/></lineSegments>
   {selected&&<Text position={[0,box.h/2000+0.03,0]} fontSize={0.16} color="black" anchorX="center" raycast={noRaycast}>{box.id}</Text>}
 </group>
});

function Container3D({boxes,c,mats,drop,onSelect,selected}:{boxes:Box[];c:Container;mats:Map<string,BoxMaterials>;drop:boolean;onSelect:(key:string)=>void;selected:string|null}){
 // Vỏ cont vẽ rộng hơn 10mm để không trùng mặt với thùng sát vách
 const cw=(c.w+10)/1000, ch=(c.h+10)/1000, cd=(c.d+10)/1000;
 const edges=useMemo(()=>new THREE.EdgesGeometry(new THREE.BoxGeometry(cw,ch,cd)),[cw,ch,cd]);
 return <Canvas camera={{position:[9,5,11],fov:45}} onPointerMissed={()=>onSelect('')}>
  <ambientLight intensity={1.8}/><directionalLight position={[5,8,5]} intensity={2}/><Environment preset="city"/>
  {/* Lưới đặt thấp hơn sàn cont để không tranh mặt với đáy thùng */}
  <Grid args={[16,16]} cellSize={1} sectionSize={5} fadeDistance={30} position={[0,-ch/2-0.01,0]}/>
  {/* Vỏ cont: chỉ vẽ vách phía xa (BackSide), không ghi độ sâu để không che/chớp với thùng */}
  <mesh renderOrder={1} raycast={noRaycast}><boxGeometry args={[cw,ch,cd]}/><meshStandardMaterial color="#c8d0d8" transparent opacity={0.12} side={THREE.BackSide} depthWrite={false}/></mesh>
  <lineSegments geometry={edges} raycast={noRaycast}><lineBasicMaterial color="#555"/></lineSegments>
  {/* Cửa container (phía cuối chiều dài) */}
  <Text position={[0,-c.h/2000+0.15,c.d/2000+0.4]} rotation={[-Math.PI/2,0,0]} fontSize={0.3} color="#555" raycast={noRaycast}>CỬA</Text>
  {boxes.map(b=><Box3D key={b.key} box={b} c={c} mat={mats.get(b.productId)} drop={drop} selected={selected===b.key} onSelect={onSelect}/>)}
  <OrbitControls makeDefault/>
 </Canvas>
}

function NumField({label,value,onChange,unit}:{label:string;value:number;onChange:(v:number)=>void;unit?:string}){
 return <label className="field"><span>{label}{unit&&<em> ({unit})</em>}</span><input type="number" min={0} value={Number.isFinite(value)&&value!==0?value:''} onChange={e=>onChange(Math.max(0,Number(e.target.value)))}/></label>
}

function ImageSlot({label,url,onPick,onClear}:{label:string;url?:string;onPick:(f:File)=>void;onClear:()=>void}){
 return <div className="img-slot">
  <label title={`Tải ảnh ${label.toLowerCase()}`}>
   {url?<img src={url} alt={label}/>:<span>+</span>}
   <input type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0]; if(f) onPick(f); e.target.value='';}}/>
  </label>
  <small>{label}{url&&<button className="icon danger" onClick={onClear} title="Xóa ảnh">✕</button>}</small>
 </div>
}

const orientLabel=(p:Product,o:Orient)=>{const D=[p.w,p.d,p.h]; return `${D[o[0]]}×${D[o[2]]} ↑${D[o[1]]} ${o[1]===2?'đứng':o[1]===1?'nằm':'dựng'}`;};
// Gợi ý mẫu ban đầu: thùng đứng, kín bề ngang và chiều cao cont
function suggestPattern(p:Product,c:Container,g:Gap):PatternSeg[]{
 return [{o:'021',cols:Math.max(1,Math.floor((c.w+g.x)/(p.w+g.x))),rows:Math.max(1,Math.floor((c.h+g.y)/(p.h+g.y)))}];
}

// Mẫu tự chất: người dùng khai báo 1 lớp (1 vách thùng nhìn từ cửa) gồm các cách xếp;
// hệ thống tự tính số lớp từ tổng số thùng và xếp các lớp nối nhau từ vách trong ra cửa
function PatternEditor({p,c,gap,onChange}:{p:Product;c:Container;gap:Gap;onChange:(pattern:PatternSeg[])=>void}){
 const pat=normalizePattern(p.pattern), info=patternInfo(p,c,gap), D=[p.w,p.d,p.h];
 const set=(i:number,patch:Partial<PatternSeg>)=>onChange(pat.map((S,j)=>j===i?{...S,...patch}:S));
 const num=(v:string)=>Math.max(1,Math.floor(Number(v))||1);
 // Cách xếp mới: mặc định thùng nằm, đặt trên cùng, kín bề ngang và phần chiều cao còn lại
 const addSeg=()=>{
  const o=ORIENTS.find(x=>x[1]!==2&&orientKey(x)==='012')!, bw=D[o[0]]+gap.x, bh=D[o[1]]+gap.y;
  const rem=c.h+gap.y-(info.H+gap.y);
  onChange([...pat,{o:orientKey(o),cols:Math.max(1,Math.floor((c.w+gap.x)/bw)),rows:Math.max(1,Math.floor(rem/bh)),place:'above'}]);
 };
 const rects=info.segs.flatMap(q=>Array.from({length:q.cols*q.rows},(_,n)=>({lying:q.lying,x:q.x+(n%q.cols)*(q.w+gap.x),y:q.y+Math.floor(n/q.cols)*(q.h+gap.y),w:q.w,h:q.h})));
 // Vẽ đủ cả phần vượt cont (tô đỏ) để thấy ngay cách xếp nào bị tràn
 const VW=Math.max(c.w,info.W), VH=Math.max(c.h,info.H), k=Math.min(220/VW,260/VH);
 const out=(r:{x:number;y:number;w:number;h:number})=>r.x+r.w>c.w||r.y+r.h>c.h;
 return <div className="pattern">
  <div className="pattern-head"><span>#</span><span>Hướng xếp</span><span/><span/><span/>
   <span/><span title="Vị trí trong lớp">Vị trí</span><span title="Số thùng theo ngang cont">Cột</span><span title="Số tầng thùng chồng theo chiều cao">Hàng</span><span/></div>
  {pat.map((S,i)=><div className="pattern-row" key={i}>
   <b className="n">{i+1}</b>
   {i===0?<span className="muted p">Dưới cùng</span>
    :<select className="p" value={S.place??'above'} onChange={e=>set(i,{place:e.target.value as PatternSeg['place']})} title="Chồng lên: tự tìm khoảng trống thấp nhất trên mặt các cách xếp đã có. Bên cạnh: tự tìm khoảng trống thấp nhất kể cả sát sàn (vd khe bên phải).">
      <option value="above">Chồng lên</option><option value="beside">Bên cạnh</option></select>}
   <select className="o" value={S.o} onChange={e=>set(i,{o:e.target.value})}>{ORIENTS.map(o=><option key={orientKey(o)} value={orientKey(o)}>{orientLabel(p,o)}</option>)}</select>
   <input className="c" type="number" min={1} value={S.cols} onChange={e=>set(i,{cols:num(e.target.value)})} title="Cột (ngang cont)"/>
   <input className="r" type="number" min={1} value={S.rows} onChange={e=>set(i,{rows:num(e.target.value)})} title="Hàng (số tầng)"/>
   <button className="icon danger x" onClick={()=>onChange(pat.filter((_,j)=>j!==i))} title="Xóa cách xếp" disabled={pat.length<2}>✕</button>
  </div>)}
  <button className="link" onClick={addSeg}>+ Thêm cách xếp</button>
  <div className="pattern-view">
   <figure>
    <svg viewBox={`0 0 ${VW*k+2} ${VH*k+2}`} width={VW*k+2} height={VH*k+2} role="img" aria-label="1 lớp nhìn từ cửa">
     <rect x={1} y={1+(VH-c.h)*k} width={c.w*k} height={c.h*k} fill="#fff" stroke="#9aa6b1" strokeDasharray="3 3"/>
     {rects.map((r,n)=><rect key={n} x={1+r.x*k} y={1+(VH-r.y-r.h)*k} width={r.w*k} height={r.h*k} fill={out(r)?'#e5533d':p.color} fillOpacity={r.lying?0.45:0.85} stroke="#17202a" strokeWidth={0.5}/>)}
     {info.segs.map((q,i)=>{const W=q.cols*(q.w+gap.x)-gap.x, H=q.rows*(q.h+gap.y)-gap.y;
      return <text key={i} x={1+(q.x+W/2)*k} y={1+(VH-q.y-H/2)*k} textAnchor="middle" dominantBaseline="central" className="seg-no">#{i+1}</text>;})}
    </svg>
    <figcaption>1 lớp nhìn từ cửa · nhạt = nằm · đỏ = vượt cont</figcaption>
   </figure>
   <div className="pattern-info">
    <div>Mỗi lớp <b>{info.per}</b> thùng ({info.segs.map((q,i)=>`#${i+1}: ${q.cols}×${q.rows} ${q.lying?'nằm':'đứng'}`).join(' + ')})</div>
    <div>Rộng <b className={info.W>c.w?'warn':''}>{info.W}</b>/{c.w} · Cao <b className={info.H>c.h?'warn':''}>{info.H}</b>/{c.h} · Dày {info.D} mm</div>
    <div>Tổng {p.qty} thùng → <b>{info.needLayers}</b> lớp · cont chứa tối đa <b>{info.maxLayers}</b> lớp</div>
   </div>
  </div>
  {info.errors.map(e=><div key={e} className="warn small">⚠ {e}</div>)}
  {info.warnings.map(e=><div key={e} className="note small">ⓘ {e}</div>)}
  {!info.errors.length&&info.needLayers>info.maxLayers&&<div className="note small">ⓘ Không đủ chỗ cho toàn bộ số lượng nếu chỉ chất mã này (thiếu khoảng {(info.needLayers-info.maxLayers)*info.per} thùng).</div>}
 </div>
}

function ProductCard({p,c,gap,loaded,usage,busy,onChange,onRemove,onLoad,onUnload,onMove}:{p:Product;c:Container;gap:Gap;loaded:number;usage:Record<string,number>;busy:boolean;onMove:(dir:-1|1)=>void;onChange:(patch:Partial<Product>)=>void;onRemove:()=>void;onLoad:()=>void;onUnload:()=>void}){
 const remaining=Math.max(0,p.qty-loaded);
 const setImage=async(key:keyof ProductImages,f:File)=>{try{const url=await readImage(f); onChange({images:{...p.images,[key]:url}});}catch(e){alert((e as Error).message);}};
 return <div className={`product${isValid(p)?'':' invalid'}`}>
  <div className="product-head">
   <input type="color" value={p.color} onChange={e=>onChange({color:e.target.value})} title="Màu"/>
   <input className="code" value={p.code} onChange={e=>onChange({code:e.target.value})} placeholder="Mã"/>
   <input className="name" value={p.name} onChange={e=>onChange({name:e.target.value})} placeholder="Tên sản phẩm"/>
   <div className="move"><button className="icon" onClick={()=>onMove(-1)} title="Lên trên">▲</button><button className="icon" onClick={()=>onMove(1)} title="Xuống dưới">▼</button></div>
   <button className="icon danger" onClick={onRemove} title="Xóa sản phẩm">✕</button>
  </div>
  <div className="dims">
   <NumField label="Dài" unit="mm" value={p.w} onChange={w=>onChange({w})}/>
   <NumField label="Rộng" unit="mm" value={p.d} onChange={d=>onChange({d})}/>
   <NumField label="Cao" unit="mm" value={p.h} onChange={h=>onChange({h})}/>
  </div>
  <div className="dims">
   <label className="field"><span>Số lượng</span>
    <div className="stepper"><button className="icon" onClick={()=>onChange({qty:Math.max(0,p.qty-1)})}>−</button><input type="number" min={0} value={p.qty||''} onChange={e=>onChange({qty:Math.max(0,Math.floor(Number(e.target.value)))})}/><button className="icon" onClick={()=>onChange({qty:p.qty+1})}>+</button></div>
   </label>
   <NumField label="KL/thùng" unit="kg" value={p.weight} onChange={weight=>onChange({weight})}/>
  </div>
  <div className="opts">
   <label className="order" title="1 = chất vào trước (nằm sâu nhất trong cont). Các mã cùng số được trộn tự do để tối ưu.">Thứ tự chất <input type="number" min={1} value={orderOf(p)} onChange={e=>onChange({order:Math.max(1,Math.floor(Number(e.target.value))||1)})}/></label>
   <label className="order" title="Tự động: app tự chọn hướng đặt thùng. Tùy chọn chiều: bắt buộc có đủ đứng/nằm đã tick, app tự tối ưu. Tự chất: bạn khai báo cách chất 1 lượt, app lặp lại lượt đó.">Chiều xếp <select value={p.pattern?'pattern':p.orients?'manual':'auto'} onChange={e=>{const v=e.target.value; onChange({orients:v==='manual'?AUTO_ORIENTS(p):undefined,pattern:v==='pattern'?suggestPattern(p,c,gap):undefined});}}><option value="auto">Tự động</option><option value="manual">Tùy chọn chiều</option><option value="pattern">Tự chất (mẫu)</option></select></label>
  </div>
  {p.pattern
   ?<PatternEditor p={p} c={c} gap={gap} onChange={pattern=>onChange({pattern})}/>
   :p.orients
   ?<div className="orients">{ORIENTS.map(o=>{
     const k=orientKey(o), D=[p.w,p.d,p.h], on=p.orients!.includes(k), n=usage[dimsKey(p,o)]||0;
     // Kiểu dựng (đứng/nằm/dựng) bắt buộc nhưng chưa có thùng nào dù mã đã vào cont
     const h=D[o[1]], miss=on&&loaded>0&&requiredHeights(p).includes(h)&&!Object.keys(usage).some(k=>k.split(',')[1]===String(h));
     return <label key={k} className={`${on?'on':''}${miss?' miss':''}`} title={`Ngang cont ${D[o[0]]} × dọc cont ${D[o[2]]} mm, cao ${D[o[1]]} mm${o[1]===2?' (đứng thẳng)':' (nằm)'}${miss?' — chưa xếp được theo chiều này':''}`}>
      <input type="checkbox" checked={on} onChange={e=>onChange({orients:e.target.checked?[...p.orients!,k]:p.orients!.filter(x=>x!==k)})}/>
      <span>{D[o[0]]}×{D[o[2]]}</span><b>↑{D[o[1]]}</b>{o[1]!==2&&<em>nằm</em>}
      {on&&loaded>0&&<i className="count">{n} thùng</i>}
     </label>;})}
     <small>ngang × dọc cont, ↑ chiều cao · {requiredHeights(p).length?'bắt buộc có đủ đứng/nằm đã tick, hệ thống tự chọn xoay':'chỉ xếp theo các chiều đã tick'}</small>
    </div>
   :<label className="check" title="Cho phép app thử thêm các hướng đặt thùng nằm để lấp chỗ trống"><input type="checkbox" checked={!!p.canTip} onChange={e=>onChange({canTip:e.target.checked})}/> Cho phép lật khi tự tính</label>}
  <div className="images">{IMAGE_SLOTS.map(s=><ImageSlot key={s.key} label={s.label} url={p.images?.[s.key]} onPick={f=>setImage(s.key,f)} onClear={()=>{const im={...p.images}; delete im[s.key]; onChange({images:im});}}/>)}</div>
  <small className="meta">{isValid(p)?<>{(p.w*p.d*p.h/1e9).toFixed(3)} CBM/thùng · Trong cont <b>{loaded}/{p.qty}</b></>:<b className="warn">{p.orients&&!p.orients.length?'Chọn ít nhất một chiều xếp':'Nhập đủ kích thước và số lượng'}</b>}</small>
  <div className="card-actions">
   <button onClick={onLoad} disabled={busy||!isValid(p)||remaining===0}>{remaining>0?`Cho vào cont (+${remaining})`:'Đã vào cont đủ'}</button>
   {loaded>0&&<button className="secondary" onClick={onUnload} disabled={busy}>Gỡ ra</button>}
  </div>
 </div>
}

function App(){
 const saved=useMemo(loadSaved,[]);
 const [products,setProducts]=useState<Product[]>(saved.products);
 const [containerName,setContainerName]=useState(saved.container);
 const c=CONTAINERS.find(x=>x.name===containerName)||CONTAINERS[2];
 const [gap,setGap]=useState<Gap>(saved.gap);
 const [plan,setPlan]=useState<PackState>(()=>emptyState(c,saved.gap));
 const [unplaced,setUnplaced]=useState<Record<string,number>>({});
 const [shown,setShown]=useState(0);
 const [speed,setSpeed]=useState(1);
 const [paused,setPaused]=useState(false);
 const [selected,setSelected]=useState('');
 const [productFilter,setProductFilter]=useState('ALL');
 const [saveError,setSaveError]=useState(false);
 const [quality,setQuality]=useState(1);
 const [busy,setBusy]=useState(false);
 const [strict,setStrict]=useState(false);
 const [even,setEven]=useState(false);
 const [plans,setPlans]=useState<SavedPlan[]>(loadPlans);
 const [openId,setOpenId]=useState<string|null>(null); // cont đã lưu đang mở
 const [showPlans,setShowPlans]=useState(false);
 const reqId=useRef(0); // bỏ qua kết quả tính cũ nếu người dùng đã dỡ hàng / đổi container

 useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify({products,container:containerName,gap}));setSaveError(false);}catch{setSaveError(true);}},[products,containerName,gap]);

 const boxes=plan.boxes, total=boxes.length;
 // Hiện dần từng thùng để mô phỏng quá trình đóng hàng
 useEffect(()=>{
  if(shown>total){setShown(total);return;}
  if(shown===total||paused) return;
  const sp=SPEEDS[speed];
  if(!Number.isFinite(sp.step)){setShown(total);return;}
  const id=setTimeout(()=>setShown(s=>Math.min(total,s+sp.step)),sp.ms);
  return ()=>clearTimeout(id);
 },[shown,total,speed,paused]);
 const animating=shown<total;

 const mats=useMemo(()=>new Map(products.map(p=>[p.uid,boxMaterials(p)])),[products]);
 // Số thùng theo từng chiều đặt của mỗi mã
 const usageBy=useMemo(()=>{const m:Record<string,Record<string,number>>={}; for(const b of boxes){const u=m[b.productId]??={}; const k=boxDimsKey(b); u[k]=(u[k]||0)+1;} return m;},[boxes]);
 const loadedBy=useMemo(()=>{const m:Record<string,number>={}; for(const b of boxes) m[b.productId]=(m[b.productId]||0)+1; return m;},[boxes]);
 const visible=useMemo(()=>{const v=boxes.slice(0,shown); return productFilter==='ALL'?v:v.filter(b=>b.productId===productFilter);},[boxes,shown,productFilter]);
 const inCont=boxes.slice(0,shown);
 const totalWeight=inCont.reduce((s,b)=>s+b.weight,0); const volume=inCont.reduce((s,b)=>s+b.w*b.d*b.h,0)/1e9; const utilization=volume/(c.w*c.d*c.h/1e9)*100;
 const selBox=selected?plan.boxes.find(b=>b.key===selected):undefined;
 const selProduct=selBox&&products.find(p=>p.uid===selBox.productId);
 const unplacedList=Object.entries(unplaced).filter(([,n])=>n>0);
 const heightName=(p:Product,h:number)=>h===p.h?'đứng':h===p.d?'nằm':'dựng';
 const missingList=products.filter(p=>loadedBy[p.uid]).map(p=>{
  const used=new Set(Object.keys(usageBy[p.uid]||{}).map(k=>Number(k.split(',')[1])));
  return [p,requiredHeights(p).filter(h=>!used.has(h))] as const;
 }).filter(([,m])=>m.length>0);

 const update=(uid:string,patch:Partial<Product>)=>setProducts(ps=>ps.map(p=>p.uid===uid?{...p,...patch}:p));
 const unload=(uid:string)=>{
  // Gỡ thùng của sản phẩm ra; chỗ trống để lại không được tái sử dụng, bấm LOAD CONT để xếp gọn lại
  setPlan(s=>removeProduct(s,uid));
  setShown(n=>n-boxes.slice(0,n).filter(b=>b.productId===uid).length);
  setUnplaced(u=>({...u,[uid]:0})); setSelected('');
 };
 const remove=(uid:string)=>{unload(uid); setProducts(ps=>ps.filter(p=>p.uid!==uid)); if(productFilter===uid) setProductFilter('ALL');};
 const move=(uid:string,dir:-1|1)=>setProducts(ps=>{
  const i=ps.findIndex(p=>p.uid===uid), j=i+dir; if(i<0||j<0||j>=ps.length) return ps;
  const next=[...ps]; [next[i],next[j]]=[next[j],next[i]]; return next;
 });
 const groups=useMemo(()=>{
  const m=new Map<number,Product[]>(); for(const p of products) m.set(orderOf(p),[...(m.get(orderOf(p))||[]),p]);
  return [...m.entries()].sort((a,b)=>a[0]-b[0]);
 },[products]);
 const add=()=>setProducts(ps=>{
  const n=ps.length+1;
  return [...ps,{uid:`p${Date.now()}`,code:`SP-${String(n).padStart(3,'0')}`,name:`Carton ${n}`,w:600,d:400,h:400,qty:10,weight:10,color:PALETTE[ps.length%PALETTE.length]}];
 });
 const resetProducts=()=>{if(confirm('Khôi phục danh sách sản phẩm mẫu? (ảnh đã tải lên sẽ mất)')){setProducts(DEFAULT_PRODUCTS);clearCont();setProductFilter('ALL');}};

 // Cho thêm phần còn thiếu của một sản phẩm vào cont, giữ nguyên các thùng đã xếp
 const pack=async(state:PackState,items:PackItem[],apply:(r:PackResult)=>void,useEven=false)=>{
  const id=++reqId.current; setBusy(true);
  try{const r=await runPack(state,items,c,QUALITIES[quality].ms,strict,useEven); if(id===reqId.current) apply(r);}
  catch(e){alert('Lỗi khi tính phương án xếp: '+((e as ErrorEvent).message||e));}
  finally{if(id===reqId.current) setBusy(false);}
 };
 const loadProduct=(p:Product)=>pack(plan,[{p,qty:p.qty-(loadedBy[p.uid]||0)}],r=>{
  setShown(plan.boxes.length); setPaused(false);
  setPlan(r.state); setUnplaced(u=>({...u,[p.uid]:r.unplaced[p.uid]||0}));
 });
 // Xếp lại toàn bộ danh sách từ đầu bằng thuật toán tối ưu, chạy hiệu ứng đóng hàng từ thùng đầu tiên
 const loadAll=()=>pack(emptyState(c,gap),products.map(p=>({p,qty:p.qty})),r=>{
  setPlan(r.state); setUnplaced(r.unplaced); setShown(0); setPaused(false); setSelected('');
 },even);
 const clearCont=(cont=c,g=gap)=>{reqId.current++;setBusy(false);setPlan(emptyState(cont,g));setUnplaced({});setShown(0);setSelected('');};
 // Đổi dung sai → phương án cũ không còn đúng, dỡ cont để xếp lại
 const changeGap=(patch:Partial<Gap>)=>{const g={...gap,...patch}; setGap(g); clearCont(c,g);};
 // ---- Lưu / mở cont ----
 const commitPlans=(list:SavedPlan[])=>{const err=storePlans(list); if(err){alert(err); return false;} setPlans(list); return true;};
 const snapshot=(id:string,name:string):SavedPlan=>{
  const bx=plan.boxes, cbm=bx.reduce((s,b)=>s+b.w*b.d*b.h,0)/1e9;
  return {id,name,savedAt:Date.now(),container:containerName,gap,
   products:products.map(({images,...p})=>p),plan,unplaced,strict,even,
   summary:{cartons:bx.length,weight:bx.reduce((s,b)=>s+b.weight,0),cbm,util:cbm/(c.w*c.d*c.h/1e9)*100}};
 };
 const saveNew=(name:string)=>{const sp=snapshot(`c${Date.now()}`,name); if(commitPlans([sp,...plans])){setOpenId(sp.id); setShowPlans(false);}};
 const overwrite=(id:string,name:string)=>{if(commitPlans(plans.map(p=>p.id===id?snapshot(id,name):p))) setShowPlans(false);};
 const openPlan=(sp:SavedPlan)=>{
  if(total>0&&sp.id!==openId&&!confirm(`Mở cont “${sp.name}”? Cách xếp đang xem sẽ được thay thế (hãy lưu trước nếu cần).`)) return;
  reqId.current++; setBusy(false);
  const imgs=new Map(products.map(p=>[p.uid,p.images]));
  setContainerName(sp.container); setGap(sp.gap);
  setProducts(sp.products.map(p=>({...p,images:imgs.get(p.uid)})));
  setPlan(sp.plan); setUnplaced(sp.unplaced||{}); setStrict(!!sp.strict); setEven(!!sp.even);
  setShown(sp.plan.boxes.length); setPaused(false); setSelected(''); setProductFilter('ALL');
  setOpenId(sp.id); setShowPlans(false);
 };
 const importPlans=(list:SavedPlan[])=>{
  // Đổi id để không trùng với cont đã có
  const fresh=list.map((p,i)=>({...p,id:`c${Date.now()}${i}`,summary:p.summary??{cartons:p.plan.boxes.length,weight:0,cbm:0,util:0}}));
  if(commitPlans([...fresh,...plans])) alert(`Đã nhập ${fresh.length} cont.`);
 };
 // Cont mới: làm trống cont, bỏ liên kết với cont đã lưu (giữ danh sách sản phẩm để sửa tiếp)
 const newCont=()=>{
  if(total>0&&!confirm('Tạo cont mới? Cách xếp đang xem sẽ bị xoá khỏi màn hình (cont đã lưu không bị ảnh hưởng).')) return;
  clearCont(); setOpenId(null); setShowPlans(false);
 };
 const openName=plans.find(p=>p.id===openId)?.name;
 const defaultPlanName=`${c.name} – ${new Date().toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}`;

 const changeContainer=(name:string)=>{setContainerName(name); clearCont(CONTAINERS.find(x=>x.name===name)||CONTAINERS[2]);};

 return <div className="app">
  <header><div><h1>LOAD CONTAINER 3D</h1><span>{c.name}{openName&&<> · <b className="open-name">{openName}</b></>}</span></div>
   <div className="actions">
    <label className="quality">Mức tối ưu <select value={quality} onChange={e=>setQuality(Number(e.target.value))}>{QUALITIES.map((q,i)=><option key={q.label} value={i}>{q.label}</option>)}</select></label>
    <button onClick={loadAll} disabled={busy} title="Xếp lại toàn bộ sản phẩm bằng thuật toán tối ưu">{busy?'ĐANG TÍNH…':'LOAD CONT'}</button>
    <button className="secondary" onClick={()=>clearCont()}>DỠ HẾT</button>
    <button className="save-btn" onClick={()=>setShowPlans(true)} disabled={busy} title="Lưu cách sắp xếp hiện tại, hoặc mở lại cont đã lưu">LƯU / MỞ CONT{plans.length?` (${plans.length})`:''}</button>
   </div>
  </header>
  <main>
   <aside>
    <div className="aside-head"><h2>PRODUCTS ({products.length})</h2><button className="link" onClick={resetProducts}>Dữ liệu mẫu</button></div>
    {saveError&&<div className="alert">Không lưu được vào trình duyệt (ảnh quá nhiều/quá lớn). Dữ liệu sẽ mất khi tải lại trang.</div>}
    {products.map(p=><ProductCard key={p.uid} p={p} c={c} gap={gap} loaded={loadedBy[p.uid]||0} usage={usageBy[p.uid]||{}} busy={busy} onChange={patch=>update(p.uid,patch)} onRemove={()=>remove(p.uid)} onLoad={()=>loadProduct(p)} onUnload={()=>unload(p.uid)} onMove={dir=>move(p.uid,dir)}/>)}
    <button className="add" onClick={add}>+ Thêm sản phẩm</button>
    <hr/><h2>FILTER</h2><select value={productFilter} onChange={e=>setProductFilter(e.target.value)}><option value="ALL">All products</option>{products.map(p=><option key={p.uid} value={p.uid}>{p.code} · {p.name}</option>)}</select>
   </aside>
   <section className="viewer">
    <Container3D boxes={visible} c={c} mats={mats} drop={animating} selected={selected} onSelect={setSelected}/>
    <div className="player">
     <span>{busy?'Đang tìm phương án xếp tốt nhất…':animating?`Đang đóng hàng ${shown}/${total}`:`${total} thùng trong cont`}</span>
     {animating&&<><button className="icon" onClick={()=>setPaused(v=>!v)}>{paused?'▶':'❚❚'}</button><button className="icon" onClick={()=>setShown(total)} title="Hiện ngay tất cả">⏭</button></>}
     {!animating&&!busy&&total>0&&<button className="icon" onClick={()=>{setPaused(false);setShown(0);}} title="Xem lại quá trình đóng hàng từ đầu">↺ Xem lại</button>}
     <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{SPEEDS.map((s,i)=><option key={s.label} value={i}>{s.label}</option>)}</select>
    </div>
    <div className="hint">🖱 Kéo để xoay · Scroll để zoom · Click carton để chọn</div>
   </section>
   <aside className="stats"><h2>CONTAINER</h2>
    <select value={containerName} onChange={e=>changeContainer(e.target.value)}>{CONTAINERS.map(x=><option key={x.name}>{x.name}</option>)}</select>
    <div className="gaps">
     <b>Dung sai (thùng bị lồi)</b>
     {([['x','Trái / phải','Khoảng cách giữa 2 thùng đặt cạnh nhau theo chiều ngang cont'],['z','Trước / sau','Khoảng cách giữa 2 thùng đặt nối nhau theo chiều dọc cont (từ vách trong ra cửa)'],['y','Trên / dưới','Khoảng cách giữa thùng dưới và thùng chồng lên trên']] as const).map(([k,label,tip])=>
      <label key={k} title={tip}>{label}<span><input type="number" min={0} step={0.5} value={gap[k]/10} onChange={e=>changeGap({[k]:Math.max(0,Math.round(Number(e.target.value)*10))})}/>cm</span></label>)}
     <small className="muted">Chỉ tính giữa các thùng, thùng vẫn sát vách cont. Đổi dung sai sẽ dỡ cont để xếp lại.</small>
    </div>
    <div className="stat"><span>Size</span><b>{c.w} × {c.d} × {c.h} mm</b></div><div className="stat"><span>Max weight</span><b>{c.maxWeight.toLocaleString()} kg</b></div><div className="stat"><span>Cartons</span><b>{shown}</b></div><div className="stat"><span>Weight</span><b>{totalWeight.toLocaleString()} kg</b></div><div className="stat"><span>Volume</span><b>{volume.toFixed(2)} CBM</b></div><div className="stat"><span>Utilization</span><b>{Math.min(utilization,100).toFixed(1)}%</b></div><div className="progress"><i style={{width:`${Math.min(utilization,100)}%`}}/></div>
    {unplacedList.length>0&&<div className="alert">Không đủ chỗ / vượt tải trọng — hàng bị ói:{unplacedList.map(([uid,n])=>{const p=products.find(x=>x.uid===uid); return p&&<div key={uid}><b>{p.code}</b> ói {n} thùng · vào cont {Math.round((loadedBy[uid]||0)/p.qty*100)}%</div>;})}</div>}
    {missingList.length>0&&<div className="alert">Chưa dùng được chiều bắt buộc (không vừa cont / không còn chỗ phù hợp):{missingList.map(([p,keys])=><div key={p.uid}><b>{p.code}</b> {keys.map(h=>`${heightName(p,h)} (cao ${h}mm)`).join(', ')}</div>)}</div>}
    <hr/><h2>THỨ TỰ CHẤT</h2>
    <ol className="sequence">{groups.map(([g,ps])=><li key={g}><b>Nhóm {g}</b>{ps.map(p=><span key={p.uid}><i className="dot" style={{background:p.color}}/>{p.code}</span>)}</li>)}</ol>
    <small className="muted">{groups.length>1?'Nhóm 1 vào trước (sâu nhất). ':''}Các mã cùng nhóm được trộn chung lớp để tối ưu. Đổi nhóm ở ô "Thứ tự chất" của từng sản phẩm.</small>
    <label className="check strict" title="Khi hàng nhiều hơn sức chứa: mọi mã đều vào cont cùng một tỷ lệ, phần ói chia đều cho các mã (thay vì ưu tiên thùng to, bỏ hẳn mã khác). Áp dụng cho LOAD CONT."><input type="checkbox" checked={even} onChange={e=>setEven(e.target.checked)}/> Ói đều các mã khi quá tải</label>
    <label className="check strict" title="Nhóm sau không được chen vào vùng của nhóm trước, để dỡ hàng từng điểm không bị cản"><input type="checkbox" checked={strict} onChange={e=>setStrict(e.target.checked)}/> Giao nhiều điểm (tách vùng từng nhóm)</label>
    <hr/><h2>TRONG CONTAINER</h2>
    {products.filter(p=>loadedBy[p.uid]).map(p=><div className="stat" key={p.uid}><span><i className="dot" style={{background:p.color}}/>{p.code}</span><b>{loadedBy[p.uid]} thùng</b></div>)}
    {total===0&&<small className="muted">Chưa có hàng. Bấm "Cho vào cont" ở từng sản phẩm hoặc LOAD CONT.</small>}
    {selBox&&<div className="selected">
     Đang chọn: <b>{selBox.id}</b>{selProduct&&<> · {selProduct.name}</>}<br/>
     {selBox.w}×{selBox.d} ↑{selBox.h} mm · {selBox.orient[1]===2?'đứng':'nằm'}<br/>
     Cách vách trong {((selBox.z-selBox.d/2)/1000).toFixed(2)} m · cách sàn {((selBox.y-selBox.h/2)/1000).toFixed(2)} m
    </div>}
   </aside>
  </main>
  {showPlans&&<PlansDialog plans={plans} openId={openId} defaultName={defaultPlanName} empty={total===0}
   onNew={newCont} onSaveNew={saveNew} onOverwrite={overwrite} onOpen={openPlan}
   onRename={(id,name)=>commitPlans(plans.map(p=>p.id===id?{...p,name}:p))}
   onDelete={id=>{if(commitPlans(plans.filter(p=>p.id!==id))&&id===openId) setOpenId(null);}}
   onImport={importPlans} onClose={()=>setShowPlans(false)}/>}
 </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
