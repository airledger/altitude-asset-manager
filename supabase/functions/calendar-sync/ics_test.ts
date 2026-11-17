// deno test supabase/functions/calendar-sync/ics_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { busyTimes, feedUrl } from "./ics.ts";

const cal = (body: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN",
    "BEGIN:VTIMEZONE", "TZID:Europe/London",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE",
    body, "END:VCALENDAR"].join("\r\n");
const from = new Date("2026-11-16T00:00:00Z"), to = new Date("2026-12-31T00:00:00Z");

Deno.test("a one-off entry in London time", () => {
  const out = busyTimes(cal(["BEGIN:VEVENT", "UID:a@google.com", "SUMMARY:Dentist",
    "DTSTART;TZID=Europe/London:20261118T100000", "DTEND;TZID=Europe/London:20261118T113000", "END:VEVENT"].join("\r\n")), from, to);
  assertEquals(out, [{ starts_at: "2026-11-18T10:00:00.000Z", ends_at: "2026-11-18T11:30:00.000Z", all_day: false, title: "Dentist" }]);
});

Deno.test("a weekly entry repeats, with a moved and a cancelled week", () => {
  const out = busyTimes(cal([
    "BEGIN:VEVENT", "UID:w@google.com", "SUMMARY:Football",
    "DTSTART;TZID=Europe/London:20261116T180000", "DTEND;TZID=Europe/London:20261116T190000",
    "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE;TZID=Europe/London:20261130T180000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:w@google.com", "RECURRENCE-ID;TZID=Europe/London:20261123T180000", "SUMMARY:Football (late)",
    "DTSTART;TZID=Europe/London:20261123T200000", "DTEND;TZID=Europe/London:20261123T210000", "END:VEVENT",
  ].join("\r\n")), from, to);
  assertEquals(out.map((b) => [b.starts_at.slice(0, 16), b.title]), [
    ["2026-11-16T18:00", "Football"], ["2026-11-23T20:00", "Football (late)"], ["2026-12-07T18:00", "Football"],
  ]);
});

Deno.test("all-day, free and cancelled entries, and Air Ledger's own job invites", () => {
  const out = busyTimes(cal([
    "BEGIN:VEVENT", "UID:h@x", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261122", "END:VEVENT",
    "BEGIN:VEVENT", "UID:f@x", "SUMMARY:Reminder", "TRANSP:TRANSPARENT", "DTSTART:20261118T090000Z", "DTEND:20261118T100000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:c@x", "STATUS:CANCELLED", "DTSTART:20261118T090000Z", "DTEND:20261118T100000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:0b5e@airledger.co.uk", "SUMMARY:Annual service", "DTSTART:20261118T090000Z", "DTEND:20261118T100000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:old@x", "DTSTART:20250101T090000Z", "DTEND:20250101T100000Z", "END:VEVENT",
  ].join("\r\n")), from, to);
  assertEquals(out.map((b) => [b.title, b.all_day, b.starts_at.slice(0, 10), b.ends_at.slice(0, 10)]), [
    ["Holiday", true, "2026-11-20", "2026-11-22"],
  ]);
});

Deno.test("webcal addresses", () => {
  assertEquals(feedUrl(" webcal://p52-caldav.icloud.com/published/2/x "), "https://p52-caldav.icloud.com/published/2/x");
});
