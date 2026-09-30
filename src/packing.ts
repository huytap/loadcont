export type ProductImages={long?:string;short?:string;top?:string};
// canTip: được phép lật nằm (không bắt buộc đứng thẳng)
// order: thứ tự chất (1 = vào trước, nằm sâu nhất). Các mã cùng thứ tự được trộn tự do để tối ưu.
// orients: chiều xếp do người dùng quy định (danh sách khóa trong ORIENTS). Không có = app tự tính.
// pattern: mẫu tự chất của 1 lớp (1 vách thùng nhìn từ cửa, dày 1 thùng); hệ thống tự tính số lớp và xếp nối nhau dọc cont
export type Product={uid:string;code:string;name:string;w:number;d:number;h:number;qty:number;weight:number;color:string;canTip?:boolean;order?:number;orients?:string[];pattern?:PatternSeg[];images?:ProductImages};
// Một cách xếp trong lớp mẫu (lớp = 1 vách thùng nhìn từ cửa, dày 1 thùng): hướng thùng,
// số cột (theo ngang cont) × số hàng (số tầng theo chiều cao).
// Cách xếp sau tự tìm khoảng trống còn vừa trong lớp: 'above' (chồng lên trên mặt các cách xếp đã có)
// hoặc 'beside' (bên cạnh, được đặt cả sát sàn); chọn chỗ thấp nhất rồi trái nhất.
// VD 45 thùng/lớp: 7 cột × 5 hàng đứng, trên cùng 5 cột × 2 hàng nằm.
export type PatternSeg={o:string;cols:number;rows:number;place?:'above'|'beside'};
// Chuyển mẫu lưu theo các dạng cũ sang dạng hiện tại
export function normalizePattern(pat?:unknown[]):PatternSeg[]{
 const list=(pat||[]) as Record<string,unknown>[];
 if(!list.length) return [];
 if(Array.isArray(list[0].segs)) return normalizePattern(list[0].segs as unknown[]);
 return list.map((x,i)=>({
  o:String(x.o), cols:Number(x.cols)||1,
  rows:Number('layers' in x?x.layers:x.rows)||1, // dạng cũ: "số lớp" là số tầng theo chiều cao
  place:i===0?undefined:x.place==='beside'?'beside':'above',
 }));
}
export type Container={name:string;w:number;d:number;h:number;maxWeight:number};
// Hướng đặt thùng: chỉ số kích thước gốc (0=dài, 1=rộng, 2=cao) nằm theo trục x (ngang cont), y (cao), z (dài cont)
export type Orient=[number,number,number];
export type Box={id:string;key:string;productId:string;x:number;y:number;z:number;w:number;d:number;h:number;weight:number;orient:Orient};
type Space={x:number;y:number;z:number;w:number;h:number;d:number};
// Trạng thái container: các thùng đã xếp + các khoảng trống còn lại (để cho thêm hàng mà không xếp lại từ đầu)
// gap: dung sai (mm) do thùng bị lồi — x: trái/phải (ngang cont), z: trước/sau (dọc cont), y: trên/dưới
export type Gap={x:number;y:number;z:number};
export type PackState={spaces:Space[];boxes:Box[];weight:number;seq:Record<string,number>;gap:Gap};
export type PackItem={p:Product;qty:number};
// missing: các chiều cao bắt buộc (đứng/nằm/dựng) chưa dùng được của từng mã
export type PackResult={state:PackState;unplaced:Record<string,number>;missing?:Record<string,number[]>};
// strict: giao nhiều điểm — nhóm sau không được chen vào vùng của nhóm trước (xếp tách thành từng đoạn theo chiều dài cont)
export type PackOptions={strict?:boolean};


export const DEFAULT_GAP:Gap={x:10,y:10,z:10};
// Dung sai đang dùng cho lần xếp hiện tại (lấy từ PackState khi bắt đầu xếp)
let G:Gap=DEFAULT_GAP;
const normGap=(g?:Partial<Gap>):Gap=>({x:g?.x??DEFAULT_GAP.x,y:g?.y??DEFAULT_GAP.y,z:g?.z??DEFAULT_GAP.z});

export const isValid=(p:Product)=>p.w>0&&p.d>0&&p.h>0&&p.qty>0&&(p.pattern?normalizePattern(p.pattern).length>0:!p.orients||p.orients.length>0);
export const orderOf=(p:Product)=>p.order&&p.order>0?p.order:1;

// Mỗi thùng chiếm thêm phần dung sai ở mỗi chiều, nên container cũng được nới thêm đúng phần đó:
// dung sai chỉ nằm giữa các thùng, thùng vẫn được sát vách và sát nóc cont.
export const emptyState=(c:Container,gap:Gap=DEFAULT_GAP):PackState=>({spaces:[{x:0,y:0,z:0,w:c.w+gap.x,h:c.h+gap.y,d:c.d+gap.z}],boxes:[],weight:0,seq:{},gap});

const UPRIGHT:Orient[]=[[0,2,1],[1,2,0]];
const TIPPED:Orient[]=[[0,1,2],[2,1,0],[1,0,2],[2,0,1]];
export const orientKey=(o:Orient)=>o.join('');
// Đủ 6 hướng đặt thùng, dùng cho chế độ người dùng tự chọn chiều xếp
export const ORIENTS:Orient[]=[...UPRIGHT,...TIPPED];
export const AUTO_ORIENTS=(p:Product)=>(p.canTip?ORIENTS:UPRIGHT).map(orientKey);
// Khóa kích thước của một chiều đặt: "ngang cont,cao,dọc cont" (2 chiều cho cùng kích thước là như nhau)
export const dimsKey=(p:Product,o:Orient)=>{const D=[p.w,p.d,p.h]; return `${D[o[0]]},${D[o[1]]},${D[o[2]]}`;};
export const boxDimsKey=(b:Box)=>`${b.w},${b.h},${b.d}`;
// Người dùng tự chọn chiều xếp → bắt buộc có đủ các "kiểu dựng" đã tick: đứng (cạnh cao dựng lên), nằm (cạnh rộng dựng lên),
// dựng (cạnh dài dựng lên). Mỗi kiểu nhận diện bằng chiều cao thùng khi đặt; xoay ngang trong cùng kiểu do hệ thống tự chọn.
export function requiredHeights(p:Product):number[]{
 if(!p.orients||p.pattern) return [];
 const D=[p.w,p.d,p.h];
 const hs=[...new Set(ORIENTS.filter(o=>p.orients!.includes(orientKey(o))).map(o=>D[o[1]]))];
 return hs.length>1?hs:[];
}
// Các kiểu dựng bắt buộc chưa được dùng trong container của từng mã
export function missingOf(state:PackState,items:PackItem[]):Record<string,number[]>{
 const out:Record<string,number[]>={};
 for(const {p} of items){
  const req=requiredHeights(p); if(!req.length) continue;
  const used=new Set(state.boxes.filter(b=>b.productId===p.uid).map(b=>b.h));
  const miss=req.filter(h=>!used.has(h)); if(miss.length) out[p.uid]=miss;
 }
 return out;
}

