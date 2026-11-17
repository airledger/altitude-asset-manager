// Reads a calendar file (iCalendar, as Google, Outlook and iCloud publish it) into the times someone is busy,
// with repeating entries expanded, between two dates.
import ICAL from "npm:ical.js@2.1.0";

export interface Busy {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  title: string;
}

/** Entries Air Ledger itself put in the calendar (job invites), so jobs don't come back as busy times. */
const OURS = /@airledger\.co\.uk$/i;
/** A calendar with more than this many entries in the window is cut short, so one can't swamp the schedule. */
const MAX = 2000;

export function busyTimes(ics: string, from: Date, to: Date): Busy[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
  const events = root.getAllSubcomponents("vevent");
  // Changed or cancelled single occurrences of a repeating entry.
  const exceptions = new Map<string, ICAL.Component[]>();
  for (const e of events) {
    if (!e.hasProperty("recurrence-id")) continue;
    const uid = String(e.getFirstPropertyValue("uid") ?? "");
    exceptions.set(uid, [...(exceptions.get(uid) ?? []), e]);
  }
  const out: Busy[] = [];
  const add = (start: ICAL.Time, end: ICAL.Time, title: string, comp: ICAL.Component) => {
    if (String(comp.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") return;
    if (String(comp.getFirstPropertyValue("transp") ?? "").toUpperCase() === "TRANSPARENT") return;
    const s = start.toJSDate(), e = end.toJSDate();
    if (e <= from || s >= to || e <= s) return;
    out.push({ starts_at: s.toISOString(), ends_at: e.toISOString(), all_day: start.isDate, title });
  };
  for (const comp of events) {
    if (out.length >= MAX) break;
    if (comp.hasProperty("recurrence-id")) continue;
    const uid = String(comp.getFirstPropertyValue("uid") ?? "");
    if (OURS.test(uid)) continue;
    const ev = new ICAL.Event(comp);
    for (const x of exceptions.get(uid) ?? []) ev.relateException(x);
    const title = (ev.summary ?? "").trim().slice(0, 200) || "Busy";
    if (!ev.isRecurring()) {
      add(ev.startDate, ev.endDate ?? ev.startDate, title, comp);
      continue;
    }
    const it = ev.iterator();
    for (let n = 0, t = it.next(); t && n < 1000 && out.length < MAX; n++, t = it.next()) {
      if (t.toJSDate() >= to) break;
      const o = ev.getOccurrenceDetails(t);
      add(o.startDate, o.endDate, (o.item.summary ?? "").trim().slice(0, 200) || "Busy", o.item.component);
    }
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Calendar addresses people paste: webcal:// is the same as https://. */
export function feedUrl(raw: string): string {
  return raw.trim().replace(/^webcals?:\/\//i, "https://");
}
