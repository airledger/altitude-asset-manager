/* Offline support for Air Ledger: keeps a copy of the last synced records on the
   device and queues changes made without signal, sending them when back online.
   Used by sbDb() in index.html. Stored per signed-in user, cleared on sign out. */
(function(){
"use strict";
const CACHE="al-cache-", OUTBOX="al-outbox-";
const read=k=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):null}catch(e){return null}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}};
let saveT=0;

window.AirLedgerOffline={
  isNetworkError(e){
    const m=String(e&&(e.message||e.details||e)||"");
    return !navigator.onLine||/failed to fetch|load failed|network ?(request|error)|fetch failed|networkerror/i.test(m);
  },
  loadCache(uid){return read(CACHE+uid)},
  saveCache(uid,store){clearTimeout(saveT);saveT=setTimeout(()=>write(CACHE+uid,store),800)},
  outbox(uid){return read(OUTBOX+uid)||[]},
  queue(uid,op){const q=this.outbox(uid);q.push(op);write(OUTBOX+uid,q)},
  // Applies queued changes on top of freshly loaded records so offline edits still show.
  applyOutbox(uid,store){
    for(const op of this.outbox(uid)){const k=op.col+"/"+op.id;if(op.kind==="delete")delete store[k];else store[k]=op.data}
  },
  // Sends queued changes in order. Stops at the first network failure and keeps the rest.
  async flush(sb,uid){
    let q=this.outbox(uid);
    while(q.length){
      const op=q[0];
      const {error}=op.kind==="delete"
        ? await sb.from("docs").delete().eq("col",op.col).eq("id",op.id)
        : await sb.from("docs").upsert({col:op.col,id:op.id,data:op.data});
      if(error&&this.isNetworkError(error)) break;
      if(error) console.warn("Dropped a queued change Supabase rejected",op,error);
      q=q.slice(1); write(OUTBOX+uid,q);
    }
    return q.length;
  },
  clear(){
    try{for(const k of Object.keys(localStorage))if(k.startsWith(CACHE)||k.startsWith(OUTBOX))localStorage.removeItem(k)}catch(e){}
  }
};
})();