/*
 Thuật toán xếp khối trên "không gian trống cực đại" (maximal spaces):
 - Chỗ trống được lưu thành các hình hộp lớn nhất có thể, được phép chồng lấn nhau.
 - Hàng được chất theo từng nhóm thứ tự. Trong một nhóm, luôn lấp chỗ trống sâu nhất → thấp nhất → trái nhất
   bằng khối tốt nhất của bất kỳ mã nào trong nhóm; nhóm sau lấp tiếp các khe nhóm trước để lại (trừ chế độ strict).
 - Khối ứng viên gồm: khối 1 mã (nx × ny × nz thùng), và "lớp trộn" nhiều mã ghép cạnh nhau theo chiều ngang,
   được tính trước bằng quy hoạch động (knapsack) để lấp kín mặt cắt container nhất.
 - Mặt trên của các khối cùng độ cao được ghép lại thành một chỗ trống lớn để mã khác chất lên.
 - Bất biến: đáy của mọi chỗ trống luôn nằm trên sàn hoặc trên mặt thùng → không có thùng lơ lửng.
 - Chạy các chiến lược cố định, sau đó (nếu có thời gian) chạy thêm nhiều vòng ngẫu nhiên có chọn lọc
   và giữ phương án tốt nhất.
*/

type Item=PackItem&{idx:number};
type Depth='deep'|'thin';
// Một khối thùng cùng mã, cùng hướng: nx × ny × nz thùng, lệch (dx, dy) so với góc chỗ trống
type Part={item:Item;o:Orient;bw:number;bh:number;bd:number;nx:number;ny:number;nz:number;dx:number;dy:number;dz?:number};
// Ứng viên: 1 khối, hoặc lớp trộn nhiều khối (các cột cạnh nhau, mỗi cột có thể chồng tầng đứng + tầng nằm)
type Cand={parts:Part[];idx:number;vol:number;fill:number;boxVol:number;pattern?:boolean};
const SCORES={
 volume:(c:Cand)=>c.vol,
 fill:(c:Cand)=>c.vol*c.fill*c.fill,
 layer:(c:Cand)=>c.fill*1e15+c.vol,
 big:(c:Cand)=>c.boxVol+c.fill,
 list:(c:Cand,n:number)=>(n-c.idx)*1e15+c.vol,
};
type ScoreName=keyof typeof SCORES;
// noTip: tạm bỏ qua quyền lật để so sánh (lật không phải lúc nào cũng tốt hơn)
// Cách dựng lớp trộn:
//  'simple': mỗi mã 1 hướng cho cả lớp, chiều sâu lớp = 1 thùng (nhanh)
//  'mix'   : mỗi cột có thể chồng tầng đứng + tầng nằm
//  'mixDeep': như 'mix' và thử thêm chiều sâu lớp bằng bội số thùng (khớp đứng/nằm tốt hơn nhưng chậm hơn)
type ComboMode='simple'|'mix'|'mixDeep';
const COMBO_MODES:ComboMode[]=['simple','mix','mixDeep'];
// force: ưu tiên đặt ngay khối có chiều bắt buộc chưa dùng ('always'), hoặc ép ngẫu nhiên ở các vị trí khác nhau ('random')
// look: nhìn trước phần nóc (bớt tầng đứng để chất tầng nằm trên cùng)
type Strategy={score:ScoreName;depths:Depth[];noTip?:boolean;combo:ComboMode;look?:boolean;force?:'always'|'random';rng?:()=>number};
const SCORE_NAMES=Object.keys(SCORES) as ScoreName[];
const STRATEGIES:Omit<Strategy,'combo'>[]=(['deep','thin'] as const).flatMap(d=>SCORE_NAMES.map(score=>({score,depths:[d]})));

const overlaps=(a:Space,b:Space)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h&&a.z<b.z+b.d&&b.z<a.z+a.d;
const contains=(a:Space,b:Space)=>a.x<=b.x&&a.y<=b.y&&a.z<=b.z&&a.x+a.w>=b.x+b.w&&a.y+a.h>=b.y+b.h&&a.z+a.d>=b.z+b.d;
// Ưu tiên chỗ trống: sâu nhất (z nhỏ) → thấp nhất → trái nhất
const before=(a:Space,b:Space)=>a.z-b.z||a.y-b.y||a.x-b.x;

// Phần còn lại của chỗ trống s sau khi đặt khối b. Phần phía trên chỉ lấy đúng diện tích mặt khối để luôn có đỡ bên dưới.
function split(s:Space,b:Space):Space[]{
 const sx2=s.x+s.w,sy2=s.y+s.h,sz2=s.z+s.d,bx2=b.x+b.w,by2=b.y+b.h,bz2=b.z+b.d;
 const parts:Space[]=[
  {x:s.x,y:s.y,z:s.z,w:b.x-s.x,h:s.h,d:s.d},
  {x:bx2,y:s.y,z:s.z,w:sx2-bx2,h:s.h,d:s.d},
  {x:s.x,y:s.y,z:s.z,w:s.w,h:s.h,d:b.z-s.z},
  {x:s.x,y:s.y,z:bz2,w:s.w,h:s.h,d:sz2-bz2},
  {x:s.x,y:s.y,z:s.z,w:s.w,h:b.y-s.y,d:s.d},
 ];
 const fx=Math.max(s.x,b.x),fz=Math.max(s.z,b.z);
 parts.push({x:fx,y:by2,z:fz,w:Math.min(sx2,bx2)-fx,h:sy2-by2,d:Math.min(sz2,bz2)-fz});
 return parts.filter(p=>p.w>0&&p.h>0&&p.d>0);
}

