/* Air Ledger: businesses, sign-up, invites and company profile.
   Each business ("org") has its own records; the database only shows a user the businesses they belong to.
   Uses helpers from index.html ($, esc, toast, sb, set, saveSettings, copyText, schedule, confirmBox). */
"use strict";
const Biz = (()=>{
  const BASE = location.origin+location.pathname;
  const qs = new URLSearchParams(location.search);
  const LS = {get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
  if(qs.get("invite")) LS.set("al-invite",qs.get("invite").trim().toUpperCase());
  if(qs.get("b")) LS.set("al-brand",qs.get("b").trim().toLowerCase());
  const st = {org:null,orgs:[],role:null,admin:false,user:null,team:null,invites:null,signupCodes:null,loading:false};
  const inputCss = 'style="width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:9px;font:15px var(--f-body)"';
  const msg = (m,err)=>m?`<p class="note" style="${err?"color:var(--red)":""}">${esc(m)}</p>`:"";
  const errText = e=>(e&&(e.message||e.error_description||e.code))||String(e);

  async function brandFor(slug){
    if(!slug) return null;
    const {data} = await sb.rpc("org_public",{p_slug:slug});
    return data&&data[0]||null;
  }
  async function inviteInfo(code){
    if(!code) return null;
    const {data} = await sb.rpc("invite_info",{p_code:code});
    return data&&data[0]||null;
  }
  function brandHead(b){
    if(!b) return "";
    return `<div style="text-align:center;margin-bottom:14px">${b.logo_url?`<img src="${esc(b.logo_url)}" alt="" style="max-height:72px;max-width:220px;object-fit:contain">`:""}<div style="font:600 20px var(--f-head,inherit);margin-top:6px">${esc(b.name)}</div></div>`;
  }

  /* ---------- signed out ---------- */
  // Shows the branded sign-in (?b=slug) or create-account (?invite=CODE) screen. Returns false to fall back to the landing page.
  async function signedOut(){
    if(qs.get("invite")){await signupScreen();return true}
    const slug = qs.get("b");
    if(slug){await signinScreen(await brandFor(slug.toLowerCase()));return true}
    return false;
  }
  async function signinScreen(brand,note,err){
    $("#nav").innerHTML="";
    $("#app").innerHTML=`<div class="card" style="max-width:420px;margin:40px auto">${brandHead(brand)}<h2>Sign in</h2>${msg(note,err)}
    <form id="bzIn" class="fg" style="grid-template-columns:1fr"><div class="f"><label>Email</label><input type="email" id="bzEmail" autocomplete="username" required></div>
    <div class="f"><label>Password</label><input type="password" id="bzPass" autocomplete="current-password" required ${inputCss}></div>
    <div class="actions"><button class="btn pri" type="submit">Sign in</button></div></form>
    <p class="note">New here with an invite code? <a href="#" id="bzToUp">Create an account</a></p></div>`;
    $("#bzToUp").onclick=e=>{e.preventDefault();signupScreen(brand)};
    $("#bzIn").onsubmit=async e=>{e.preventDefault();
      const {error}=await sb.auth.signInWithPassword({email:$("#bzEmail").value.trim(),password:$("#bzPass").value});
      if(error)signinScreen(brand,error.message,true);else location.reload()};
  }
  async function signupScreen(brand,note,err){
    const code = LS.get("al-invite")||"";
    const info = code?await inviteInfo(code):null;
    $("#nav").innerHTML="";
    $("#app").innerHTML=`<div class="card" style="max-width:420px;margin:40px auto">${brandHead(brand)}<h2>Create your account</h2>
    ${info&&info.joins?`<p class="note">You've been invited to join <b>${esc(info.org_name)}</b> on Air Ledger.</p>`:`<p class="note">Air Ledger is invite only for now. Enter the code you were given, or email <a href="mailto:hello@airledger.co.uk">hello@airledger.co.uk</a> to ask for one.</p>`}${msg(note,err)}
    <form id="bzUp" class="fg" style="grid-template-columns:1fr">
    <div class="f"><label>Invite code</label><input id="bzCode" value="${esc(code)}" required autocapitalize="characters" autocomplete="off"></div>
    <div class="f"><label>Email</label><input type="email" id="bzEmail" autocomplete="username" required></div>
    <div class="f"><label>Password</label><input type="password" id="bzPass" autocomplete="new-password" minlength="8" required ${inputCss}><div class="hint">At least 8 characters.</div></div>
    <div class="actions"><button class="btn pri" type="submit">Create account</button></div></form>
    <p class="note">Already have an account? <a href="#" id="bzToIn">Sign in</a></p></div>`;
    $("#bzToIn").onclick=e=>{e.preventDefault();signinScreen(brand)};
    $("#bzUp").onsubmit=async e=>{e.preventDefault();
      const c=$("#bzCode").value.trim().toUpperCase(), email=$("#bzEmail").value.trim(), pass=$("#bzPass").value;
      if(!await inviteInfo(c)){signupScreen(brand,"That invite code isn't valid or has already been used.",true);return}
      LS.set("al-invite",c);
      const {data,error}=await sb.auth.signUp({email,password:pass,options:{emailRedirectTo:BASE}});
      if(error){signupScreen(brand,error.message,true);return}
      if(data.session){location.href=BASE;return}
      signinScreen(brand,"Nearly there: we've emailed "+email+" a link to confirm your address. Open it, then sign in here.");
    };
  }

  /* ---------- signed in ---------- */
  // Works out which business to open. Shows the set-up screen and returns null if the user has none yet.
  async function resolveOrg(){
    const {data:{user}} = await sb.auth.getUser(); st.user=user;
    const [{data:mem,error},{data:adm}] = await Promise.all([
      sb.from("members").select("org_id,role,orgs(id,name,slug,logo_url)").eq("user_id",user.id),
      sb.from("platform_admins").select("user_id").eq("user_id",user.id)]);
    if(error) throw error;
    st.admin = !!(adm&&adm.length);
    st.orgs = (mem||[]).filter(m=>m.orgs).map(m=>Object.assign({role:m.role},m.orgs));
    if(LS.get("al-invite")){
      const info = await inviteInfo(LS.get("al-invite"));
      if(info&&info.joins){await joinScreen(info);return null}
      if(!info) LS.set("al-invite",null);
    }
    if(!st.orgs.length){setupScreen();return null}
    const pick = st.orgs.find(o=>o.id===LS.get("al-org"))||st.orgs.find(o=>o.slug===LS.get("al-brand"))||st.orgs[0];
    st.org = pick; st.role = pick.role; LS.set("al-org",pick.id);
    return pick;
  }
  async function joinScreen(info,note){
    $("#nav").innerHTML="";
    $("#app").innerHTML=`<div class="card" style="max-width:460px;margin:40px auto"><h2>Join ${esc(info.org_name)}</h2>${msg(note,true)}
    <p class="note">You've been invited to join <b>${esc(info.org_name)}</b>. You'll see its clients, assets, jobs and invoices.</p>
    <div class="actions"><button class="btn" id="bzNo">Not now</button><button class="btn pri" id="bzJoin">Join</button></div></div>`;
    $("#bzNo").onclick=()=>{LS.set("al-invite",null);location.href=BASE};
    $("#bzJoin").onclick=async()=>{
      const {data,error}=await sb.rpc("join_business",{p_code:LS.get("al-invite")});
      if(error){joinScreen(info,error.message);return}
      LS.set("al-invite",null);LS.set("al-org",data);location.href=BASE;
    };
  }
  const SETUP_FIELDS=[
    {k:"businessName",label:"Business name",req:true,full:true},
    {k:"phone",label:"Phone",type:"tel"},{k:"email",label:"Email",type:"email"},
    {k:"address",label:"Business address",type:"textarea",full:true},
    {k:"website",label:"Website"},{k:"companyNo",label:"Company number"},
    {k:"vatNo",label:"VAT number"},{k:"fgasCert",label:"F-gas company cert no."},
    {k:"engineer",label:"Your name (default engineer)"},{k:"vatRegistered",label:"VAT registered (adds 20% to invoices)",type:"checkbox"}];
  function setupScreen(note){
    const code=LS.get("al-invite")||"";
    $("#nav").innerHTML="";
    $("#app").innerHTML=`<div class="card" style="max-width:640px;margin:30px auto"><h2>Set up your business</h2>
    <p class="note">Signed in as ${esc(st.user.email)}. This appears on your reports, QR labels and reminders. You can change it any time in Settings.</p>${msg(note,true)}
    <div id="bzSetup">${formHTML([{k:"code",label:"Invite code",req:!st.admin,full:true,hint:st.admin?"Not needed for Air Ledger admins.":"The code you were given to create a business."}],{code})}
    ${formHTML(SETUP_FIELDS,{email:st.user.email,vatRegistered:false})}
    <div class="f" style="margin-top:10px"><label>Logo (optional)</label><input type="file" id="bzLogo" accept="image/png,image/jpeg,image/svg+xml,image/webp"></div></div>
    <div class="actions"><button class="btn" onclick="signOut()">Sign out</button><button class="btn pri" id="bzCreate">Create business</button></div>
    <p class="note">Joining a colleague's business instead? Ask them for an invite link from their Settings.</p></div>`;
    $("#bzCreate").onclick=async()=>{
      const root=$("#bzSetup"), v=readForm(root,SETUP_FIELDS), c=readForm(root,[{k:"code"}]).code.toUpperCase();
      if(missing(SETUP_FIELDS,v))return;
      const btn=$("#bzCreate");btn.disabled=true;btn.textContent="Creating…";
      const {data:orgId,error}=await sb.rpc("create_business",{p_name:v.businessName,p_code:c||null});
      if(error){setupScreen(error.message);return}
      LS.set("al-invite",null);LS.set("al-org",orgId);
      // Clear the Altitude-specific defaults so a new business starts clean.
      const body=Object.assign({tradingAs:"",invoicePrefix:"INV-",trackingName:"",trackingOption:"",appUrl:""},v);
      await sb.from("docs").upsert({org_id:orgId,col:"config",id:"settings",data:body});
      const f=$("#bzLogo").files[0];
      if(f){try{const url=await uploadLogo(orgId,f);await sb.rpc("update_business",{p_org:orgId,p_name:v.businessName,p_slug:null,p_logo_url:url})}catch(e){}}
      location.href=BASE;
    };
  }
  async function uploadLogo(orgId,file){
    if(file.size>2e6) throw new Error("Logo must be under 2 MB");
    const ext=(file.name.split(".").pop()||"png").toLowerCase().replace(/[^a-z0-9]/g,"");
    const path=orgId+"/logo-"+Date.now()+"."+ext;
    const {error}=await sb.storage.from("logos").upload(path,file,{contentType:file.type,upsert:true});
    if(error) throw error;
    return sb.storage.from("logos").getPublicUrl(path).data.publicUrl;
  }

  /* ---------- settings cards ---------- */
  async function refresh(){
    if(st.loading||!st.org) return; st.loading=true;
    const q=[sb.from("members").select("user_id,email,role,created_at").eq("org_id",st.org.id).order("created_at")];
    if(st.role==="owner") q.push(sb.from("invites").select("code,email,created_at").eq("org_id",st.org.id).is("used_by",null).order("created_at"));
    if(st.admin) q.push(sb.from("invites").select("code,created_at").is("org_id",null).is("used_by",null).order("created_at"));
    const r=await Promise.all(q);
    st.team=r[0].data||[]; if(st.role==="owner") st.invites=r[1].data||[]; if(st.admin) st.signupCodes=r[r.length-1].data||[];
    st.loading=false; schedule();
  }
  const linkRow=(url)=>`<div class="row" style="align-items:center;gap:8px;flex-wrap:wrap"><code style="word-break:break-all">${esc(url)}</code><button class="btn" onclick="copyText('${esc(url)}')">Copy</button></div>`;
  function settingsCards(){
    if(!st.org) return "";
    if(!st.team) refresh();
    const o=st.org, owner=st.role==="owner", me=st.user&&st.user.id;
    let h=`<div class="card"><h2>Logo & sign-in page</h2>
    <div class="row" style="align-items:center;gap:14px">${o.logo_url?`<img src="${esc(o.logo_url)}" alt="Logo" style="max-height:64px;max-width:200px;object-fit:contain;border:1px solid var(--line);border-radius:8px;padding:4px;background:#fff">`:`<span class="note">No logo yet.</span>`}
    ${owner?`<label class="btn">${o.logo_url?"Change logo":"Upload logo"}<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onchange="Biz.setLogo(this)"></label>${o.logo_url?`<button class="btn" onclick="Biz.setLogo(null)">Remove</button>`:""}`:""}</div>
    <p class="note" style="margin-top:12px">Your team's sign-in page shows your name and logo:</p>${linkRow(BASE+"?b="+o.slug)}
    ${owner?`<div class="row" style="margin-top:8px;align-items:center;gap:8px"><input id="bzSlug" value="${esc(o.slug)}" style="max-width:220px;padding:8px 10px;border:1px solid var(--line);border-radius:9px"><button class="btn" onclick="Biz.setSlug()">Change link</button></div>`:""}</div>`;
    h+=`<div class="card"><h2>Team</h2><p class="note" style="margin-top:0">Engineers see clients, assets and jobs and record their work, but not prices or invoices. Owners see everything.</p>${st.team?`<div class="tw"><table class="t"><tbody>${st.team.map(m=>`<tr><td>${esc(m.email||"")}${m.user_id===me?" <span class=\"note\">(you)</span>":""}</td><td>${m.role==="owner"?"Owner":"Engineer"}</td><td class="n">${owner&&m.user_id!==me?`${m.role!=="owner"?`<button class="btn" onclick="Biz.makeOwner('${esc(m.user_id)}')">Make owner</button> `:""}<button class="btn" onclick="Biz.removeMember('${esc(m.user_id)}')">Remove</button>`:""}</td></tr>`).join("")}</tbody></table></div>`:'<p class="note">Loading…</p>'}
    ${owner?`<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><input id="bzInvEmail" type="email" placeholder="Their email (optional)" style="max-width:260px;padding:8px 10px;border:1px solid var(--line);border-radius:9px"><button class="btn pri" onclick="Biz.invite()">Invite to team</button></div>
    ${(st.invites||[]).length?`<p class="note" style="margin-top:10px">Invites waiting to be used. Send the link to the person:</p>${st.invites.map(i=>`<div style="margin-top:6px">${i.email?`<b>${esc(i.email)}</b> `:""}${linkRow(BASE+"?invite="+i.code)}<button class="btn" style="margin-top:4px" onclick="Biz.cancelInvite('${esc(i.code)}')">Cancel</button></div>`).join("")}`:""}`:""}</div>`;
    if(st.orgs.length>1) h+=`<div class="card"><h2>Your businesses</h2><div class="row" style="gap:8px;flex-wrap:wrap">${st.orgs.map(x=>`<button class="btn ${x.id===o.id?"pri":""}" onclick="Biz.switchTo('${x.id}')">${esc(x.name)}</button>`).join("")}</div></div>`;
    if(st.admin) h+=`<div class="card"><h2>Invite a new business</h2><p class="note">Air Ledger is invite only. Each code lets one business create its own account.</p>
    <div class="row"><button class="btn pri" onclick="Biz.newBusinessCode()">Create invite code</button></div>
    ${(st.signupCodes||[]).map(i=>`<div style="margin-top:8px"><b>${esc(i.code)}</b> ${linkRow(BASE+"?invite="+i.code)}<button class="btn" style="margin-top:4px" onclick="Biz.cancelInvite('${esc(i.code)}')">Cancel</button></div>`).join("")}</div>`;
    h+=`<div class="card"><h2>Delete account</h2><p class="note">Deleting is permanent and can't be undone. Download a backup first if you might need your records.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">${owner?`<button class="btn danger" onclick="Biz.deleteBusiness()">Delete ${esc(o.name)}</button>`:""}<button class="btn danger" onclick="Biz.deleteAccount()">Delete my account</button></div></div>`;
    return h;
  }
  // Asks the user to type a word before a permanent delete.
  function typedConfirm(title,text,word){
    return new Promise(res=>{openModal(title,`<p>${esc(text)}</p><p>Type <b>${esc(word)}</b> to confirm.</p><input id="tcIn" autocomplete="off" style="width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:9px">
      <div class="actions"><button class="btn" id="tcNo">Keep</button><button class="btn danger" id="tcYes" disabled>Delete permanently</button></div>`,md=>{
      const inp=$("#tcIn",md),yes=$("#tcYes",md);
      inp.oninput=()=>{yes.disabled=inp.value.trim().toLowerCase()!==word.toLowerCase()};
      $("#tcNo",md).onclick=()=>{closeModal();res(false)};yes.onclick=()=>{closeModal();res(true)};inp.focus()})});
  }
  // Removes a business's photos and logo (the database can't delete stored files itself).
  async function purgeFiles(orgId){
    const {data:pl}=await sb.from("platform").select("legacy_org");
    const legacy=pl&&pl[0]&&pl[0].legacy_org===orgId;
    for(const [bucket,folder] of [["photos",orgId],["logos",orgId]].concat(legacy?[["photos",""]]:[])){
      for(;;){
        const {data,error}=await sb.storage.from(bucket).list(folder,{limit:1000});
        if(error) throw error;
        const files=(data||[]).filter(f=>f.id).map(f=>folder?folder+"/"+f.name:f.name);
        if(!files.length) break;
        const {data:gone,error:e2}=await sb.storage.from(bucket).remove(files); if(e2) throw e2;
        if(!gone||!gone.length) break;
      }
    }
  }
  async function rpcOk(name,args){const {data,error}=await sb.rpc(name,args);if(error){toast(errText(error),"err");return undefined}return data}
  async function saveOrg(patch){
    const o=Object.assign({},st.org,patch);
    const slug=await rpcOk("update_business",{p_org:o.id,p_name:o.name,p_slug:o.slug,p_logo_url:o.logo_url||null});
    if(slug===undefined) return false;
    o.slug=slug; Object.assign(st.org,o); const x=st.orgs.find(y=>y.id===o.id); if(x)Object.assign(x,o); schedule(); return true;
  }
  return {
    get org(){return st.org},
    // Owners see prices and invoices; engineers ("member") don't. Without a business (offline demo) everything shows.
    get isOwner(){return !st.org||st.role==="owner"},
    signedOut, resolveOrg, signupScreen,
    settingsCards,
    async afterSettingsSaved(v){if(st.role==="owner"&&v.businessName&&v.businessName!==st.org.name)await saveOrg({name:v.businessName})},
    logoImg(h){return st.org&&st.org.logo_url?`<img src="${esc(st.org.logo_url)}" alt="" style="max-height:${h||56}px;max-width:200px;object-fit:contain;display:block;margin-bottom:6px">`:""},
    async setLogo(inp){
      if(!inp){if(await saveOrg({logo_url:null}))toast("Logo removed");return}
      const f=inp.files&&inp.files[0]; if(!f) return;
      try{const url=await uploadLogo(st.org.id,f); if(await saveOrg({logo_url:url}))toast("Logo saved")}catch(e){toast("Logo upload failed: "+errText(e),"err")}
    },
    async setSlug(){const v=$("#bzSlug").value.trim(); if(v&&await saveOrg({slug:v}))toast("Sign-in link changed")},
    async invite(){
      const email=$("#bzInvEmail").value.trim();
      const code=await rpcOk("create_invite",{p_org:st.org.id,p_email:email||null}); if(code===undefined) return;
      copyText(BASE+"?invite="+code); toast("Invite link copied. Send it to "+(email||"them")); refresh();
    },
    async newBusinessCode(){const code=await rpcOk("create_invite",{p_org:null,p_email:null}); if(code===undefined) return; copyText(BASE+"?invite="+code); refresh()},
    async cancelInvite(code){const {error}=await sb.from("invites").delete().eq("code",code); if(error)toast(errText(error),"err"); refresh()},
    async removeMember(uid){
      const m=(st.team||[]).find(x=>x.user_id===uid);
      if(!await confirmBox("Remove "+((m&&m.email)||"this person")+" from "+st.org.name+"? They'll lose access straight away.")) return;
      const {error}=await sb.from("members").delete().eq("org_id",st.org.id).eq("user_id",uid); if(error)toast(errText(error),"err"); refresh();
    },
    switchTo(id){LS.set("al-org",id);location.href=BASE},
    async makeOwner(uid){const m=(st.team||[]).find(x=>x.user_id===uid);if(!await confirmBox("Make "+((m&&m.email)||"this person")+" an owner? They'll be able to change company details, invite people and delete the business.","Make owner"))return;if(await rpcOk("make_owner",{p_org:st.org.id,p_user:uid})!==undefined)refresh()},
    async deleteBusiness(){
      const o=st.org;
      if(!await typedConfirm("Delete "+o.name,"This deletes "+o.name+" for everyone in the team: all clients, assets, jobs, invoices, reports, photos and the logo.",o.name)) return;
      toast("Deleting…");
      try{await purgeFiles(o.id)}catch(e){toast("Couldn't delete photos: "+errText(e),"err");return}
      if(await rpcOk("delete_business",{p_org:o.id})===undefined) return;
      LS.set("al-org",null); location.href=BASE;
    },
    async deleteAccount(){
      const {data:plan,error}=await sb.rpc("account_deletion_plan");
      if(error){toast(errText(error),"err");return}
      const names=(plan||[]).map(x=>x.name);
      if(!await typedConfirm("Delete my account","This permanently deletes your Air Ledger login ("+st.user.email+")"+(names.length?" and "+names.join(", ")+" with all of its records and photos":"")+". Your team keeps any business you share with them.","DELETE")) return;
      toast("Deleting…");
      try{for(const x of plan||[])await purgeFiles(x.org_id)}catch(e){toast("Couldn't delete photos: "+errText(e),"err");return}
      if(await rpcOk("delete_my_account",{})===undefined) return;
      LS.set("al-org",null); await sb.auth.signOut(); location.href=BASE;
    }
  };
})();
// The landing page's "Create your business account" button calls this.
window.startSignup = ()=>Biz.signupScreen(null);
