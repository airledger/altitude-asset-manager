/* Air Ledger phone app extras (iPhone + Android via Capacitor).
   On the website this file does nothing: window.AirLedgerNative stays undefined
   and index.html keeps its normal web behaviour. */
(function(){
"use strict";
const cap=window.Capacitor;
if(!cap||!cap.isNativePlatform||!cap.isNativePlatform()||!cap.registerPlugin) return;

const plug=n=>cap.registerPlugin(n);
const Scanner=plug("CapacitorBarcodeScanner"), Notes=plug("LocalNotifications"),
  Files=plug("Filesystem"), Share=plug("Share"), Splash=plug("SplashScreen");

/* ---------- layout: keep the header clear of the notch and home bar ---------- */
const vp=document.querySelector('meta[name=viewport]');
if(vp&&!/viewport-fit/.test(vp.content)) vp.content+=",viewport-fit=cover";
const css=document.createElement("style");
css.textContent="header.top{padding-top:calc(14px + env(safe-area-inset-top))}"+
  "main{padding-bottom:calc(24px + env(safe-area-inset-bottom))}"+
  "#toast{bottom:calc(22px + env(safe-area-inset-bottom))}";
document.head.appendChild(css);

/* ---------- live QR scanning ---------- */
async function scanQR(){
  try{
    const r=await Scanner.scanBarcode({hint:0/* QR_CODE */,scanInstructions:"Point at the Air Ledger sticker",
      scanButton:false,scanText:" ",cameraDirection:1,scanOrientation:3});
    return r&&r.ScanResult||null;
  }catch(e){
    // Closing the scanner is not an error
    if(/cancel/i.test(e&&(e.message||e.code)||"")) return null;
    throw e;
  }
}

/* ---------- exports: share sheet instead of a browser download ---------- */
const downloads={
  async save({filename,data}){
    const safe=String(filename).replace(/[^\w.-]+/g,"-");
    const w=await Files.writeFile({path:safe,data:String(data),directory:"CACHE",encoding:"utf8"});
    try{await Share.share({title:safe,files:[w.uri]})}
    catch(e){if(/cancel/i.test(e&&(e.message||e.code)||""))throw{code:"declined"};throw e}
  }
};

/* ---------- service-due reminders ---------- */
// One 8am notification on each day something comes into its reminder window,
// falls due, or needs a leak check. Rebuilt from the records whenever they change.
const NOTIFY_HOUR=8, MAX_NOTES=40, KEY="al-notify-plan";
function plan(){
  if(typeof S==="undefined"||typeof sysInfo!=="function") return null;
  if(memoryMode||loaded.size<COLS.length+1) return null; // not signed in, or still loading
  const st=set(), lead=Number(st.reminderLeadDays)||30, today=todayISO();
  const now=new Date(), afterHour=now.getHours()>=NOTIFY_HOUR;
  const days={};
  const add=(iso,line)=>{if(!iso)return;if(iso<today||(iso===today&&afterHour))return;(days[iso]=days[iso]||[]).push(line)};
  for(const s of S.systems){
    if(s.inactive) continue;
    const info=sysInfo(s), c=client(s.clientId)||{}, name=(c.name?c.name+" · ":"")+(s.name||siteShort(s));
    if(info.nextDue&&!info.booked){
      add(addDays(info.nextDue,-lead),"Service due "+fmtDate(info.nextDue)+": "+name);
      add(info.nextDue,"Service due today: "+name);
    }
    if(info.nextLeak) add(info.nextLeak,"F-gas leak check due: "+name);
  }
  return Object.keys(days).sort().slice(0,MAX_NOTES).map(iso=>{
    const lines=days[iso], [y,m,d]=iso.split("-").map(Number);
    return {id:Number(iso.replace(/-/g,"")),
      title:lines.length===1?"Air Ledger reminder":lines.length+" Air Ledger reminders",
      body:lines.slice(0,4).join("\n")+(lines.length>4?"\n+"+(lines.length-4)+" more":""),
      schedule:{at:new Date(y,m-1,d,NOTIFY_HOUR,0,0).toISOString(),allowWhileIdle:true},
      extra:{hash:"dashboard"}};
  });
}
let tm=0, asked=false;
function scheduleReminders(){clearTimeout(tm);tm=setTimeout(syncReminders,4000)}
async function syncReminders(){
  try{
    const want=plan(); if(!want) return;
    const sig=JSON.stringify(want);
    let last=null; try{last=localStorage.getItem(KEY)}catch(e){}
    if(sig===last) return;
    let p=await Notes.checkPermissions();
    if(p.display!=="granted"&&want.length&&!asked){asked=true;p=await Notes.requestPermissions()}
    if(p.display!=="granted") return;
    const pending=await Notes.getPending();
    if(pending.notifications.length) await Notes.cancel({notifications:pending.notifications.map(n=>({id:n.id}))});
    if(want.length) await Notes.schedule({notifications:want.map(n=>Object.assign({},n,{schedule:Object.assign({},n.schedule,{at:new Date(n.schedule.at)})}))});
    try{localStorage.setItem(KEY,sig)}catch(e){}
  }catch(e){console.warn("Reminder scheduling failed",e)}
}
Notes.addListener("localNotificationActionPerformed",a=>{
  const h=a&&a.notification&&a.notification.extra&&a.notification.extra.hash;
  if(h) location.hash=h;
});

window.addEventListener("load",()=>{Splash.hide().catch(()=>{})});

window.AirLedgerNative={platform:cap.getPlatform(),scanQR,downloads,afterRender:scheduleReminders};
})();