// Ghép hai chỗ trống cùng độ cao đáy nằm sát nhau thành một chỗ trống rộng hơn (vd: mặt trên của 2 khối kề nhau)
function merge(a:Space,b:Space):Space|null{
 if(a.y!==b.y) return null;
 const h=Math.min(a.y+a.h,b.y+b.h)-a.y;
 const x1=Math.min(a.x,b.x),x2=Math.max(a.x+a.w,b.x+b.w),z1=Math.min(a.z,b.z),z2=Math.max(a.z+a.d,b.z+b.d);
 const ox1=Math.max(a.x,b.x),ox2=Math.min(a.x+a.w,b.x+b.w),oz1=Math.max(a.z,b.z),oz2=Math.min(a.z+a.d,b.z+b.d);
 if(ox1<=ox2&&oz2>oz1&&(x2-x1>a.w||x2-x1>b.w)) return {x:x1,y:a.y,z:oz1,w:x2-x1,h,d:oz2-oz1};
 if(oz1<=oz2&&ox2>ox1&&(z2-z1>a.d||z2-z1>b.d)) return {x:ox1,y:a.y,z:z1,w:ox2-ox1,h,d:z2-z1};
 return null;
}

// Cập nhật danh sách chỗ trống sau khi đặt một khối
function place(spaces:Space[],block:Space,dead:Set<Space>):Space[]{
 const kept:Space[]=[], created:Space[]=[];
 for(const sp of spaces){
  if(!overlaps(sp,block)){kept.push(sp);continue;}
  for(const part of split(sp,block)){created.push(part); if(dead.has(sp)) dead.add(part);}
 }
 // Ghép các chỗ trống mới với chỗ trống cùng độ cao sát bên
 const pool=[...kept,...created];
 for(let i=0;i<created.length&&created.length<400;i++)
  for(const o of pool){const m=merge(created[i],o); if(m&&!pool.some(q=>contains(q,m))){created.push(m);pool.push(m);}}
 // Bỏ các chỗ trống nằm gọn trong chỗ trống khác
 let all=kept;
 for(const sp of created){
  if(all.some(o=>contains(o,sp))) continue;
  all=all.filter(o=>!contains(sp,o)); all.push(sp);
 }
 return all;
}

// Chiều xếp được phép: theo mẫu tự chất (các hướng có trong mẫu), theo người dùng quy định,
// hoặc app tự tính (đứng thẳng, thêm hướng nằm nếu được lật)
export function orientations(p:Product,allowTip=true):Orient[]{
 const D=[p.w,p.d,p.h], seen=new Set<string>();
 const patKeys=p.pattern?normalizePattern(p.pattern).map(x=>x.o):null;
 const list=patKeys?ORIENTS.filter(o=>patKeys.includes(orientKey(o)))
  :p.orients?ORIENTS.filter(o=>p.orients!.includes(orientKey(o))):p.canTip&&allowTip?ORIENTS:UPRIGHT;
 return list.filter(o=>{const k=o.map(i=>D[i]).join(','); if(seen.has(k)) return false; seen.add(k); return true;});
}
const dimsOf=(p:Product,o:Orient)=>{const D=[p.w,p.d,p.h]; return {bw:D[o[0]]+G.x,bh:D[o[1]]+G.y,bd:D[o[2]]+G.z};};
const partVol=(pt:Part)=>pt.nx*pt.ny*pt.nz*pt.item.p.w*pt.item.p.d*pt.item.p.h;
// top: ước tính phần thùng lấp được khoảng trống phía trên khối (nhìn trước 1 bước), cộng vào điểm của ứng viên
function makeCand(parts:Part[],s:Space,top={vol:0,area:0}):Cand{
 return {
  parts,
  idx:Math.min(...parts.map(pt=>pt.item.idx)),
  vol:parts.reduce((v,pt)=>v+partVol(pt),0)+top.vol,
  fill:(parts.reduce((f,pt)=>f+pt.nx*pt.bw*pt.ny*pt.bh,0)+top.area)/(s.w*s.h), // tỉ lệ lấp đầy mặt cắt ngang của chỗ trống
  boxVol:Math.max(...parts.map(pt=>pt.item.p.w*pt.item.p.d*pt.item.p.h)),
 };
}

// Ước tính số thùng (bất kỳ mã/chiều nào) chất được lên mặt phẳng W × D với khoảng trống cao R phía trên khối.
// Giúp so sánh "5 tầng đứng" với "4 tầng đứng + 2 tầng nằm trên cùng" như cách chất thực tế.
function topEst(items:Item[],allowTip:boolean,W:number,D:number,R:number){
 let best={vol:0,area:0};
 if(R<=0) return best;
 for(const it of items){
  if(it.qty<=0) continue;
  for(const o of orientations(it.p,allowTip)){
   const {bw,bh,bd}=dimsOf(it.p,o);
   const cols=Math.floor(W/bw),rows=Math.floor(R/bh),deep=Math.floor(D/bd);
   const n=Math.min(cols*rows*deep,it.qty); if(!n) continue;
   const vol=n*it.p.w*it.p.d*it.p.h;
   if(vol>best.vol) best={vol,area:cols*bw*rows*bh*Math.min(1,n/(cols*rows*deep))};
  }
 }
 return best;
}
const sumTop=(a:{vol:number;area:number},b:{vol:number;area:number})=>({vol:a.vol+b.vol,area:a.area+b.area});

