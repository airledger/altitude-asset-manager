/* Air Ledger landing page: the signed-out screen. index.html's loginScreen(msg) calls AirLedgerLanding.render(msg).
   Sign-up hands off to window.startSignup() when the business sign-up code defines it. */
(function(){
"use strict";
const ic={
  qr:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M14 21h7v-4"/></svg>',
  gas:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v3.2a6 6 0 1 0 4 0V3"/><path d="M9 15h6"/></svg>',
  bell:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  job:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  cash:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
  box:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/></svg>',
  tick:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  arrow:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
};
const h=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const gases=[["R32",675],["R410A",2088],["R454B",466],["R290",3],["R407C",1774],["R134a",1430],["R513A",631],["R1234ze",7],["R744",1],["R452B",698]];
const words=["unit.","F-gas check.","service.","job.","invoice."];

function qrSvg(text){
  try{const q=qrcode(0,"M");q.addData(text);q.make();return q.createSvgTag({cellSize:4,margin:0,scalable:true})}catch(e){return ic.qr}
}
function flowSvg(){
  // airflow lines drifting across the hero, echoing the twin peaks of the mark
  const lines=[];
  for(let i=0;i<9;i++){const y=90+i*62,a=26+i*3;
    lines.push(`<path class="${i%2?"f2":"f1"}" d="M-50 ${y} C 240 ${y-a}, 420 ${y+a}, 720 ${y} S 1180 ${y-a}, 1500 ${y}"/>`)}
  return `<svg class="lp-flow" viewBox="0 0 1440 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="lpStreak" x1="0" x2="1"><stop offset="0" stop-color="#3FC1D9" stop-opacity="0"/><stop offset="1" stop-color="#3FC1D9"/></linearGradient></defs>
    ${lines.join("")}
    <path class="f3" d="M-50 240 C 260 200, 420 300, 720 250 S 1180 190, 1500 240"/>
    <path class="f3 b" d="M-50 430 C 260 400, 420 480, 720 430 S 1180 380, 1500 440"/>
    <path class="f3 c" d="M-50 560 C 260 530, 420 600, 720 560 S 1180 520, 1500 570"/>
  </svg>`;
}

function html(msg){
  const ticker=gases.map(([g,w])=>`<span><b>${g}</b>GWP <i>${w.toLocaleString("en-GB")}</i></span>`).join("");
  return `<div class="lp">
<nav class="lp-nav" id="lpNav"><div class="lp-wrap">
  <img src="logo-reverse.svg" alt="Air Ledger" width="132" height="30">
  <div class="sp"></div>
  <div class="links"><a href="#lp-features">Features</a><a href="#lp-how">How it works</a><a href="#lp-business">For your business</a></div>
  <button class="lp-btn ghost" type="button" data-act="signin">Sign in</button>
  <button class="lp-btn pri" type="button" data-act="signup">Start free</button>
</div></nav>

<header class="lp-hero">
  ${flowSvg()}<div class="lp-glow a"></div><div class="lp-glow b"></div>
  <div class="lp-wrap lp-hero-grid">
    <div>
      <span class="lp-eyebrow rv">For air conditioning &amp; refrigeration engineers</span>
      <h1 class="rv d1">Every <span class="rot" id="lpRot"><span>${words[0]}</span></span>On the ledger.</h1>
      <p class="lede rv d2">Air Ledger tracks every AC unit you fit or service, from the QR sticker on the casing to the F-gas record, the job sheet and the invoice in Xero.</p>
      <div class="ctas rv d3">
        <button class="lp-btn pri" type="button" data-act="signup">Create your business account ${ic.arrow}</button>
        <a class="lp-btn ghost" href="#lp-how">See how it works</a>
      </div>
      <div class="lp-chips rv d4"><span><b>AC-00412</b> scanned</span><span>6.68 t CO₂e</span><span>Leak check <b>12 mo</b></span></div>
    </div>
    <div class="rv d2" id="lp-signin">
      <form class="lp-signin" id="login" autocomplete="on">
        <h2>Welcome back</h2>
        <p class="sub">Sign in to your ledger.</p>
        ${msg?`<div class="err" role="alert">${h(msg)}</div>`:""}
        <label for="lEmail">Email</label>
        <input type="email" id="lEmail" autocomplete="username" required>
        <label for="lPass">Password</label>
        <input type="password" id="lPass" autocomplete="current-password" required>
        <button class="lp-btn pri" type="submit" id="lGo">Sign in</button>
        <div class="alt">New to Air Ledger? <button type="button" data-act="signup">Create a business account</button></div>
        <div class="soon" id="lpSoon">Business sign-up opens very soon. You'll be able to set up your company, upload your logo and invite your engineers.</div>
      </form>
    </div>
  </div>
</header>

<div class="lp-ticker" aria-hidden="true"><div class="track">${ticker}${ticker}</div></div>

<section class="lp-sec" id="lp-features"><div class="lp-wrap">
  <div class="lp-head rv"><span class="lp-eyebrow">Everything in one place</span><h2>Built on site, for the way AC engineers actually work.</h2><p>No more spreadsheets, paper F-gas logs or hunting through texts for a serial number.</p></div>
  <div class="lp-feats">
    <div class="lp-feat rv"><div class="ic">${ic.qr}</div><h3>QR asset stickers</h3><p>Print a sheet of AC-numbered labels, stick one on every unit, and scan it with your phone to pull up its full history.</p></div>
    <div class="lp-feat rv d1"><div class="ic">${ic.gas}</div><h3>F-gas register</h3><p>CO₂e worked out from the refrigerant and charge, leak-check intervals set automatically, and a register you can export.</p></div>
    <div class="lp-feat rv d2"><div class="ic">${ic.bell}</div><h3>Service reminders</h3><p>See what's due and overdue at a glance, with ready-made email and text reminders for your customers.</p></div>
    <div class="lp-feat rv"><div class="ic">${ic.job}</div><h3>Jobs &amp; reports</h3><p>Checklists, photos and engineer notes for every install and service, turned into a clean report for the customer.</p></div>
    <div class="lp-feat money rv d1"><div class="ic">${ic.cash}</div><h3>Invoices to Xero</h3><p>Price the job from your own rates and export invoices straight into Xero, without retyping a thing.</p></div>
    <div class="lp-feat rv d2"><div class="ic">${ic.box}</div><h3>Materials &amp; orders</h3><p>Keep track of kit and parts by supplier so the van is stocked before you get to site.</p></div>
  </div>
</div></section>

<section class="lp-sec mist" id="lp-how"><div class="lp-wrap lp-show">
  <div class="lp-phonewrap rv">
    <div class="lp-phone"><div class="notch"></div><div class="scr">
      <div class="bar"><img src="logo-reverse.svg" alt=""><span class="sc">Scan</span></div>
      <div class="body">
        <div class="qr">${qrSvg("AC-00412")}</div>
        <div class="id">AC-00412</div>
        <div class="site">Harbour Café · Indoor unit 2</div>
        <div class="row2">
          <div class="tile"><div class="k">Refrigerant</div><div class="v">R410A · 3.2 kg</div></div>
          <div class="tile"><div class="k">CO₂e</div><div class="v"><span id="lpCo2">0.00</span> t</div></div>
        </div>
        <div class="tile"><div><div class="k">Next service</div><div class="v">14 Nov 2026</div></div><span class="pill am">Due soon</span></div>
        <div class="tile"><div><div class="k">Last leak check</div><div class="v">No leaks found</div></div><span class="pill">Passed</span></div>
      </div>
    </div></div>
    <div class="lp-float one"><span class="dot">${ic.tick}</span><span><b>Service logged</b>Report sent to customer</span></div>
    <div class="lp-float two x"><span class="dot">${ic.cash}</span><span><b>Invoice ready</b>Exported to Xero</span></div>
  </div>
  <div>
    <div class="lp-head rv" style="margin-bottom:28px"><span class="lp-eyebrow">How it works</span><h2>Stick it. Scan it. Sorted.</h2></div>
    <div class="lp-steps" id="lpSteps">
      <div class="lp-step on rv"><div class="n"></div><div><h3>Label every unit</h3><p>Print a sheet of QR stickers and put one on each indoor and outdoor unit as you install or service it.</p></div></div>
      <div class="lp-step rv d1"><div class="n"></div><div><h3>Scan on site</h3><p>Tap Scan and point your phone at the sticker. The unit, its site, gas charge and full service history open instantly.</p></div></div>
      <div class="lp-step rv d2"><div class="n"></div><div><h3>Log it once</h3><p>Record the job, photos and leak check in one go. The F-gas register, the customer report and the invoice all update from it.</p></div></div>
    </div>
  </div>
</div></section>

<section class="lp-sec" id="lp-business"><div class="lp-wrap">
  <div class="lp-biz rv">
    <div style="position:relative">
      <span class="lp-eyebrow">Your company, your ledger</span>
      <h2>Make it yours in five minutes.</h2>
      <p>Set up your business on Air Ledger and your team gets its own sign-in page, with your name and logo on it.</p>
      <ul>
        <li>${ic.tick}<span>Upload your logo, address and company details</span></li>
        <li>${ic.tick}<span>Your own branded sign-in link for your engineers</span></li>
        <li>${ic.tick}<span>Your details printed on every report, sticker and invoice</span></li>
        <li>${ic.tick}<span>Your data kept private to your business</span></li>
      </ul>
      <button class="lp-btn pri" type="button" data-act="signup">Set up your business ${ic.arrow}</button>
    </div>
    <div style="position:relative">
      <div class="lp-brandcard" id="lpBrand"><span class="tag">Your sign-in page</span>
        <div class="hd"><div class="lg" id="lpBizLogo">NC</div><div><div class="nm" id="lpBizName">Northern Cooling Ltd</div><div class="sm">Engineer sign-in</div></div></div>
        <div class="fld">Email</div><div class="fld">Password</div><div class="go">Sign in</div>
      </div>
    </div>
  </div>
</div></section>

<section class="lp-cta"><div class="lp-wrap">
  <h2 class="rv">Get every unit on the ledger.</h2>
  <p class="rv d1">Set up your business, print your first sheet of stickers and scan your first unit today.</p>
  <div class="ctas rv d2"><button class="lp-btn pri" type="button" data-act="signup">Create your business account ${ic.arrow}</button><button class="lp-btn ghost" type="button" data-act="signin">Sign in</button></div>
</div></section>

<footer class="lp-foot"><div class="lp-wrap"><img src="logo-reverse.svg" alt="Air Ledger"><div class="sp"></div><span>© ${new Date().getFullYear()} Air Ledger</span></div></footer>
</div>`;
}

let timers=[],io=null;
function cleanup(){timers.forEach(clearInterval);timers=[];if(io){io.disconnect();io=null}window.removeEventListener("scroll",onScroll)}
function onScroll(){const n=document.getElementById("lpNav");if(n)n.classList.toggle("solid",scrollY>20)}
const reduced=()=>window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;

function signup(){
  if(typeof window.startSignup==="function"){cleanup();document.body.classList.remove("landing");window.startSignup();return}
  const s=document.getElementById("lpSoon");s.classList.add("on");
  document.getElementById("lp-signin").scrollIntoView({behavior:reduced()?"auto":"smooth",block:"center"});
}
function signin(){
  document.getElementById("lp-signin").scrollIntoView({behavior:reduced()?"auto":"smooth",block:"center"});
  setTimeout(()=>document.getElementById("lEmail").focus({preventScroll:true}),reduced()?0:450);
}

function render(msg){
  cleanup();
  const nav=document.getElementById("nav");if(nav)nav.innerHTML="";
  document.body.classList.add("landing");
  const app=document.getElementById("app");
  app.innerHTML=html(msg);
  window.scrollTo(0,0);
  app.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",()=>b.dataset.act==="signup"?signup():signin()));
  window.addEventListener("scroll",onScroll,{passive:true});onScroll();

  const form=document.getElementById("login");
  form.addEventListener("submit",async e=>{e.preventDefault();
    const go=document.getElementById("lGo");go.disabled=true;go.textContent="Signing in…";
    const {error}=await sb.auth.signInWithPassword({email:document.getElementById("lEmail").value.trim(),password:document.getElementById("lPass").value});
    if(error){render(error.message);document.getElementById("lp-signin").scrollIntoView({block:"center"})}else location.reload();
  });

  // reveal on scroll, plus the one-off CO2e counter when the phone comes into view
  const co2=document.getElementById("lpCo2");
  const countUp=()=>{const end=3.2*2088/1000,t0=performance.now(),d=1400;
    const step=t=>{const p=Math.min(1,(t-t0)/d),v=end*(1-Math.pow(1-p,3));co2.textContent=v.toFixed(2);if(p<1)requestAnimationFrame(step)};
    requestAnimationFrame(step)};
  if("IntersectionObserver" in window&&!reduced()){
    io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;en.target.classList.add("in");
      if(en.target.classList.contains("lp-phonewrap"))countUp();io.unobserve(en.target)}),{threshold:.15,rootMargin:"0px 0px -40px 0px"});
    app.querySelectorAll(".rv").forEach(el=>io.observe(el));
  }else{app.querySelectorAll(".rv").forEach(el=>el.classList.add("in"));co2.textContent=(3.2*2088/1000).toFixed(2)}
  if(reduced())return;

  // rotating headline word
  let wi=0;const rot=document.getElementById("lpRot");
  timers.push(setInterval(()=>{wi=(wi+1)%words.length;rot.innerHTML=`<span>${words[wi]}</span>`},2200));
  // walk through the three steps
  let si=0;const steps=[...document.querySelectorAll("#lpSteps .lp-step")];
  timers.push(setInterval(()=>{steps[si].classList.remove("on");si=(si+1)%steps.length;steps[si].classList.add("on")},3200));
  // the sample business card cycles through a few company looks
  const biz=[["Northern Cooling Ltd","NC","#E2574C"],["Coastline Air","CA","#2F7DE1"],["Peak Refrigeration","PR","#1E8A5A"],["Summit Climate","SC","#7A4FD6"]];
  let bi=0;const card=document.getElementById("lpBrand"),nm=document.getElementById("lpBizName"),lg=document.getElementById("lpBizLogo");
  timers.push(setInterval(()=>{bi=(bi+1)%biz.length;const [n,i,c]=biz[bi];card.style.setProperty("--biz",c);nm.textContent=n;lg.textContent=i},2800));
}

window.AirLedgerLanding={render};
})();
