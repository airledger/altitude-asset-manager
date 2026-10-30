// Calendar events for booked jobs: .ics files (iCloud and any calendar) and Google / Outlook links.
// Format: specs/05-integrations.md ("Calendar").

import type { IsoDate } from "./dates";
import { siteShort } from "./invoices";
import type { Client, Job, MaterialLine, System, Unit } from "./types";

export interface CalendarEvent {
  title: string;
  location: string;
  desc: string;
  date: IsoDate;
  /** "HH:MM", UK local time. */
  time: string;
  endTime: string;
}

export const unitLabel = (u: Unit): string =>
  u.role === "outdoor" ? "Outdoor unit" : u.indoorType || "Indoor unit";

/** Outdoor units first, then by location. */
export const sortUnits = (units: readonly Unit[]): Unit[] =>
  [...units].sort(
    (a, b) =>
      (a.role === b.role ? 0 : a.role === "outdoor" ? -1 : 1) ||
      (a.location || "").localeCompare(b.location || ""),
  );

export function calendarEvent(args: {
  job: Job;
  system: System | undefined;
  client: Client | undefined;
  /** In display order (see sortUnits). */
  units: readonly Unit[];
  materials: readonly MaterialLine[];
  /** Link to the job, when the business has set its app address. */
  jobUrl?: string | undefined;
}): CalendarEvent {
  const j = args.job;
  const s = args.system ?? ({ id: "" } as System);
  const c = args.client ?? ({ id: "" } as Client);
  const time = j.time || "09:00";
  const mins = Math.round((Number(j.durationHrs) || 1) * 60);
  const [h = 0, m = 0] = time.split(":").map(Number);
  const endM = h * 60 + m + mins;
  // Jobs that would run past midnight end at 23:59.
  const endTime =
    String(Math.min(23, Math.floor(endM / 60))).padStart(2, "0") +
    ":" +
    String(endM >= 24 * 60 ? 59 : endM % 60).padStart(2, "0");
  const desc = [
    `${j.type} – ${s.name}`,
    `Client: ${c.name || ""}`,
    `Contact: ${c.contactName || ""} ${c.phone || ""}`.trim(),
    s.accessNotes ? "Access: " + s.accessNotes : "",
    "",
    "Units:",
    ...args.units.map(
      (u) =>
        `• ${u.id} ${unitLabel(u)} ${u.manufacturer || ""} ${u.model || ""}${u.location ? " (" + u.location + ")" : ""}`,
    ),
    "",
    args.materials.length ? "Materials:" : "",
    ...args.materials.map((x) => `• ${x.qty} x ${x.name}`),
    j.notes ? "\nNotes: " + j.notes : "",
    args.jobUrl ? "\nOpen job: " + args.jobUrl : "",
  ].join("\n");
  return {
    title: `${j.type} – ${c.name || ""} (${s.sitePostcode || siteShort(s)})`,
    location: [s.siteAddress, s.sitePostcode].filter(Boolean).join(", ").replace(/\n/g, ", "),
    desc,
    date: j.date ?? "",
    time,
    endTime,
  };
}

const icsEscape = (s: string) =>
  String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

function icsFold(line: string): string {
  const out: string[] = [];
  while (line.length > 73) {
    out.push(line.slice(0, 73));
    line = " " + line.slice(73);
  }
  out.push(line);
  return out.join("\r\n");
}

export const icsDateTime = (date: IsoDate, time: string): string =>
  date.replace(/-/g, "") + "T" + (time || "09:00").replace(":", "") + "00";

/**
 * An .ics file of jobs. UIDs stay `<jobId>@altitude-climate` so re-importing updates events
 * rather than duplicating them.
 * @param stamp the DTSTAMP, e.g. "20261030T184500Z".
 */
export function buildIcs(
  events: readonly { jobId: string; type: string; event: CalendarEvent }[],
  stamp: string,
): string {
  const L = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Air Ledger//Asset Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Air Ledger jobs",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/London",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0000",
    "TZOFFSETTO:+0100",
    "TZNAME:BST",
    "DTSTART:19700329T010000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0000",
    "TZNAME:GMT",
    "DTSTART:19701025T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const { jobId, type, event: e } of events)
    L.push(
      "BEGIN:VEVENT",
      "UID:" + jobId + "@altitude-climate",
      "DTSTAMP:" + stamp,
      "DTSTART;TZID=Europe/London:" + icsDateTime(e.date, e.time),
      "DTEND;TZID=Europe/London:" + icsDateTime(e.date, e.endTime),
      icsFold("SUMMARY:" + icsEscape(e.title)),
      icsFold("LOCATION:" + icsEscape(e.location)),
      icsFold("DESCRIPTION:" + icsEscape(e.desc)),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + icsEscape(type),
      "TRIGGER:-P1D",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + icsEscape(type),
      "TRIGGER:-PT1H",
      "END:VALARM",
      "END:VEVENT",
    );
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}

const query = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => k + "=" + encodeURIComponent(v))
    .join("&");

/** "+01:00" in summer time, "+00:00" in winter, for that day in the UK. */
export function ukOffset(date: IsoDate): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" })
      .formatToParts(new Date(date + "T12:00:00Z"))
      .find((x) => x.type === "timeZoneName");
    const m = /([+-])(\d+)/.exec(part?.value || "");
    return m ? `${m[1]}${(m[2] ?? "").padStart(2, "0")}:00` : "+00:00";
  } catch {
    return "+00:00";
  }
}

export const googleCalendarLink = (e: CalendarEvent): string =>
  "https://calendar.google.com/calendar/render?" +
  query({
    action: "TEMPLATE",
    text: e.title,
    dates: icsDateTime(e.date, e.time) + "/" + icsDateTime(e.date, e.endTime),
    ctz: "Europe/London",
    details: e.desc,
    location: e.location,
  });

/** work: Microsoft 365 / work or school accounts; otherwise Outlook.com, Hotmail and Live. */
export function outlookCalendarLink(e: CalendarEvent, work: boolean): string {
  const off = ukOffset(e.date);
  return (
    "https://outlook." +
    (work ? "office" : "live") +
    ".com/calendar/0/deeplink/compose?" +
    query({
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: e.title,
      startdt: e.date + "T" + e.time + ":00" + off,
      enddt: e.date + "T" + e.endTime + ":00" + off,
      body: e.desc,
      location: e.location,
    })
  );
}
