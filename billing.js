/* Air Ledger: prices and billing.
   Prices live in the "pricing" collection, which only business owners can read (supabase-pricing.sql),
   so engineers record what they did and the parts they used without seeing what anything costs.
   An owner's device turns each newly completed job into a draft invoice: routine visits for clients on a
   service plan are covered by the plan, and everything else is priced from the price list.
   Uses helpers from index.html (S, set, put, remove, db, clone, client, system, job, toast, todayISO, addDays,
   saveSettings, invoiceLines, formHTML, readForm, fmtDate). */
"use strict";
const PRICE_FIELDS=[
  {k:"labourFirst",label:"Service – first indoor unit (£)",type:"number"},
  {k:"labourAdditional",label:"Service – each additional indoor unit (£)",type:"number"},
  {k:"leakCheckCharge",label:"Mandatory F-gas leak check (£)",type:"number"},
  {k:"refrigerantPerKg",label:"Refrigerant top-up per kg (£)",type:"number"},
  {k:"calloutCharge",label:"Repair call-out (£)",type:"number"},
  {k:"labourHourly",label:"Labour per hour (£)",type:"number"}
];
const Billing = (()=>{
  const PRICE_KEYS=PRICE_FIELDS.map(f=>f.k), MAT_KEYS=["cost","sell","chargeable"];
  const pr = id=>{const d=S.pricing.find(x=>x.id===id);return d?Object.assign({},d):{}};
  const has = (o,ks)=>ks.some(k=>o&&o[k]!==undefined);
  const without = (o,ks)=>{const c=clone(o);for(const k of ks)delete c[k];return c};
  const owner = ()=>Biz.isOwner;

  /* ---------- reading prices (falls back to the old fields until they've been moved) ---------- */
  function prices(){const st=set(),o={};for(const k of PRICE_KEYS)o[k]=st[k];const p=pr("settings");for(const k of PRICE_KEYS)if(p[k]!==undefined&&p[k]!=="")o[k]=p[k];return o}
  function matPrice(m){m=m||{};const p=pr("mat:"+m.id);return {cost:Number(p.cost??m.cost)||0,sell:Number(p.sell??m.sell)||0,chargeable:!!(p.chargeable??m.chargeable)}}
  // Price for a material line on a job: the item in the catalogue, or the price saved on older jobs.
  function linePrice(l){const m=S.materials.find(x=>x.id===l.id);return m?matPrice(m):matPrice({id:l.id,cost:l.cost,sell:l.sell,chargeable:l.chargeable})}
  const planPrice = c=>c?(pr("client:"+c.id).planPrice??c.planPrice??""):"";
  const quote = j=>j?(pr("job:"+j.id).quote??j.quote??""):"";
  // "visit" = invoice the plan price each service; "separate" = the plan is paid monthly/yearly outside the app.
  const planBilling = c=>c.planBilling||(Number(planPrice(c))?"visit":"separate");
  const onPlan = c=>!!c&&c.servicePlan==="Annual service plan";

  /* ---------- saving ---------- */
  async function savePrices(id,patch){
    if(!owner()) return true;
    return put("pricing",id,Object.assign(pr(id),patch));
  }
  async function dropPrices(id){if(owner()&&S.pricing.some(x=>x.id===id))await remove("pricing",id)}
  // Material, client and job forms: price fields go to the owner-only collection, the rest to the shared record.
  async function saveSplit(col,id,body,keys,prefix){
    const p={};for(const k of keys)if(body[k]!==undefined)p[k]=body[k];
    if(Object.keys(p).length&&!await savePrices(prefix+id,p)) return false;
    return put(col,id,without(body,keys));
  }

  /* ---------- moving old prices out of shared records (owner's device) ---------- */
  // Runs whenever an owner's device finds prices in a shared record: on the first load after this update,
  // and after restoring an older backup. Stops for the session if a save fails, so it can't loop.
  let failed=false;
  const save=async(col,id,d)=>{if(!await put(col,id,d))throw new Error("Couldn't save "+col+"/"+id);return true};
  async function moveLegacy(){
    if(failed||!owner()) return;
    try{
      if(has(S.settings,PRICE_KEYS)){
        const old={};for(const k of PRICE_KEYS)if(S.settings[k]!==undefined)old[k]=S.settings[k];
        await save("pricing","settings",Object.assign(old,pr("settings")));
        const body=without(S.settings,PRICE_KEYS);await db.doc("config/settings").set(body);S.settings=body;
      }
      for(const m of S.materials.filter(m=>has(m,MAT_KEYS))){
        const old={};for(const k of MAT_KEYS)if(m[k]!==undefined)old[k]=m[k];
        await save("pricing","mat:"+m.id,Object.assign(old,pr("mat:"+m.id)));await save("materials",m.id,without(m,MAT_KEYS));
      }
      for(const c of S.clients.filter(c=>c.planPrice!==undefined)){
        const d=without(c,["planPrice"]);if(d.planBilling==null&&onPlan(c))d.planBilling=planBilling(c);
        if(c.planPrice!=="")await save("pricing","client:"+c.id,Object.assign({planPrice:c.planPrice},pr("client:"+c.id)));
        await save("clients",c.id,d);
      }
      const priced=l=>has(l,MAT_KEYS), stripLines=a=>a.map(l=>without(l,MAT_KEYS));
      for(const j of S.jobs.filter(j=>j.quote!==undefined||(j.materialsUsed||[]).some(priced)||(j.materialsSnapshot||[]).some(priced))){
        if(j.quote!==undefined&&j.quote!=="")await save("pricing","job:"+j.id,Object.assign({quote:j.quote},pr("job:"+j.id)));
        const d=without(j,["quote"]);
        if(Array.isArray(j.materialsUsed))d.materialsUsed=stripLines(j.materialsUsed);
        if(Array.isArray(j.materialsSnapshot))d.materialsSnapshot=stripLines(j.materialsSnapshot);
        // A report issued before this change has a fingerprint that included the prices. If the record
        // hasn't changed since, note the fingerprint of the record without them so the job page still matches.
        const r=(j.serviceReports||[]).slice(-1)[0];
        if(r&&!r.hash2&&await ServiceReport.fingerprint(j,true)===r.hash){
          d.serviceReports=clone(j.serviceReports);d.serviceReports[d.serviceReports.length-1].hash2=await ServiceReport.fingerprint(Object.assign({id:j.id},d));
        }
        await save("jobs",j.id,d);
      }
    }catch(e){console.error(e);failed=true}
  }

  /* ---------- building invoices from completed jobs (owner's device) ---------- */
  const drafting=new Set();
  async function draft(j){
    const lines=invoiceLines(j), d=clone(j); delete d.toInvoice;
    if(!lines.length){d.billing="plan";await put("jobs",j.id,d);return null}
    const st=set(), s=system(j.systemId)||{}, n=Number(st.nextInvoiceNo)||1001, date=todayISO();
    if(!await saveSettings({nextInvoiceNo:n+1})) return null;
    const iid="i"+j.id;
    const inv={clientId:s.clientId||"",jobId:j.id,number:(st.invoicePrefix||"")+n,date,dueDate:addDays(date,st.paymentDays),reference:(j.type+" "+(s.sitePostcode||"")).trim(),lines,vat:!!st.vatRegistered,status:"draft",auto:true,updatedAt:date};
    if(!await put("invoices",iid,inv)) return null;
    d.invoiceId=iid; d.billing=onPlan(client(s.clientId))?"plan-extras":"charged";
    await put("jobs",j.id,d);
    toast("Draft invoice "+inv.number+" built for "+((client(s.clientId)||{}).name||"the job"));
    return iid;
  }
  async function sweep(){
    for(const j of S.jobs){
      if(j.status!=="completed"||!j.toInvoice||j.invoiceId||drafting.has(j.id)) continue;
      drafting.add(j.id); await draft(j);
    }
  }
  let ticking=false;
  // Called after every render: an owner's device tidies old prices and drafts invoices for newly completed jobs.
  function tick(){
    if(ticking||!owner()) return; ticking=true;
    setTimeout(async()=>{try{await moveLegacy();await sweep()}finally{ticking=false}},50);
  }

  /* ---------- screens ---------- */
  function settingsCard(){
    if(!owner()) return "";
    return `<div class="card" id="priceForm"><h2>Price list (ex VAT)</h2>
    <p class="note" style="margin-top:0">Only owners see these. Engineers record what they did and the parts they used, and the invoice is priced from here. Part prices are set on the <a href="#materials">Materials</a> page.</p>
    ${formHTML(PRICE_FIELDS,prices())}
    <p class="note">Clients on a service plan: the routine service visit, its F-gas leak check and the service kit are covered by the plan. Repairs, call-outs, refrigerant and parts the engineer adds are charged at these prices.</p>
    <div class="actions"><button class="btn pri" onclick="Billing.savePriceForm()">Save prices</button></div></div>`;
  }
  async function savePriceForm(){if(await savePrices("settings",readForm($("#priceForm"),PRICE_FIELDS)))toast("Prices saved")}
  function ownerOnly(){return `<div class="card"><h2>Only the business owner can see this</h2><p class="note">Prices and invoices are kept to owners. Record your work on the job and the office will invoice it.</p><a class="btn" href="#jobs">Go to jobs</a></div>`}
  function planLabel(c){return onPlan(c)?"Service plan":"Out of contract"}

  return {prices,matPrice,linePrice,planPrice,planBilling,onPlan,quote,savePrices,dropPrices,saveSplit,tick,draft,
    settingsCard,savePriceForm,ownerOnly,planLabel,MAT_KEYS};
})();