// Khối 1 mã đặt vào góc trong-dưới-trái của chỗ trống
// look: thử thêm phương án bớt 1–2 tầng để chừa chỗ cho tầng nằm/tầng mã khác trên cùng, chấm điểm kèm phần nóc ước tính
function singleCands(s:Space,items:Item[],remWeight:number,depths:Depth[],allowTip:boolean,look:boolean):Cand[]{
 const out:Cand[]=[];
 for(const item of items){
  const p=item.p; if(item.qty<=0) continue;
  const cap=Math.min(item.qty,p.weight>0?Math.floor(remWeight/p.weight):Infinity); if(cap<=0) continue;
  for(const o of orientations(p,allowTip)){
   const {bw,bh,bd}=dimsOf(p,o);
   const mx=Math.floor(s.w/bw),my=Math.floor(s.h/bh),mzMax=Math.floor(s.d/bd);
   if(!mx||!my||!mzMax) continue;
   for(const depth of depths) for(const cut of look?[0,1,2]:[0]){
    const myc=my-cut; if(myc<1) continue;
    let nx=mx,ny=myc,nz=depth==='thin'?1:mzMax;
    if(cap<nx*ny*nz){
     if(cap>=mx*myc) nz=Math.floor(cap/(mx*myc));
     else if(cap>=mx){nz=1;ny=Math.floor(cap/mx);}
     else {nz=1;ny=1;nx=cap;}
    }
    const rest=items.map(i=>i===item?{...i,qty:i.qty-nx*ny*nz}:i);
    const top=look&&ny===myc?topEst(rest,allowTip,nx*bw,nz*bd,s.h-ny*bh):undefined;
    if(cut&&!top?.vol) continue; // bớt tầng mà không chất thêm được gì lên trên thì vô ích
    out.push(makeCand([{item,o,bw,bh,bd,nx,ny,nz,dx:0,dy:0}],s,top));
   }
  }
 }
 return out;
}

// Một loại cột: các thùng cùng mã, cùng bề ngang, chồng nhiều tầng có thể khác hướng (vd: 2 tầng đứng + 5 tầng nằm)
type Layer={o:Orient;bh:number;bd:number;nz:number;m:number};
type ColType={item:Item;bw:number;layers:Layer[];u:number;value:number;perCol:number;maxCols:number};
const U=10; // bước lưới 10mm cho quy hoạch động

// Với mỗi bề ngang cột, chọn số tầng của từng hướng (cùng bề ngang) để lấp kín chiều cao nhất (knapsack theo chiều cao).
function columnTypes(s:Space,D:number,item:Item,allowTip:boolean,mix:boolean):ColType[]{
 const p=item.p, boxVol=p.w*p.d*p.h, hcap=Math.floor(s.h/U);
 const groups=new Map<number,{o:Orient;bh:number;bd:number;nz:number;hu:number;val:number}[]>();
 for(const o of orientations(p,allowTip)){
  const {bw,bh,bd}=dimsOf(p,o);
  if(bw>s.w||bh>s.h||bd>D) continue;
  const nz=Math.floor(D/bd);
  const opt={o,bh,bd,nz,hu:Math.ceil(bh/U),val:nz*boxVol};
  if(mix) groups.set(bw,[...(groups.get(bw)||[]),opt]); else groups.set(groups.size,[opt]); // không trộn: mỗi hướng 1 loại cột riêng
 }
 const out:ColType[]=[];
 for(const opts of groups.values()){
  const bw=dimsOf(p,opts[0].o).bw;
  const val=new Float64Array(hcap+1), from=new Int8Array(hcap+1).fill(-1);
  for(let h=1;h<=hcap;h++){
   val[h]=val[h-1];
   opts.forEach((o,i)=>{if(o.hu<=h&&val[h-o.hu]+o.val>val[h]){val[h]=val[h-o.hu]+o.val;from[h]=i;}});
  }
  const counts=opts.map(()=>0);
  for(let h=hcap;h>0;){const i=from[h]; if(i<0){h--;continue;} counts[i]++; h-=opts[i].hu;}
  // Tầng có đáy sâu hơn đặt dưới để tầng trên luôn được đỡ kín
  const layers=opts.map((o,i)=>({o:o.o,bh:o.bh,bd:o.bd,nz:o.nz,m:counts[i]})).filter(l=>l.m>0)
   .sort((a,b)=>b.nz*b.bd-a.nz*a.bd||b.bh-a.bh);
  const perCol=layers.reduce((n,l)=>n+l.m*l.nz,0);
  if(!perCol) continue;
  const maxCols=Math.min(Math.floor(item.qty/perCol),Math.floor(s.w/bw));
  if(!maxCols) continue;
  out.push({item,bw,layers,u:Math.ceil(bw/U),value:perCol*boxVol,perCol,maxCols});
 }
 // Không trộn: mỗi mã chỉ giữ 1 hướng tốt nhất cho cả lớp
 if(!mix&&out.length>1) return [out.reduce((a,b)=>b.value/b.u>a.value/a.u?b:a)];
 return out;
}

