/* Air Ledger: add booked jobs to iPhone (iCloud), Google or Outlook calendars.
   One job opens straight into Google or Outlook with everything filled in, ready to save.
   Several jobs are saved as one .ics file, then imported into Google or Outlook.
   Uses helpers from index.html (calEvent, buildICS, calendarFileName, exportICloud, icsDT, saveFile, openModal, closeModal, esc). */
"use strict";
const CalendarExport = (()=>{
  let jobs=[];
  const STEPS='style="padding-left:20px;line-height:1.6"';
  const q = o=>Object.entries(o).map(([k,v])=>k+"="+encodeURIComponent(v)).join("&");

  // "+01:00" in summer time, "+00:00" in winter, for that day in the UK.
  function ukOffset(date){
    try{const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",timeZoneName:"shortOffset"}).formatToParts(new Date(date+"T12:00:00Z")).find(x=>x.type==="timeZoneName");
      const m=/([+-])(\d+)/.exec(p&&p.value||"");return m?m[1]+m[2].padStart(2,"0")+":00":"+00:00"}
    catch(e){return "+00:00"}
  }
  function googleLink(e){
    return "https://calendar.google.com/calendar/render?"+q({action:"TEMPLATE",text:e.title,dates:icsDT(e.date,e.time)+"/"+icsDT(e.date,e.endTime),ctz:"Europe/London",details:e.desc,location:e.location});
  }
  // work: Microsoft 365 / work or school accounts; otherwise Outlook.com, Hotmail and Live accounts.
  function outlookLink(e,work){
    const off=ukOffset(e.date);
    return "https://outlook."+(work?"office":"live")+".com/calendar/0/deeplink/compose?"+q({path:"/calendar/action/compose",rru:"addevent",subject:e.title,
      startdt:e.date+"T"+e.time+":00"+off,enddt:e.date+"T"+e.endTime+":00"+off,body:e.desc,location:e.location});
  }
  const done = '<div class="actions"><button class="btn pri" onclick="closeModal()">Done</button></div>';

  function choose(list){
    jobs=list; const one=jobs.length===1;
    openModal(one?"Add to calendar":"Export "+jobs.length+" bookings to calendar",`<p>Which calendar do you use?</p>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:8px">
        <button class="btn" onclick="CalendarExport.icloud()">🍎 iPhone / iCloud Calendar</button>
        <button class="btn" onclick="CalendarExport.google()">🟦 Google Calendar</button>
        <button class="btn" onclick="CalendarExport.outlook()">📧 Outlook Calendar</button>
        <button class="btn" onclick="CalendarExport.file()">⬇️ Other – download .ics file</button>
      </div>`);
  }
  function icloud(){closeModal();exportICloud(jobs)}
  async function saveICS(){const name=calendarFileName(jobs)+".ics";return (await saveFile(name,buildICS(jobs)))?name:""}

  async function google(){
    if(jobs.length===1){
      openModal("Add to Google Calendar",`<p>Google Calendar will open with this job filled in. Check the details, then tap <b>Save</b>.</p>
        <div class="actions"><button class="btn" onclick="closeModal()">Cancel</button><a class="btn pri" target="_blank" rel="noopener" href="${esc(googleLink(calEvent(jobs[0])))}" onclick="setTimeout(closeModal,300)">Open Google Calendar</a></div>`);
      return;
    }
    const name=await saveICS(); if(!name)return;
    openModal("Import into Google Calendar",`<p>We've saved <b>${esc(name)}</b> to your downloads. Google only imports files on a computer, not the phone app.</p>
      <ol ${STEPS}><li>Tap <b>Open Google import</b> below (sign in if asked).</li><li>Under <b>Import</b>, click <b>Select file from your computer</b> and pick <b>${esc(name)}</b>.</li><li>Choose which calendar to add them to, then click <b>Import</b>.</li></ol>
      <p class="note">The jobs show up on your phone's Google Calendar app straight away.</p>
      <div class="actions"><button class="btn" onclick="closeModal()">Done</button><a class="btn pri" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/u/0/r/settings/export">Open Google import</a></div>`);
  }

  async function outlook(){
    if(jobs.length===1){
      const e=calEvent(jobs[0]);
      openModal("Add to Outlook Calendar",`<p>Outlook will open with this job filled in. Check the details, then click <b>Save</b>.</p>
        <p class="note">Pick the one you sign in to Outlook with.</p>
        <div class="row" style="flex-direction:column;align-items:stretch;gap:8px">
          <a class="btn pri" target="_blank" rel="noopener" href="${esc(outlookLink(e,true))}" onclick="setTimeout(closeModal,300)">Work or business account (Microsoft 365)</a>
          <a class="btn" target="_blank" rel="noopener" href="${esc(outlookLink(e,false))}" onclick="setTimeout(closeModal,300)">Personal account (Outlook.com, Hotmail, Live)</a>
        </div>`);
      return;
    }
    const name=await saveICS(); if(!name)return;
    openModal("Import into Outlook Calendar",`<p>We've saved <b>${esc(name)}</b> to your downloads.</p>
      <p><b>Outlook on the web</b></p>
      <ol ${STEPS}><li>Open your Outlook calendar using a button below.</li><li>On the left, click <b>Add calendar</b>, then <b>Upload from file</b>.</li><li>Click <b>Browse</b>, pick <b>${esc(name)}</b>, choose your calendar and click <b>Import</b>.</li></ol>
      <p><b>Outlook app on a Windows PC</b>: double-click <b>${esc(name)}</b> in your Downloads folder and the jobs are added.</p>
      <div class="actions"><button class="btn" onclick="closeModal()">Done</button>
        <a class="btn" target="_blank" rel="noopener" href="https://outlook.live.com/calendar/">Personal Outlook</a>
        <a class="btn pri" target="_blank" rel="noopener" href="https://outlook.office.com/calendar/">Work Outlook (Microsoft 365)</a></div>`);
  }

  async function file(){
    const name=await saveICS(); if(!name)return;
    openModal("Calendar file saved",`<p><b>${esc(name)}</b> is in your downloads. Open it, or import it into any calendar app that accepts .ics files.</p>`+done);
  }
  return {choose,icloud,google,outlook,file};
})();
