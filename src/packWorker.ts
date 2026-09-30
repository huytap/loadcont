// Chạy thuật toán xếp trong Web Worker để giao diện không bị đơ khi tối ưu lâu
import { Container, PackItem, PackOptions, PackState, packEven, packInto } from './packing';

self.onmessage=(e:MessageEvent<{state:PackState;items:PackItem[];c:Container;budget:number;opts:PackOptions;even?:boolean}>)=>{
 const {state,items,c,budget,opts,even}=e.data;
 (self as unknown as Worker).postMessage((even?packEven:packInto)(state,items,c,budget,opts));
};