// Lớp trộn: ghép các cột (nhiều mã, nhiều hướng) cạnh nhau theo chiều ngang để lấp kín mặt cắt container nhất.
// Với mỗi chiều sâu lớp D: dựng các loại cột, rồi giải knapsack giới hạn theo chiều ngang (bước 10mm).
function comboCand(s:Space,items:Item[],remWeight:number,allowTip:boolean,mode:ComboMode,look:boolean):Cand|null{
 const multiD=mode==='mixDeep', mix=mode!=='simple';
 const cap=Math.floor(s.w/U);
 const avail=items.filter(i=>i.qty>0);
 if(!avail.length) return null;
 const depthsD=new Set<number>();
 // Chiều sâu lớp thử: bội số chiều sâu thùng (tối đa 4 thùng / 2500mm) để tầng đứng và tầng nằm có độ sâu khác nhau vẫn khớp
 for(const it of avail) for(const o of orientations(it.p,allowTip)){
  const {bw,bh,bd}=dimsOf(it.p,o);
  if(bw<=s.w&&bh<=s.h) for(let k=1;k<=(multiD?4:1)&&k*bd<=s.d&&(k===1||k*bd<=2500);k++) depthsD.add(k*bd);
 }
 let best:{parts:Part[];density:number;top:{vol:number;area:number}}|null=null;
 for(const D of depthsD){
  const types=avail.flatMap(it=>columnTypes(s,D,it,allowTip,mix));
  if(!types.length) continue;
  const val=new Float64Array(cap+1), choice=types.map(()=>new Uint8Array(cap+1));
  types.forEach((t,ti)=>{
   for(let c=cap;c>=t.u;c--){
    let bv=val[c],bk=0;
    for(let k=1;k<=t.maxCols&&k*t.u<=c;k++){const v=val[c-k*t.u]+k*t.value; if(v>bv){bv=v;bk=k;}}
    val[c]=bv; choice[ti][c]=bk;
   }
  });
  const chosen:{t:ColType;k:number}[]=[];
  for(let ti=types.length-1,c=cap;ti>=0;ti--){const k=choice[ti][c]; if(k){chosen.push({t:types[ti],k}); c-=k*types[ti].u;}}
  // Các loại cột của cùng một mã dùng chung số lượng còn lại
  const left=new Map(avail.map(i=>[i,i.qty]));
  let weight=0,value=0;
  for(const ch of chosen){
   ch.k=Math.min(ch.k,Math.floor(left.get(ch.t.item)!/ch.t.perCol));
   left.set(ch.t.item,left.get(ch.t.item)!-ch.k*ch.t.perCol);
   weight+=ch.k*ch.t.perCol*ch.t.item.p.weight; value+=ch.k*ch.t.value;
  }
  if(weight>remWeight) continue;
  // Cột cao đặt trước cho mặt trên dễ ghép
  const cols=chosen.filter(ch=>ch.k>0).sort((a,b)=>b.t.layers.reduce((h,l)=>h+l.m*l.bh,0)-a.t.layers.reduce((h,l)=>h+l.m*l.bh,0));
  const parts:Part[]=[]; let x=0, top={vol:0,area:0};
  const rest=avail.map(i=>({...i,qty:left.get(i)!}));
  for(const {t,k} of cols){
   let y=0;
   for(const l of t.layers){parts.push({item:t.item,o:l.o,bw:t.bw,bh:l.bh,bd:l.bd,nx:k,ny:l.m,nz:l.nz,dx:x,dy:y}); y+=l.m*l.bh;}
   const lastL=t.layers[t.layers.length-1];
   if(look) top=sumTop(top,topEst(rest,allowTip,k*t.bw,lastL.nz*lastL.bd,s.h-y));
   x+=k*t.bw;
  }
  if(parts.length<2) continue; // 1 khối thì khối đơn đã xét rồi
  const density=(value+top.vol)/(s.w*s.h*D);
  if(!best||density>best.density) best={parts,density,top};
 }
 return best?makeCand(best.parts,s,best.top):null;
}

// Toạ độ trong mặt vách: x theo ngang cont, y theo chiều cao; D là độ dày (1 thùng theo dọc cont)
type SegGeo={o:Orient;cols:number;rows:number;bw:number;bh:number;bd:number;x:number;y:number;W:number;H:number;D:number};
const spanOverlap=(a1:number,a2:number,b1:number,b2:number)=>Math.max(0,Math.min(a2,b2)-Math.max(a1,b1));
// Lớp trên được nhô ra so với phần bên dưới nếu vẫn được đỡ ít nhất 80% đáy
export const MIN_SUPPORT=0.8;

const overlapsAny=(segs:SegGeo[],x:number,y:number,W:number,H:number)=>segs.some(q=>spanOverlap(q.x,q.x+q.W,x,x+W)>0&&spanOverlap(q.y,q.y+q.H,y,y+H)>0);
// Tỉ lệ đáy được đỡ: phần giao với mặt trên của các cách xếp có mặt trên đúng bằng đáy (y)
const supportOf=(segs:SegGeo[],x:number,y:number,W:number,D:number)=>
 y<=0?1:segs.filter(q=>q.y+q.H===y).reduce((a,q)=>a+spanOverlap(q.x,q.x+q.W,x,x+W)*Math.min(q.D,D),0)/(W*D);

