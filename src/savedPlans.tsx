import React, { useEffect, useRef, useState } from 'react';
import { Gap, PackState, Product } from './packing';

// Một cont đã lưu: đủ thông tin để mở lại đúng cách sắp xếp lúc lưu
export type SavedPlan={
 id:string;name:string;savedAt:number;
 container:string;gap:Gap;
 products:Product[]; // không kèm ảnh để bản lưu nhẹ; khi mở lại lấy ảnh từ sản phẩm cùng mã đang có
 plan:PackState;unplaced:Record<string,number>;
 strict:boolean;even:boolean;
 summary:{cartons:number;weight:number;cbm:number;util:number};
};

const KEY='loadcont.plans.v1';

export function loadPlans():SavedPlan[]{
 try{const v=JSON.parse(localStorage.getItem(KEY)||'[]'); return Array.isArray(v)?v:[];}catch{return [];}
}
// Trả về thông báo lỗi nếu bộ nhớ trình duyệt đầy
export function storePlans(list:SavedPlan[]):string|null{
 try{localStorage.setItem(KEY,JSON.stringify(list)); return null;}
 catch{return 'Bộ nhớ trình duyệt đã đầy. Hãy xuất file các cont cũ rồi xoá bớt trước khi lưu thêm.';}
}

const fmtDate=(t:number)=>new Date(t).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const safeFileName=(s:string)=>s.replace(/[\\/:*?"<>|]+/g,'-').trim()||'cont';

function download(name:string,data:unknown){
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
 const a=document.createElement('a'); a.href=url; a.download=`${safeFileName(name)}.json`; a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// Đọc file đã xuất: 1 cont hoặc danh sách cont
function parseImport(text:string):SavedPlan[]{
 const raw=JSON.parse(text); const list=(Array.isArray(raw)?raw:[raw]) as SavedPlan[];
 const ok=list.filter(x=>x&&typeof x.name==='string'&&x.plan&&Array.isArray(x.plan.boxes)&&Array.isArray(x.products));
 if(!ok.length) throw new Error('File không đúng định dạng cont đã lưu');
 return ok;
}

export function PlansDialog({plans,openId,defaultName,empty,onNew,onSaveNew,onOverwrite,onOpen,onRename,onDelete,onImport,onClose}:{
 plans:SavedPlan[];openId:string|null;defaultName:string;empty:boolean;onNew:()=>void;
 onSaveNew:(name:string)=>void;onOverwrite:(id:string,name:string)=>void;onOpen:(p:SavedPlan)=>void;
 onRename:(id:string,name:string)=>void;onDelete:(id:string)=>void;onImport:(list:SavedPlan[])=>void;onClose:()=>void;
}){
 const current=plans.find(p=>p.id===openId);
 const [name,setName]=useState(current?.name??defaultName);
 const nameRef=useRef<HTMLInputElement>(null), fileRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{nameRef.current?.select();},[]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape') onClose();}; window.addEventListener('keydown',onKey); return ()=>window.removeEventListener('keydown',onKey);},[onClose]);
 const trimmed=name.trim();
 const importFile=async(f:File)=>{try{onImport(parseImport(await f.text()));}catch(e){alert((e as Error).message);}};

 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget) onClose();}}>
  <div className="modal" role="dialog" aria-modal="true" aria-labelledby="plans-title">
   <div className="modal-head"><h2 id="plans-title">LƯU / MỞ CONT</h2>
    <div className="head-actions">
     <button className="secondary" onClick={onNew} title="Bắt đầu cont mới trống, không gắn với cont đã lưu nào">+ Tạo cont mới</button>
     <button className="icon" onClick={onClose} title="Đóng">✕</button>
    </div>
   </div>

   <section className="save-box">
    <label htmlFor="plan-name">Tên cont</label>
    <input id="plan-name" ref={nameRef} value={name} onChange={e=>setName(e.target.value)} placeholder="VD: PO 2451 – Cont 1"
     onKeyDown={e=>{if(e.key==='Enter'&&trimmed) (current?onOverwrite(current.id,trimmed):onSaveNew(trimmed));}}/>
    {empty&&<small className="note">ⓘ Cont đang trống — vẫn lưu được danh sách sản phẩm và cài đặt.</small>}
    <div className="save-actions">
     {current&&<button onClick={()=>onOverwrite(current.id,trimmed)} disabled={!trimmed} title="Cập nhật bản lưu đang mở bằng cách xếp hiện tại">Ghi đè “{current.name}”</button>}
     <button className={current?'secondary':''} onClick={()=>onSaveNew(trimmed)} disabled={!trimmed}>{current?'Lưu thành cont mới':'Lưu cont'}</button>
    </div>
   </section>

   <div className="list-head">
    <h3>Cont đã lưu ({plans.length})</h3>
    <button className="link" onClick={()=>fileRef.current?.click()}>Nhập file…</button>
    <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0]; if(f) importFile(f); e.target.value='';}}/>
   </div>
   {!plans.length&&<p className="muted">Chưa có cont nào được lưu.</p>}
   <ul className="plan-list">
    {plans.map(p=><li key={p.id} className={p.id===openId?'open':''}>
     <div className="plan-main">
      <b>{p.name}</b>{p.id===openId&&<span className="tag">Đang mở</span>}
      <small>{p.container} · {p.summary.cartons} thùng · {p.summary.cbm.toFixed(2)} CBM · {p.summary.util.toFixed(1)}% · {p.summary.weight.toLocaleString()} kg</small>
      <small className="muted">Lưu lúc {fmtDate(p.savedAt)} · {p.products.length} mã hàng</small>
     </div>
     <div className="plan-actions">
      <button onClick={()=>onOpen(p)}>Mở</button>
      <button className="link" onClick={()=>{const n=prompt('Tên mới cho cont',p.name)?.trim(); if(n) onRename(p.id,n);}}>Đổi tên</button>
      <button className="link" onClick={()=>download(p.name,p)} title="Tải về file .json để mở ở máy khác">Xuất file</button>
      <button className="link danger" onClick={()=>{if(confirm(`Xoá cont “${p.name}”? Không khôi phục được.`)) onDelete(p.id);}}>Xoá</button>
     </div>
    </li>)}
   </ul>
   <small className="muted">Cont được lưu trong trình duyệt của máy này. Dùng “Xuất file” / “Nhập file” để chuyển sang máy khác.</small>
  </div>
 </div>
}
