/* Air Ledger – signed PDF service reports.
   After a job is completed the engineer (and customer, if present) sign on screen, and the app
   builds a branded PDF with the company and client details, every check, reading, photo and the
   signatures. The PDF is stored with the job, given a reference and a fingerprint of the record,
   and can be emailed or shared to the client and the office.
   Uses globals from index.html (S, job, system, client, unitsOf, set, sysInfo, put, assets, sb, Biz…). */
window.ServiceReport = (() => {
  const JSPDF = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
  const NAVY = [15,34,56], AIR = [63,193,217], SLATE = [91,108,127], LINE = [225,232,239], MIST = [244,247,250];
  const LS = {get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
  const LINK_DAYS = 365;

  let libP = null;
  function loadLib(){
    if(window.jspdf) return Promise.resolve();
    return libP = libP || new Promise((res,rej)=>{const s=document.createElement("script");s.src=JSPDF;s.onload=res;s.onerror=()=>{libP=null;rej(new Error("Couldn't load the PDF builder – check your connection"))};document.head.appendChild(s)});
  }

  /* ---------- helpers ---------- */
  // Standard PDF fonts only cover Latin-1, so swap the few other characters the app uses.
  const T = v => String(v ?? "").replace(/[–—]/g,"-").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/₂/g,"2").replace(/…/g,"...").replace(/[^\x00-\xFF]/g,"");
  const stamp = d => new Date(d).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const slug = s => String(s||"client").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase();
  function newRef(j){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";const b=new Uint32Array(4);crypto.getRandomValues(b);return (isInstall(j)?"CR-":"SR-")+todayISO().slice(2).replace(/-/g,"")+"-"+Array.from(b,x=>a[x%a.length]).join("")}
  function stable(v){return Array.isArray(v)?"["+v.map(stable).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}":JSON.stringify(v)}
  async function sha256(str){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));return Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,"0")).join("")}
  // Everything the report states. If any of it changes after the report is issued, the job page says so.
  function snapshot(j){
    const s=system(j.systemId)||{}, c=client(s.clientId)||{};
    const pick=(o,ks)=>Object.fromEntries(ks.map(k=>[k,o[k]??""]));
    const {serviceReports,invoiceId,...rec}=j;
    return {job:rec,
      system:pick(s,["name","siteAddress","sitePostcode","refrigerant","factoryChargeKg","addedChargeKg"]),
      client:pick(c,["name","contactName","phone","email","billingAddress","postcode"]),
      units:unitsOf(s.id).map(u=>pick(u,["id","role","indoorType","manufacturer","model","serial","location"])),
      reports:jobReports(j.id).map(r=>pick(r,["kind","date","author","text","photos","unitId"]))};
  }
  const fingerprint = j => sha256(stable(snapshot(j)));
  const jobReports = id => S.reports.filter(r=>r.jobId===id).sort((a,b)=>(a.createdAt||"").localeCompare(b.createdAt||""));
  const latest = j => (j.serviceReports||[]).slice(-1)[0];

  async function fileBlob(id){
    if(sb){const {data,error}=await sb.storage.from("photos").download(id);if(error)throw error;return data}
    const r=await fetch(photoCache[id]);return await r.blob();
  }
  async function toJpeg(src,max=1200){
    const bmp=await createImageBitmap(src); const sc=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const cv=document.createElement("canvas");cv.width=Math.round(bmp.width*sc);cv.height=Math.round(bmp.height*sc);
    const g=cv.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);g.drawImage(bmp,0,0,cv.width,cv.height);
    return {data:cv.toDataURL("image/jpeg",0.78),w:cv.width,h:cv.height};
  }
  // Logos can be SVG, so draw them through an <img> rather than createImageBitmap.
  // Fetched as a blob first: the logo is often already cached from the settings page without CORS, which would block drawing it.
  async function logoPng(url){
    if(!url) return null;
    let src=url; try{const r=await fetch(url,{cache:"no-store"});if(r.ok)src=URL.createObjectURL(await r.blob())}catch(e){}
    return new Promise(res=>{const im=new Image();if(src===url)im.crossOrigin="anonymous";
      im.onload=()=>{try{const w=im.naturalWidth||600,h=im.naturalHeight||200,sc=Math.min(1,800/Math.max(w,h));const cv=document.createElement("canvas");cv.width=Math.round(w*sc);cv.height=Math.round(h*sc);const g=cv.getContext("2d");g.drawImage(im,0,0,cv.width,cv.height);res(trim(cv,g))}catch(e){res(null)}};
      im.onerror=()=>res(null);im.src=src});
  }
  // Crop the empty margin many logo files have, so the logo lines up with the text under it.
  function trim(cv,g){
    const d=g.getImageData(0,0,cv.width,cv.height).data; let x0=cv.width,y0=cv.height,x1=-1,y1=-1;
    for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){const i=(y*cv.width+x)*4;if(d[i+3]>16&&(d[i]<235||d[i+1]<235||d[i+2]<235)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}
    if(x1<0) return {data:cv.toDataURL("image/png"),w:cv.width,h:cv.height};
    const o=document.createElement("canvas");o.width=x1-x0+1;o.height=y1-y0+1;o.getContext("2d").drawImage(cv,x0,y0,o.width,o.height,0,0,o.width,o.height);
    return {data:o.toDataURL("image/png"),w:o.width,h:o.height};
  }
  async function sigImage(sig){
    if(!sig) return null;
    if(sig.data) return {data:sig.data,w:sig.w,h:sig.h};
    try{const bmp=await createImageBitmap(await fileBlob(sig));const cv=document.createElement("canvas");cv.width=bmp.width;cv.height=bmp.height;cv.getContext("2d").drawImage(bmp,0,0);return {data:cv.toDataURL("image/png"),w:bmp.width,h:bmp.height}}catch(e){return null}
  }

  /* ---------- the PDF ---------- */
  async function buildPdf(j,meta){
    await loadLib();
    const {jsPDF}=window.jspdf;
    const st=set(), s=system(j.systemId)||{}, c=client(s.clientId)||{}, us=unitsOf(s.id), info=sysInfo(s), inst=isInstall(j);
    const org=Biz.org||{}, bizName=org.name||st.businessName, lc=j.leakCheck||{}, cm=j.commissioning||{}, reps=jobReports(j.id);
    const title=inst?"Installation & Commissioning Report":"Service Report";
    const doc=new jsPDF({unit:"mm",format:"a4",compress:true});
    const PW=210, PH=297, M=15, W=PW-2*M, BOTTOM=PH-22;
    let y=M;
    const font=(size,style="normal",col=NAVY)=>{doc.setFont("helvetica",style);doc.setFontSize(size);doc.setTextColor(...col)};
    const lh=size=>size*0.42;
    const newPage=()=>{doc.addPage();y=M;font(8,"normal",SLATE);doc.text(T(`${bizName} · ${title} · ${meta.ref}`),M,y);y+=6};
    const ensure=h=>{if(y+h>BOTTOM)newPage()};
    const wrap=(t,w)=>doc.splitTextToSize(T(t),w);

    function heading(t,keep=16){
      ensure(keep); y+=4;
      doc.setFillColor(...AIR);doc.rect(M,y-3.6,1.4,5,"F");
      font(11.5,"bold");doc.text(T(t),M+4,y);y+=4;
    }
    function para(t,size=9.5,style="normal",col=NAVY){
      font(size,style,col);
      for(const l of wrap(t,W)){ensure(lh(size)+1);doc.text(l,M,y+lh(size));y+=lh(size)+0.9}
      y+=1.5;
    }
    // Two-column label/value table; rows with an empty value are skipped.
    function kv(rows,labelW=52){
      font(9);
      for(const [k,v,warn] of rows){
        if(v===""||v==null) continue;
        const kl=wrap(k,labelW-4), vl=wrap(v,W-labelW-4), h=Math.max(kl.length,vl.length)*lh(9)*1.2+2.8;
        ensure(h);
        doc.setDrawColor(...LINE);doc.setFillColor(...MIST);doc.rect(M,y,labelW,h,"FD");doc.rect(M+labelW,y,W-labelW,h,"D");
        font(9,"bold",SLATE);doc.text(kl,M+2,y+3+lh(9)*0.6,{lineHeightFactor:1.2});
        font(9,warn?"bold":"normal",warn?[200,64,47]:NAVY);doc.text(vl,M+labelW+2,y+3+lh(9)*0.6,{lineHeightFactor:1.2});
        y+=h;
      }
      y+=2;
    }
    // Checklist as a two-column grid with a tick box drawn per item.
    function checks(items){
      const cw=W/2, rh=6.2;
      for(let i=0;i<items.length;i+=2){
        ensure(rh);
        items.slice(i,i+2).forEach(([label,done],k)=>{
          const x=M+k*cw; doc.setDrawColor(...LINE); doc.rect(x,y,cw,rh,"D");
          const bx=x+2.2, by=y+1.6; doc.setDrawColor(...(done?[30,138,90]:[200,64,47])); doc.setLineWidth(0.35); doc.rect(bx,by,3,3,"D");
          if(done){doc.line(bx+0.6,by+1.6,bx+1.3,by+2.4);doc.line(bx+1.3,by+2.4,bx+2.5,by+0.6)}else{doc.line(bx+0.6,by+0.6,bx+2.4,by+2.4);doc.line(bx+2.4,by+0.6,bx+0.6,by+2.4)}
          doc.setLineWidth(0.2);
          font(8.5,done?"normal":"bold",done?NAVY:[200,64,47]); doc.text(T(label+(done?"":" - not completed")),bx+5,y+4.2);
        });
        y+=rh;
      }
      y+=1.5;
    }
    function table(head,rows,widths){
      const drawHead=()=>{ensure(8);doc.setFillColor(...NAVY);doc.rect(M,y,W,7,"F");font(8.5,"bold",[255,255,255]);let x=M;head.forEach((h,i)=>{doc.text(T(h),x+2,y+4.8);x+=widths[i]});y+=7};
      drawHead();
      for(const r of rows){
        font(8.5); const cells=r.map((v,i)=>wrap(v||"-",widths[i]-4)); const h=Math.max(...cells.map(x=>x.length))*lh(8.5)*1.2+3.4;
        if(y+h>BOTTOM){newPage();drawHead()}
        let x=M; doc.setDrawColor(...LINE);
        cells.forEach((cl,i)=>{doc.rect(x,y,widths[i],h,"D");font(8.5);doc.text(cl,x+2,y+3.2+lh(8.5)*0.6,{lineHeightFactor:1.2});x+=widths[i]});
        y+=h;
      }
      y+=3;
    }

    /* header: company block (logo, name, address, contacts) and report title/ref */
    const logo=await logoPng(org.logo_url);
    let ly=M;
    if(logo){const h=Math.min(24,70*logo.h/logo.w), w=h*logo.w/logo.h;doc.addImage(logo.data,"PNG",M,ly,w,h);ly+=h+3}
    font(logo?12:16,"bold");doc.text(T(bizName),M,ly+(logo?3:5));ly+=logo?5:8;
    font(8.5,"normal",SLATE);
    const coLines=[st.tradingAs?"Part of "+st.tradingAs:"",...String(st.address||"").split(/\n/).map(x=>x.trim()).filter(Boolean),[st.phone,st.email].filter(Boolean).join("  ·  "),st.website,st.fgasCert?"F-gas company certificate: "+st.fgasCert:""].filter(Boolean);
    for(const l of coLines){doc.text(T(l),M,ly+1.5);ly+=3.8}
    const rx=PW-M; font(16,"bold");doc.text(T(title),rx,M+6,{align:"right"});
    font(9,"normal",SLATE);
    [["Report ref",meta.ref+(meta.rev>1?" (rev "+meta.rev+")":"")],["Visit date",fmtDate(j.date)],["Issued",stamp(meta.issuedAt)]].forEach(([k,v],i)=>{font(9,"normal",SLATE);doc.text(T(k+": "),rx-doc.getTextWidth(T(v))-0.5,M+13+i*4.6,{align:"right"});font(9,"bold");doc.text(T(v),rx,M+13+i*4.6,{align:"right"})});
    y=Math.max(ly,M+26)+2;
    doc.setFillColor(...NAVY);doc.rect(M,y,W,1.2,"F");doc.setFillColor(...AIR);doc.rect(M,y+1.2,W,0.6,"F");y+=7;

    /* client and site side by side */
    const half=(W-6)/2;
    const box=(x,head,lines)=>{let yy=y;font(8,"bold",SLATE);doc.text(head.toUpperCase(),x,yy);yy+=4.5;
      lines.filter(Boolean).forEach((l,i)=>{font(i?9:10,i?"normal":"bold");for(const w of wrap(l,half)){doc.text(w,x,yy);yy+=4.2}});return yy};
    const cAddr=[...String(c.billingAddress||"").split(/\n/),c.postcode].map(x=>(x||"").trim()).filter(Boolean).join(", ");
    const sAddr=[...String(s.siteAddress||"").split(/\n/),s.sitePostcode].map(x=>(x||"").trim()).filter(Boolean).join(", ");
    const y1=box(M,"Client",[c.name,c.contactName&&c.contactName!==c.name?"Contact: "+c.contactName:"",cAddr,c.phone?"Tel: "+c.phone:"",c.email?"Email: "+c.email:""]);
    const y2=box(M+half+6,"Site",[s.name||"Site",sAddr,s.accessNotes?"Access: "+s.accessNotes.replace(/\n/g,", "):""]);
    y=Math.max(y1,y2)+3;

    heading("Visit");
    kv([["Job type",j.type],["Date completed",fmtDate(j.date)],["Time on site",j.durationHrs?j.durationHrs+" hours":""],["Engineer",meta.signoff.engineerName||j.engineer],["Engineer F-gas cert no.",meta.signoff.engineerCert],["Units attended",us.length?unitsSummary(s.id):""]]);

    heading("Work completed");
    const nIn=us.filter(u=>u.role==="indoor").length, nOut=us.length-nIn;
    para(inst?`Installation and commissioning of ${s.refrigerant||""} air conditioning system "${s.name||""}" (${unitsSummary(s.id)}) was completed on ${fmtDate(j.date)}. Pressure, vacuum and operational checks are recorded below.`
      :`${j.type} carried out on ${fmtDate(j.date)} on ${nOut?nOut+" outdoor":""}${nOut&&nIn?" and ":""}${nIn?nIn+" indoor":""} unit${us.length===1?"":"s"}. The checks completed on each unit, readings taken and any defects found are recorded below.`);
    if(j.completionNotes){font(9,"bold",SLATE);ensure(6);doc.text("Engineer's notes",M,y+3);y+=5;para(j.completionNotes)}

    if(us.length){
      heading("Equipment");
      table(["Asset ID","Type","Make / model","Serial no.","Location"],us.map(u=>[u.id,unitLabel(u),[u.manufacturer,u.model].filter(Boolean).join(" ")+(u.capacityKw?" ("+u.capacityKw+" kW)":""),u.serial,u.location]),[24,30,52,36,38]);

      heading(inst?"Installation checks by unit":"Service checks by unit");
      const CK=inst?CHECKS_INSTALL:CHECKS;
      for(const u of us){
        const ck=(j.unitChecks||{})[u.id]||{};
        ensure(14);font(9.5,"bold");doc.text(T(`${u.id}  ·  ${unitLabel(u)}${u.location?"  ·  "+u.location:""}`),M,y+3.5);y+=6;
        checks(Object.entries(CK).filter(([k])=>u.role==="indoor"||!["filters","drain","handoverU"].includes(k)).map(([k,l])=>[l,!!ck[k]]));
        kv([["Off-coil temperature",ck.offCoil?ck.offCoil+" °C":""],["On-coil / return temperature",ck.onCoil?ck.onCoil+" °C":""],["Running current",ck.amps?ck.amps+" A":""],["Suction pressure",ck.pressure?ck.pressure+" bar":""],["Notes / defects",ck.notes||""]],70);
      }
    }

    heading("Refrigerant (F-gas)");
    kv([["Refrigerant",s.refrigerant?s.refrigerant+" (GWP "+info.f.gwp+")":""],["Total system charge",num(info.f.kg,3)+" kg"],["CO2 equivalent",num(info.f.t,2)+" tonnes"],["Leak check frequency",info.f.required?"Required every "+info.f.months+" months":"Not mandatory (below threshold)"]]);
    if(inst) kv([["Nitrogen pressure test",cm.pressureBar?cm.pressureBar+" bar for "+(cm.pressureMins||"-")+" min - "+(cm.pressureHeld===false?"FAILED":"held"):"",cm.pressureHeld===false],["Vacuum achieved",cm.vacuumMicrons?cm.vacuumMicrons+" microns"+(cm.decayHeld?" - decay test held":""):""],["Pipe run",cm.pipeM?cm.pipeM+" m":""],["Additional refrigerant charged",cm.addedKg!==""&&cm.addedKg!=null?num(cm.addedKg,3)+" kg":""],["Handover",cm.handover?"Controls demonstrated, manuals and warranty information left with the customer":""]]);
    else kv([["Leak check carried out",lc.performed?"Yes - "+(lc.method||""):"No"],["Leak check result",lc.performed?(lc.result==="fail"?"LEAK FOUND":"No leaks found"):"",lc.result==="fail"],["Refrigerant added",lc.addedKg?num(lc.addedKg,3)+" kg":""],["Refrigerant recovered",lc.recoveredKg?num(lc.recoveredKg,3)+" kg":""],["Leak check notes",lc.notes]]);

    const mats=(j.materialsUsed||[]).filter(m=>m.qty);
    if(mats.length){heading("Parts & materials used");table(["Item","Qty"],mats.map(m=>[m.name,String(m.qty)]),[W-25,25])}

    const notes=reps.filter(r=>r.text&&r.text!==j.completionNotes);
    if(notes.length){heading("Engineer reports");for(const r of notes){font(9,"bold",SLATE);ensure(6);doc.text(T(`${r.kind} - ${fmtDate(r.date)}${r.author?" - "+r.author:""}${r.unitId?" - "+r.unitId:""}`),M,y+3);y+=5;para(r.text)}}

    const photos=[]; for(const r of reps)for(const p of (r.photos||[]))photos.push({id:p,cap:`${r.kind} · ${fmtDate(r.date)}${r.unitId?" · "+r.unitId:""}`});
    if(photos.length){
      heading("Photos",90);
      const pw=(W-6)/2, maxH=72; let col=0, rowH=0;
      for(let i=0;i<photos.length;i++){
        let im=null; try{im=await toJpeg(await fileBlob(photos[i].id))}catch(e){}
        if(!im) continue;
        let w=pw, h=w*im.h/im.w; if(h>maxH){h=maxH;w=h*im.w/im.h}
        if(col===0) ensure(maxH+8);
        const x=M+col*(pw+6)+(pw-w)/2;
        doc.addImage(im.data,"JPEG",x,y,w,h); font(7.5,"normal",SLATE); doc.text(T(`Photo ${i+1} · ${photos[i].cap}`),M+col*(pw+6),y+h+3.6);
        rowH=Math.max(rowH,h+7);
        if(col===1){y+=rowH;rowH=0;col=0}else col=1;
      }
      if(col===1) y+=rowH;
      y+=2;
    }

    heading(inst?"First service":"Next service");
    para(`${inst?"First service":"Next service"} due ${fmtDate(addMonths(j.date,info.interval))}. Servicing at the interval recommended by the manufacturer is normally a condition of the manufacturer's warranty; please keep this report as your record of the work.`);

    /* sign-off */
    heading("Sign-off",62);
    para(`I confirm the work recorded in this report was carried out on ${fmtDate(j.date)}.`,9);
    ensure(48);
    const sigBox=async(x,head,name,sig,note)=>{
      doc.setDrawColor(...LINE);doc.rect(x,y,half,38,"D");font(8,"bold",SLATE);doc.text(head.toUpperCase(),x+3,y+5);
      const im=await sigImage(sig);
      if(im){let h=20,w=h*im.w/im.h;if(w>half-8){w=half-8;h=w*im.h/im.w}doc.addImage(im.data,"PNG",x+3,y+7,w,h)}
      else{font(9,"italic",SLATE);doc.text(T(note||"Not signed"),x+3,y+18)}
      doc.setDrawColor(...SLATE);doc.line(x+3,y+29,x+half-3,y+29);
      font(9,"bold");doc.text(T(name||"-"),x+3,y+33.5);font(7.5,"normal",SLATE);doc.text(T("Signed "+stamp(meta.signoff.signedAt)),x+3,y+36.8);
    };
    await sigBox(M,"Engineer",meta.signoff.engineerName,meta.signoff.engineerSig);
    await sigBox(M+half+6,"Customer",meta.signoff.customerName,meta.signoff.customerAbsent?null:meta.signoff.customerSig,meta.signoff.customerAbsent?"Customer not available to sign"+(meta.signoff.absentNote?": "+meta.signoff.absentNote:""):"");
    y+=42;

    /* footer on every page */
    const n=doc.getNumberOfPages();
    const legal=[bizName+(st.tradingAs?" - part of "+st.tradingAs:""),st.companyNo?"Company no. "+st.companyNo:"",st.vatNo?"VAT no. "+st.vatNo:""].filter(Boolean).join("  ·  ");
    for(let i=1;i<=n;i++){
      doc.setPage(i); doc.setDrawColor(...LINE); doc.line(M,PH-15,PW-M,PH-15);
      font(7.5,"normal",SLATE); doc.text(T(legal),M,PH-11); doc.text(T(`Ref ${meta.ref} · Page ${i} of ${n}`),PW-M,PH-11,{align:"right"});
      font(6.5,"normal",SLATE); doc.text(T(`Record fingerprint ${meta.hash.slice(0,24)} · Original held by ${bizName}; quote the reference to verify.`),M,PH-7.5);
      doc.setTextColor(...AIR); doc.textWithLink("Produced with Air Ledger · airledger.co.uk",PW-M-doc.getTextWidth("Produced with Air Ledger · airledger.co.uk"),PH-7.5,{url:"https://airledger.co.uk"});
    }
    doc.setProperties({title:`${title} ${meta.ref}`,subject:`${c.name||""} - ${s.name||""}`,author:bizName,creator:"Air Ledger"});
    return doc.output("blob");
  }

  /* ---------- signature pad ---------- */
  function pad(cv){
    const g=cv.getContext("2d"); let drawing=false, last=null; const p={dirty:false,empty:true};
    const size=()=>{const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);g.scale(d,d);g.lineWidth=2.2;g.lineCap=g.lineJoin="round";g.strokeStyle="#0F2238"};
    size();
    const pt=e=>{const r=cv.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
    cv.onpointerdown=e=>{e.preventDefault();cv.setPointerCapture(e.pointerId);drawing=true;last=pt(e);g.beginPath();g.arc(last[0],last[1],1.1,0,7);g.fillStyle="#0F2238";g.fill();p.dirty=true;p.empty=false};
    cv.onpointermove=e=>{if(!drawing)return;e.preventDefault();const q=pt(e);g.beginPath();g.moveTo(...last);g.lineTo(...q);g.stroke();last=q};
    cv.onpointerup=cv.onpointercancel=()=>{drawing=false};
    p.clear=()=>{g.save();g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,cv.width,cv.height);g.restore();p.dirty=true;p.empty=true};
    p.show=async id=>{const im=await sigImage(id);if(!im)return;const bmp=await createImageBitmap(await (await fetch(im.data)).blob());const r=cv.getBoundingClientRect(),sc=Math.min(r.width/bmp.width,r.height/bmp.height);g.drawImage(bmp,0,0,bmp.width*sc,bmp.height*sc);p.empty=false;p.dirty=false};
    // Trim to the ink so the signature sits neatly in the PDF box.
    p.png=()=>{const d=g.getImageData(0,0,cv.width,cv.height).data;let x0=cv.width,y0=cv.height,x1=0,y1=0;
      for(let yy=0;yy<cv.height;yy++)for(let xx=0;xx<cv.width;xx++)if(d[(yy*cv.width+xx)*4+3]>0){if(xx<x0)x0=xx;if(xx>x1)x1=xx;if(yy<y0)y0=yy;if(yy>y1)y1=yy}
      if(x1<x0)return null; const m=6; x0=Math.max(0,x0-m);y0=Math.max(0,y0-m);x1=Math.min(cv.width-1,x1+m);y1=Math.min(cv.height-1,y1+m);
      const o=document.createElement("canvas");o.width=x1-x0+1;o.height=y1-y0+1;o.getContext("2d").drawImage(cv,x0,y0,o.width,o.height,0,0,o.width,o.height);
      return {data:o.toDataURL("image/png"),w:o.width,h:o.height}};
    return p;
  }
  const PAD_CSS=`<style>.sigpad{width:100%;height:150px;border:1.5px dashed var(--line);border-radius:10px;background:#fff;touch-action:none;display:block}.sighd{display:flex;align-items:center;gap:8px;margin:14px 0 6px;font-weight:600}.sighd .sp{flex:1}</style>`;

  /* ---------- sign off ---------- */
  function signOff(id){
    const j=job(id); if(!j) return;
    const s=system(j.systemId)||{}, c=client(s.clientId)||{}, so=j.signoff||{};
    const custDefault=so.customerName||(j.commissioning&&j.commissioning.customerName)||c.contactName||"";
    openModal("Sign off & send report – "+(c.name||""),`${PAD_CSS}
    <p class="note" style="margin-top:0">This builds a signed PDF report of the ${isInstall(j)?"installation":"service"} with your company details, the client's details, every check, reading and photo, ready to send to the client and your office.</p>
    <div class="fg"><div class="f"><label>Engineer name</label><input type="text" id="soEng" value="${esc(so.engineerName||j.engineer||set().engineer)}"></div>
    <div class="f"><label>Engineer F-gas cert no.</label><input type="text" id="soCert" value="${esc(so.engineerCert||LS.get("al-eng-cert")||"")}" placeholder="Optional"></div></div>
    <div class="sighd">Engineer signature<span class="sp"></span><button type="button" class="btn sm" id="soEngClr">Clear</button></div>
    <canvas class="sigpad" id="soEngPad"></canvas>
    <div class="fg" style="margin-top:14px"><div class="f"><label>Customer name</label><input type="text" id="soCust" value="${esc(custDefault)}"></div>
    <div class="f"><label>Customer email (report sent here)</label><input type="email" id="soMail" inputmode="email" autocomplete="off" value="${esc(so.clientEmail||c.email||"")}" placeholder="name@example.com"></div>
    <div class="f cb"><label><input type="checkbox" id="soAbs" ${so.customerAbsent?"checked":""}> Customer not available to sign</label></div>
    <div class="f full" id="soAbsWrap" style="${so.customerAbsent?"":"display:none"}"><label>Reason (shown on the report)</label><input type="text" id="soAbsNote" value="${esc(so.absentNote||"")}" placeholder="e.g. Key holder access, site unattended"></div></div>
    <div id="soCustWrap" style="${so.customerAbsent?"display:none":""}"><div class="sighd">Customer signature<span class="sp"></span><button type="button" class="btn sm" id="soCustClr">Clear</button></div>
    <canvas class="sigpad" id="soCustPad"></canvas>
    <p class="note">By signing, the customer confirms the work in this report was carried out on ${esc(fmtDate(j.date))}.</p></div>
    <div class="actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="soGo">Create report</button></div>`,md=>{
      const ep=pad($("#soEngPad",md)), cp=pad($("#soCustPad",md));
      if(so.engineerSig) ep.show(so.engineerSig);
      if(so.customerSig) cp.show(so.customerSig);
      $("#soEngClr",md).onclick=ep.clear; $("#soCustClr",md).onclick=cp.clear;
      $("#soAbs",md).onchange=e=>{$("#soCustWrap",md).style.display=e.target.checked?"none":"";$("#soAbsWrap",md).style.display=e.target.checked?"":"none"};
      $("#soGo",md).onclick=async()=>{
        const absent=$("#soAbs",md).checked;
        if(ep.empty){toast("Please sign as the engineer","err");return}
        if(!absent&&cp.empty){toast("Ask the customer to sign, or tick 'not available'","err");return}
        const mail=$("#soMail",md).value.trim();
        if(mail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)){toast("Check the customer's email address","err");return}
        const btn=$("#soGo",md); btn.disabled=true; btn.textContent="Building report…";
        try{
          const save=async(p,old)=>{if(!p.dirty&&old)return old;const im=p.png();if(!im)return "";
            if(!assets)return im; const blob=await (await fetch(im.data)).blob(); return (await assets.upload(blob,{type:"image/png"})).id};
          const cert=$("#soCert",md).value.trim(); LS.set("al-eng-cert",cert);
          const signoff={engineerName:$("#soEng",md).value.trim(),engineerCert:cert,engineerSig:await save(ep,so.engineerSig),
            customerName:$("#soCust",md).value.trim(),clientEmail:mail,customerAbsent:absent,absentNote:absent?$("#soAbsNote",md).value.trim():"",customerSig:absent?"":await save(cp,so.customerSig),
            signedAt:(!ep.dirty&&!cp.dirty&&so.signedAt)||new Date().toISOString()};
          // Keep the email on the client record for next time.
          if(mail&&!c.email&&c.id){const cc=clone(c);cc.email=mail;await put("clients",c.id,cc)}
          await issue(id,signoff);
        }catch(e){toast("Couldn't build the report: "+(e&&(e.message||e.code)||e),"err");btn.disabled=false;btn.textContent="Create report"}
      };
    });
  }

  async function issue(id,signoff){
    const j=clone(job(id)); const prev=latest(j);
    const keep=x=>typeof x==="string"?x:"";            // signatures held only in memory (offline mode) aren't saved to the record
    j.signoff=Object.assign({},signoff,{engineerSig:keep(signoff.engineerSig),customerSig:keep(signoff.customerSig)});
    const meta={ref:prev?prev.ref:newRef(j),rev:prev?prev.rev+1:1,issuedAt:new Date().toISOString(),signoff,hash:await fingerprint(j)};
    const blob=await buildPdf(j,meta);
    let pdf="";
    if(assets){try{pdf=(await assets.upload(blob,{type:"application/pdf"})).id}catch(e){toast("Report built but couldn't be stored: "+(e.message||e),"err")}}
    j.serviceReports=(j.serviceReports||[]).concat([{ref:meta.ref,rev:meta.rev,issuedAt:meta.issuedAt,hash:meta.hash,pdf,sent:[]}]);
    if(!await put("jobs",id,j)) return;
    closeModal(); toast("Report "+meta.ref+" created");
    const d=draft(job(id),latest(job(id)));
    if(autoOn()&&pdf&&(d.to||d.cc)){
      try{await emailNow(id,d);toast("Report "+meta.ref+" emailed to "+[d.to,d.cc].filter(Boolean).join(" and "));return}
      catch(e){toast("Couldn't email the report automatically: "+(e.message||e),"err")}
    }
    send(id,blob);
  }

  /* ---------- delivery ---------- */
  function fileName(j,r){const s=system(j.systemId)||{};return `${r.ref}${r.rev>1?"-rev"+r.rev:""}-${slug((client(s.clientId)||{}).name)}.pdf`}
  async function pdfBlob(r){return await fileBlob(r.pdf)}
  async function download(id){
    const j=job(id), r=latest(j); if(!r) return;
    try{const blob=await pdfBlob(r);const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=fileName(j,r);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
    catch(e){toast("Couldn't fetch the report: "+(e.message||e),"err")}
  }
  async function logSend(id,via,to){
    const j=clone(job(id)), r=latest(j); if(!r) return;
    r.sent=(r.sent||[]).concat([{via,to,at:new Date().toISOString()}]); await put("jobs",id,j);
  }
  // Recipients, subject and message for a report email.
  function draft(j,r){
    const st=set(), s=system(j.systemId)||{}, c=client(s.clientId)||{};
    const what=isInstall(j)?"installation":"service";
    return {to:(j.signoff&&j.signoff.clientEmail)||c.email||"",cc:st.reportEmail||st.email||"",what,
      subject:`${isInstall(j)?"Installation & commissioning":"Service"} report ${r.ref} – ${siteShort(s)}`,
      message:`Hi ${(c.contactName||"").split(" ")[0]||"there"},\n\nPlease find your ${what} report for ${s.name||"your air conditioning"} at ${siteShort(s)}, completed on ${fmtDate(j.date)}. It lists the work carried out on each unit and is signed by our engineer. Please keep it for your records, as it is evidence of servicing for any warranty claim.\n\nReport reference: ${r.ref}\n\nKind regards,\n${(j.signoff&&j.signoff.engineerName)||st.engineer}\n${(Biz.org&&Biz.org.name)||st.businessName}${st.phone?"\n"+st.phone:""}\n\n--\nReport produced with Air Ledger · airledger.co.uk`};
  }
  const autoOn=()=>!!(set().autoEmailReports&&sb);
  // Sends through the send-report Supabase function (Resend), with the PDF attached.
  async function emailNow(id,d){
    const j=job(id), r=latest(j);
    if(!sb||!r||!r.pdf) throw new Error("The report isn't stored online yet");
    const {data,error}=await sb.functions.invoke("send-report",{body:{orgId:Biz.org.id,pdf:r.pdf,filename:fileName(j,r),to:[d.to||d.cc].filter(Boolean),cc:d.to?[d.cc].filter(x=>x&&x!==d.to):[],subject:d.subject,message:d.message,replyTo:set().email}});
    if(error){let m=error.message;try{m=(await error.context.json()).error||m}catch(e){}throw new Error(m)}
    await logSend(id,"auto",[d.to,d.cc].filter(Boolean));
    return data;
  }
  function send(id,blobIn){
    const j=job(id), r=latest(j); if(!j||!r) return;
    const d=draft(j,r), what=d.what, subj=d.subject;
    let blob=blobIn||null;
    const getBlob=async()=>blob||(blob=await pdfBlob(r));
    openModal("Send report "+r.ref,`
    <p class="note" style="margin-top:0">Send the signed PDF to the client as their record of the ${what} and warranty evidence, and copy your office as proof the job was completed.</p>
    <div class="fg"><div class="f"><label>Client email</label><input type="email" id="sdTo" value="${esc(d.to)}" placeholder="client@example.com"></div>
    <div class="f"><label>Reports sent to</label><input type="email" id="sdCc" value="${esc(d.cc)}"><div class="hint">Default set in Settings → Service reports</div></div>
    <div class="f full"><label>Message</label><textarea id="sdMsg" style="min-height:130px">${esc(d.message)}</textarea></div></div>
    <div class="actions" style="flex-wrap:wrap">
      <button class="btn" id="sdDl">Download PDF</button>
      ${navigator.canShare?'<button class="btn" id="sdShare">Share PDF…</button>':""}
      ${autoOn()?'<button class="btn" id="sdMail">Open in Mail</button><button class="btn pri" id="sdSend">Send email now</button>':'<button class="btn pri" id="sdMail">Email client & office</button>'}</div>
    <p class="note" id="sdHint">On a phone, <b>Share PDF</b> attaches the report to a new email. <b>Email</b> opens your mail app with a secure link to the PDF that works for ${LINK_DAYS} days.</p>`,md=>{
      const to=()=>$("#sdTo",md).value.trim(), cc=()=>$("#sdCc",md).value.trim();
      // Fetch the PDF and the link up front: phones only allow sharing straight after a tap.
      let link=""; getBlob().catch(()=>{});
      if(sb&&r.pdf)sb.storage.from("photos").createSignedUrl(r.pdf,LINK_DAYS*86400,{download:fileName(j,r)}).then(({data})=>{link=data&&data.signedUrl||""});
      $("#sdDl",md).onclick=async()=>{const b=await getBlob();const url=URL.createObjectURL(b);const a=document.createElement("a");a.href=url;a.download=fileName(j,r);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)};
      if($("#sdShare",md))$("#sdShare",md).onclick=async()=>{
        try{const f=new File([blob||await getBlob()],fileName(j,r),{type:"application/pdf"});
          if(!navigator.canShare({files:[f]})){toast("This device can't share files – use Email or Download","err");return}
          await navigator.share({files:[f],title:subj,text:$("#sdMsg",md).value});
          await logSend(id,"share",[to(),cc()].filter(Boolean)); closeModal(); toast("Report shared");
        }catch(e){if(e&&e.name!=="AbortError")toast("Couldn't share: "+(e.message||e),"err")}};
      if($("#sdSend",md))$("#sdSend",md).onclick=async e=>{
        if(!to()&&!cc()){toast("Add the client's email","err");return}
        e.target.disabled=true;e.target.textContent="Sending…";
        try{await emailNow(id,{to:to(),cc:cc(),subject:subj,message:$("#sdMsg",md).value});closeModal();toast("Report emailed to "+[to(),cc()].filter(Boolean).join(" and "))}
        catch(err){toast("Couldn't send: "+(err.message||err),"err");e.target.disabled=false;e.target.textContent="Send email now"}};
      $("#sdMail",md).onclick=async()=>{
        if(!to()&&!cc()){toast("Add the client's email or an office email","err");return}
        const body=$("#sdMsg",md).value+(link?`\n\nDownload the report (PDF):\n${link}`:"");
        const href="mailto:"+encodeURIComponent(to()||cc())+"?"+[to()&&cc()?"cc="+encodeURIComponent(cc()):"","subject="+encodeURIComponent(subj),"body="+encodeURIComponent(body)].filter(Boolean).join("&");
        location.href=href; await logSend(id,"email",[to(),cc()].filter(Boolean)); toast("Opened in your mail app");
      };
    });
  }

  /* ---------- job page ---------- */
  function card(j){
    if(j.status!=="completed") return "";
    const list=j.serviceReports||[], r=list.slice(-1)[0];
    if(!r) return `<div class="card" style="border-left:4px solid var(--accent)"><h2>Service report <span class="pill amber">Not sent yet</span></h2>
      <p class="note" style="margin-top:0">Get the engineer and customer to sign, then send the client and your office a branded PDF of exactly what was done.</p>
      <div class="row"><button class="btn pri" onclick="ServiceReport.signOff('${j.id}')">✍️ Sign off & send report</button></div></div>`;
    fingerprint(j).then(h=>{const el=document.getElementById("srChk-"+j.id);if(el&&h!==r.hash)el.innerHTML='<span class="pill amber">Record edited since this report – re-issue it</span>'});
    const sent=(r.sent||[]).slice(-3).reverse();
    const so=j.signoff||{};
    return `<div class="card"><h2>Service report <span class="pill green">${esc(r.ref)}${r.rev>1?" rev "+r.rev:""}</span><span id="srChk-${esc(j.id)}"></span></h2>
      <dl class="kv"><dt>Issued</dt><dd>${esc(new Date(r.issuedAt).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}))}</dd>
      <dt>Signed by</dt><dd>${esc(so.engineerName||"")}${so.customerAbsent?" · customer not available":so.customerName?" and "+esc(so.customerName):""}</dd>
      <dt>Sent</dt><dd>${sent.length?sent.map(x=>`${esc((x.to||[]).join(", ")||"—")} <span class="note">${x.via==="share"?"shared":x.via==="auto"?"emailed":"by email"}, ${esc(new Date(x.at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"}))}</span>`).join("<br>"):"Not yet"}</dd></dl>
      <div class="row" style="margin-top:10px"><button class="btn pri" onclick="ServiceReport.send('${j.id}')">Send report</button>${r.pdf?`<button class="btn" onclick="ServiceReport.download('${j.id}')">📄 Download PDF</button>`:""}<button class="btn" onclick="ServiceReport.signOff('${j.id}')">Re-issue</button></div></div>`;
  }
  function open(id){const j=job(id);if(j&&latest(j))send(id);else signOff(id)}

  return {signOff,send,download,card,open,buildPdf,fingerprint};
})();