// Dựng hình học lớp mẫu (toạ độ đã cộng dung sai, như trong thuật toán xếp) và kiểm tra hợp lệ.
// bounds: kích thước mặt vách được phép (ngang, cao) để cách xếp 'above' tìm khoảng trống vừa.
function layoutPattern(p:Product,g:Gap,bounds={w:Infinity,h:Infinity}){
 const Dm=[p.w,p.d,p.h], segs:SegGeo[]=[], errors:string[]=[], warnings:string[]=[];
 normalizePattern(p.pattern).forEach((S,si)=>{
  const o=ORIENTS.find(x=>orientKey(x)===S.o);
  if(!o||S.cols<1||S.rows<1){errors.push(`Cách xếp ${si+1} chưa nhập đủ`);return;}
  const bw=Dm[o[0]]+g.x,bh=Dm[o[1]]+g.y,bd=Dm[o[2]]+g.z, prev=segs[segs.length-1];
  const W=S.cols*bw, H=S.rows*bh;
  // Tìm khoảng trống: thử mọi góc (mép các cách xếp đã có × sàn/mặt trên), chọn chỗ thấp nhất rồi trái nhất
  // còn vừa trong vách, không đè cách xếp khác và được đỡ đủ
  const findSpot=(W:number,H:number,D:number)=>{
   const xs=[...new Set([0,...segs.flatMap(q=>[q.x,q.x+q.W])])];
   const ys=[...new Set([...(S.place==='beside'?[0]:[]),...segs.map(q=>q.y+q.H)])];
   return ys.flatMap(yy=>xs.map(xx=>({x:xx,y:yy})))
    .filter(c=>c.x+W<=bounds.w&&c.y+H<=bounds.h&&!overlapsAny(segs,c.x,c.y,W,H)&&supportOf(segs,c.x,c.y,W,D)>=MIN_SUPPORT)
    .sort((a,b)=>a.y-b.y||a.x-b.x)[0];
  };
  let x=0,y=0;
  if(prev){
   const spot=findSpot(W,H,bd);
   if(spot) ({x,y}=spot);
   else {
    // Không còn chỗ vừa: đặt tạm cạnh/lên cách xếp liền trước để vẽ (sẽ báo lỗi) và gợi ý hướng xếp khác vừa chỗ trống
    x=S.place==='beside'?prev.x+prev.W:prev.x; y=S.place==='beside'?prev.y:prev.y+prev.H;
    // Lý do cụ thể tại vị trí tự nhiên (lên trên / cạnh cách xếp liền trước)
    const why:string[]=[];
    if(y+H>bounds.h) why.push(`${S.place==='beside'?'đặt cạnh':'chồng lên'} cách xếp ${si} thì vượt chiều cao cont ${y+H-bounds.h}mm`+(g.y?` (đang tính dung sai trên/dưới ${g.y/10}cm mỗi tầng)`:''));
    if(x+W>bounds.w) why.push(`vượt ngang cont ${x+W-bounds.w}mm`);
    if(!why.length&&overlapsAny(segs,x,y,W,H)) why.push('đè lên cách xếp khác');
    if(!why.length) why.push(`chỉ được đỡ ${Math.round(supportOf(segs,x,y,W,bd)*100)}% đáy`);
    const alt=ORIENTS.filter(o2=>orientKey(o2)!==S.o).filter(o2=>findSpot(S.cols*(Dm[o2[0]]+g.x),S.rows*(Dm[o2[1]]+g.y),Dm[o2[2]]+g.z))
     .map(o2=>`${Dm[o2[0]]}×${Dm[o2[2]]} ↑${Dm[o2[1]]}`);
    errors.push(`Cách xếp ${si+1} (${S.cols} cột × ${S.rows} hàng) không còn chỗ vừa: ${why.join(', ')}.`+
     (alt.length?` Gợi ý: đổi hướng xếp sang ${[...new Set(alt)].join(' hoặc ')} thì vừa.`:' Thử giảm số cột/hàng.'));
   }
  }
  const seg={o,cols:S.cols,rows:S.rows,bw,bh,bd,x,y,W,H,D:bd};
  const placed=!errors.some(e=>e.startsWith(`Cách xếp ${si+1} (`));
  if(placed&&overlapsAny(segs,x,y,W,H)) errors.push(`Cách xếp ${si+1} đè lên cách xếp khác`);
  if(placed&&y>0){
   const sup=supportOf(segs,x,y,W,bd);
   if(sup<MIN_SUPPORT) errors.push(`Cách xếp ${si+1} chỉ được đỡ ${Math.round(sup*100)}% đáy (cần ≥ ${MIN_SUPPORT*100}%)`);
   else if(sup<0.999) warnings.push(`Cách xếp ${si+1} nhô ra so với phần bên dưới (được đỡ ${Math.round(sup*100)}%)`);
  }
  segs.push(seg);
 });
 const W=Math.max(0,...segs.map(q=>q.x+q.W)), H=Math.max(0,...segs.map(q=>q.y+q.H)), D=Math.max(0,...segs.map(q=>q.D));
 return {segs,W,H,D,errors,warnings};
}

// Một lớp theo mẫu tự chất, đặt ở góc trong-dưới-trái của chỗ trống (trên sàn).
// Chất theo thứ tự các cách xếp (dưới trước, trên sau), mỗi cách xếp từ tầng dưới lên;
// hết hàng thì tầng cuối chỉ xếp một phần.
function patternCand(s:Space,item:Item,remWeight:number):Cand|null{
 const p=item.p, lay=layoutPattern(p,G,{w:s.w,h:s.h});
 if(lay.errors.length||!lay.segs.length||lay.W>s.w||lay.H>s.h||lay.D>s.d) return null;
 let left=Math.min(item.qty,p.weight>0?Math.floor(remWeight/p.weight):Infinity);
 if(left<=0) return null;
 const parts:Part[]=[];
 for(const q of lay.segs){
  const base={item,o:q.o,bw:q.bw,bh:q.bh,bd:q.bd,nz:1,dx:q.x,dz:0};
  const per=q.cols*q.rows;
  if(left>=per){parts.push({...base,nx:q.cols,ny:q.rows,dy:q.y}); left-=per;}
  else {
   const rows=Math.floor(left/q.cols), rest=left-rows*q.cols;
   if(rows) parts.push({...base,nx:q.cols,ny:rows,dy:q.y});
   if(rest) parts.push({...base,nx:rest,ny:1,dy:q.y+rows*q.bh});
   left=0;
  }
  if(left<=0) break;
 }
 if(!parts.length) return null;
 return {...makeCand(parts,s),pattern:true};
}

// Thông số 1 lớp theo mẫu (mm thật) để hiển thị và kiểm tra trước khi xếp
export function patternInfo(p:Product,c:Container,gap:Gap){
 const lay=layoutPattern(p,gap,{w:c.w+gap.x,h:c.h+gap.y}), Dm=[p.w,p.d,p.h];
 const W=Math.max(0,lay.W-gap.x), H=Math.max(0,lay.H-gap.y), D=Math.max(0,lay.D-gap.z);
 const errors=[...lay.errors];
 if(W>c.w) errors.push(`Rộng ${W}mm vượt ngang cont ${c.w}mm`);
 if(H>c.h) errors.push(`Cao ${H}mm vượt chiều cao cont ${c.h}mm`);
 const per=lay.segs.reduce((n,q)=>n+q.cols*q.rows,0);
 const across=W>0?Math.max(1,Math.floor((c.w+gap.x)/(W+gap.x))):0; // lớp hẹp thì đặt được nhiều lớp cạnh nhau
 const along=D>0?Math.floor((c.d+gap.z)/(D+gap.z)):0;
 const segs=lay.segs.map(q=>({x:q.x,y:q.y,cols:q.cols,rows:q.rows,w:Dm[q.o[0]],h:Dm[q.o[1]],d:Dm[q.o[2]],lying:q.o[1]!==2}));
 return {W,H,D,per,segs,errors,warnings:lay.warnings,maxLayers:across*along,needLayers:per?Math.ceil(p.qty/per):0};
}

function packWith(state:PackState,items:PackItem[],c:Container,st:Strategy,opts:PackOptions):PackResult{
 G=normGap(state.gap);
 const its:Item[]=items.map((i,idx)=>({...i,idx}));
 const boxes=[...state.boxes], seq={...state.seq};
 const n=its.length;
 // Chiều bắt buộc chưa dùng của từng mã (tính cả thùng đã có trong cont)
 const need=new Map(its.map(i=>[i.p.uid,new Set(requiredHeights(i.p))]));
 for(const b of boxes) need.get(b.productId)?.delete(b.h);
 const fills=(c:Cand)=>c.parts.some(pt=>need.get(pt.item.p.uid)?.has(pt.bh-G.y));
 const score=(c:Cand)=>(c.pattern?1e21:0)+SCORES[st.score](c,n)+(st.force&&fills(c)&&(st.force==='always'||st.rng!()<0.3)?1e20:0);
 const comboArea=(c.w*c.h)/4; // chỉ tính lớp trộn cho chỗ trống đủ rộng
 let weight=state.weight, spaces=[...state.spaces];
 const groups=[...new Set(its.map(i=>orderOf(i.p)))].sort((a,b)=>a-b);
 for(const g of groups){
  const act=its.filter(i=>orderOf(i.p)===g);
  const patterned=act.filter(i=>i.p.pattern?.length), free=act.filter(i=>!i.p.pattern?.length);
  // Chế độ giao nhiều điểm: nhóm này chỉ được chất phía ngoài mọi thùng đã có
  const frontier=opts.strict?boxes.reduce((m,b)=>Math.max(m,b.z+b.d/2+G.z),0):0;
  // Mép ngoài phần cont đã chất theo từng mã: chỗ trống bắt đầu trước mép của MÃ KHÁC là khoảng trống còn sót
  // (vd lớp dở dang của mã trước) → mã tự chất được lấp vào; khe trong phần của chính nó thì giữ đúng mẫu
  const frontBy=new Map<string,number>();
  for(const b of boxes) frontBy.set(b.productId,Math.max(frontBy.get(b.productId)??0,b.z+b.d/2+G.z));
  const frontOther=(uid:string)=>{let m=0; for(const [k,v] of frontBy) if(k!==uid&&v>m) m=v; return m;};
  const dead=new Set<Space>(); // chỗ trống không vừa mã nào còn lại trong nhóm
  for(;;){
   let s:Space|null=null, orig:Space|null=null;
   for(const sp of spaces){
    if(dead.has(sp)||sp.z+sp.d<=frontier) continue;
    const v=sp.z>=frontier?sp:{...sp,z:frontier,d:sp.z+sp.d-frontier};
    if(!s||before(v,s)<0){s=v;orig=sp;}
   }
   if(!s||!orig) break;
   const cands=singleCands(s,free,c.maxWeight-weight,st.depths,!st.noTip,!!st.look);
   if(s.w*s.h>=comboArea){const cb=comboCand(s,free,c.maxWeight-weight,!st.noTip,st.combo,!!st.look); if(cb) cands.push(cb);}
   // Mã tự chất theo mẫu: đặt nguyên 1 lượt trên sàn, luôn được ưu tiên trước để lặp lại đúng mẫu
   if(s.y===0) for(const it of patterned){const pc=patternCand(s,it,c.maxWeight-weight); if(pc) cands.push(pc);}
   // Mã tự chất lấp luôn khoảng trống còn sót trong phần đã chất (lớp dở dang của mã trước, trên đầu, khe bên cạnh)
   // bằng các hướng có trong mẫu; phần cont còn trống hoàn toàn vẫn chất theo đúng mẫu
   const gapFillers=patterned.filter(it=>s!.z<frontOther(it.p.uid));
   if(gapFillers.length) cands.push(...singleCands(s,gapFillers,c.maxWeight-weight,st.depths,true,false));
   if(!cands.length){dead.add(orig);continue;}
   let b:Cand;
   if(st.rng){
    // Vòng ngẫu nhiên: chọn trong 3 ứng viên điểm cao nhất, nghiêng về ứng viên tốt nhất
    const sc=new Map(cands.map(x=>[x,score(x)]));
    cands.sort((a,z)=>sc.get(z)!-sc.get(a)!);
    b=cands[Math.floor(st.rng()**2*Math.min(3,cands.length))];
   } else {
    let bs=-Infinity; b=cands[0]; for(const x of cands){const v=score(x); if(v>bs){bs=v;b=x;}}
   }
   for(const pt of b.parts){
    const x0=s.x+pt.dx, y0=s.y+pt.dy, z0=s.z+(pt.dz??0);
    const p=pt.item.p, w=pt.bw-G.x, h=pt.bh-G.y, d=pt.bd-G.z;
    for(let k=0;k<pt.nz;k++) for(let j=0;j<pt.ny;j++) for(let i=0;i<pt.nx;i++){
     const no=seq[p.uid]=(seq[p.uid]||0)+1;
     boxes.push({id:`${p.code}-${no}`,key:`${p.uid}-${no}`,productId:p.uid,x:x0+i*pt.bw+w/2,y:y0+j*pt.bh+h/2,z:z0+k*pt.bd+d/2,w,d,h,weight:p.weight,orient:pt.o});
    }
    const cnt=pt.nx*pt.ny*pt.nz; pt.item.qty-=cnt; weight+=cnt*p.weight;
    need.get(p.uid)?.delete(h);
    const block:Space={x:x0,y:y0,z:z0,w:pt.nx*pt.bw,h:pt.ny*pt.bh,d:pt.nz*pt.bd};
    spaces=place(spaces,block,dead);
    frontBy.set(p.uid,Math.max(frontBy.get(p.uid)??0,block.z+block.d));
   }
  }
 }
 const unplaced:Record<string,number>={};
 for(const i of its) if(i.qty>0) unplaced[i.p.uid]=(unplaced[i.p.uid]||0)+i.qty;
 return {state:{spaces,boxes,weight,seq,gap:G},unplaced};
}

function mulberry32(seed:number){
 return ()=>{seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296;};
}

// Xếp thêm hàng vào container hiện tại (các thùng đã xếp giữ nguyên vị trí).
// Chọn phương án: dùng đủ chiều bắt buộc → xếp được nhiều thể tích nhất → gọn nhất (ít lấn ra cửa).
// budgetMs > 0: sau các chiến lược cố định, chạy thêm vòng ngẫu nhiên cho tới khi hết thời gian.
export function packInto(state:PackState,items:PackItem[],c:Container,budgetMs=0,opts:PackOptions={}):PackResult{
 const valid=items.filter(i=>isValid(i.p)&&i.qty>0);
 let best:PackResult|null=null,bestMiss=Infinity,bestVol=-1,bestLen=Infinity;
 const consider=(st:Strategy)=>{
  const r=packWith(state,valid,c,st,opts);
  const miss=Object.values(missingOf(r.state,valid)).reduce((n,m)=>n+m.length,0);
  const vol=r.state.boxes.slice(state.boxes.length).reduce((s,b)=>s+b.w*b.d*b.h,0);
  const len=r.state.boxes.reduce((m,b)=>Math.max(m,b.z+b.d/2),0);
  if(miss<bestMiss||(miss===bestMiss&&(vol>bestVol||(vol===bestVol&&len<bestLen)))){best=r;bestMiss=miss;bestVol=vol;bestLen=len;}
 };
 const t0=performance.now(), anyTip=valid.some(i=>i.p.canTip), anyReq=valid.some(i=>requiredHeights(i.p).length>0);
 // Các tổ hợp chiến lược cố định (bỏ bớt tổ hợp trùng vai trò để mức "Nhanh" vẫn nhanh)
 const VARIANTS:{combo:ComboMode;look:boolean}[]=[{combo:'simple',look:false},{combo:'simple',look:true},{combo:'mix',look:true},{combo:'mixDeep',look:true}];
 for(const base of STRATEGIES) for(const v of VARIANTS){
  const st={...base,...v}; consider(st);
  if(anyTip&&!v.look) consider({...st,noTip:true});
  if(anyReq&&v.combo==='mix') consider({...st,force:'always'});
 }
 for(let seed=1;performance.now()-t0<budgetMs;seed++){
  const rng=mulberry32(seed);
  consider({score:SCORE_NAMES[Math.floor(rng()*SCORE_NAMES.length)],depths:['deep','thin'],noTip:anyTip&&seed%2===0,combo:(['simple','simple','mix','mixDeep'] as const)[seed%4],look:rng()<0.5,force:anyReq&&seed%2===1?'random':undefined,rng});
 }
 const r:PackResult=best??{state,unplaced:{}};
 return {...r,missing:missingOf(r.state,valid)};
}

// "Ói đều": khi hàng nhiều hơn sức chứa, phần không vào được chia đều theo tỷ lệ cho mọi mã
// (thay vì ưu tiên mã thùng to và bỏ hẳn mã khác).
// 1. Tìm nhị phân tỷ lệ r lớn nhất để mọi mã đều xếp đủ r × số lượng.
// 2. Bù thêm vào chỗ trống còn lại, mỗi lần ~1% cho mã đang có tỷ lệ vào cont thấp nhất.
export function packEven(state:PackState,items:PackItem[],c:Container,budgetMs=0,opts:PackOptions={}):PackResult{
 const valid=items.filter(i=>isValid(i.p)&&i.qty>0);
 const full=packInto(state,valid,c,budgetMs/4,opts);
 if(!Object.keys(full.unplaced).length) return full;
 const scaled=(r:number)=>valid.map(i=>({p:i.p,qty:Math.floor(i.qty*r)})).filter(i=>i.qty>0);
 let lo=0,hi=1,base:PackState=state;
 for(let k=0;k<9;k++){
  const mid=(lo+hi)/2, r=packInto(state,scaled(mid),c,budgetMs/12,opts);
  if(Object.keys(r.unplaced).length) hi=mid; else {lo=mid;base=r.state;}
 }
 const loaded:Record<string,number>={};
 for(const b of base.boxes.slice(state.boxes.length)) loaded[b.productId]=(loaded[b.productId]||0)+1;
 let active=valid.filter(i=>(loaded[i.p.uid]||0)<i.qty);
 while(active.length){
  const it=active.reduce((a,b)=>(loaded[a.p.uid]||0)/a.qty<=(loaded[b.p.uid]||0)/b.qty?a:b);
  const want=Math.min(Math.max(1,Math.ceil(it.qty*0.01)),it.qty-(loaded[it.p.uid]||0));
  const r=packInto(base,[{p:it.p,qty:want}],c,0,opts);
  const placed=want-(r.unplaced[it.p.uid]||0);
  if(placed>0){base=r.state; loaded[it.p.uid]=(loaded[it.p.uid]||0)+placed;}
  if(placed===0||(loaded[it.p.uid]||0)>=it.qty) active=active.filter(a=>a!==it);
 }
 const unplaced:Record<string,number>={};
 for(const i of valid){const left=i.qty-(loaded[i.p.uid]||0); if(left>0) unplaced[i.p.uid]=(unplaced[i.p.uid]||0)+left;}
 return {state:base,unplaced,missing:missingOf(base,valid)};
}

// Gỡ toàn bộ thùng của một mã. Bỏ luôn các chỗ trống đang tựa trên mặt những thùng đó để không xếp thùng lơ lửng.
export function removeProduct(state:PackState,uid:string):PackState{
 const removed=state.boxes.filter(b=>b.productId===uid);
 const g=normGap(state.gap);
 const tops=removed.map(b=>({x:b.x-b.w/2,y:b.y+b.h/2+g.y,z:b.z-b.d/2,w:b.w+g.x,h:1,d:b.d+g.z}));
 return {
  ...state,
  boxes:state.boxes.filter(b=>b.productId!==uid),
  weight:state.weight-removed.reduce((s,b)=>s+b.weight,0),
  spaces:state.spaces.filter(s=>!tops.some(t=>s.y===t.y&&overlaps({...s,h:1},t))),
 };
}
