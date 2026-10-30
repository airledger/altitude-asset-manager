// Runs the live app's rule functions and the new ones over the same made-up businesses and checks
// every answer matches: due dates and statuses, F-gas, parts lists, invoice lines and totals, the
// Xero / QuickBooks / Sage files, calendar events and links, QR scans and report fingerprints.

import { describe, expect, it } from "vitest";
import {
  aggregateOrder,
  buildIcs,
  calendarEvent,
  dueStatus,
  googleCalendarLink,
  invoiceLines,
  invoiceTotals,
  jobMaterials,
  linePrice,
  materialsForJob,
  outlookCalendarLink,
  parseScan,
  quickbooksRows,
  reportFingerprint,
  reportSnapshot,
  sageRows,
  sortUnits,
  systemInfo,
  toCsv,
  xeroRows,
  type Client,
  type Invoice,
  type Job,
  type Material,
  type MaterialLine,
  type MaterialPrice,
  type SiteRecord,
  type System,
  type Unit,
} from "../src";
import { TODAY, makeBusiness } from "./fixtures";
import { loadLegacy } from "./legacy";

const BUSINESSES = 250;
/** Plain data, so objects made inside the sandbox compare equal to ours. */
const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const toneOf = (cls: string) => cls || "plain";

describe.each(Array.from({ length: BUSINESSES }, (_, i) => i + 1))("made-up business %i", (seed) => {
  const data = makeBusiness(seed);
  const L = loadLegacy(TODAY, data);
  const settings = data.settings;
  const clients = data.clients as Client[];
  const systems = data.systems as System[];
  const allUnits = data.units as Unit[];
  const jobs = data.jobs as Job[];
  const materials = data.materials as Material[];
  const clientOf = (id: string | undefined) => clients.find((c) => c.id === id);
  const unitsOf = (sid: string) => sortUnits(allUnits.filter((u) => u.systemId === sid));
  const price = (id: string) =>
    (data.pricing as { id: string }[]).find((p) => p.id === id) as Record<string, never> | undefined;
  const infoOf = (s: System) =>
    systemInfo(
      s,
      jobs.filter((j) => j.systemId === s.id),
      settings,
      TODAY,
    );
  const kitFor = (j: Job) => {
    const s = systems.find((x) => x.id === j.systemId);
    return s ? materialsForJob(j, unitsOf(s.id), infoOf(s), materials, TODAY) : [];
  };
  const priceOf = (l: MaterialLine) =>
    linePrice(
      materials.find((m) => m.id === l.id),
      l,
      price("mat:" + l.id) as MaterialPrice | undefined,
    );

  it("works out the same service dates, F-gas and due status", () => {
    for (const s of systems) {
      const old = L.sysInfo(s);
      const info = infoOf(s);
      expect({
        lastService: info.lastService,
        nextDue: info.nextDue,
        intervalMonths: info.intervalMonths,
        lastLeakCheck: info.lastLeakCheck,
        nextLeakCheck: info.nextLeakCheck,
        booked: info.booked?.id ?? null,
        upcoming: info.upcoming.map((j) => j.id),
        completed: info.completed.map((j) => j.id),
        lastContact: info.lastContact,
        warrantyEnd: info.warrantyEnd,
        fgas: info.fgas,
      }).toEqual(
        plain({
          lastService: old.lastSvc,
          nextDue: old.nextDue,
          intervalMonths: old.interval,
          lastLeakCheck: old.lastLeak,
          nextLeakCheck: old.nextLeak,
          booked: old.booked?.id ?? null,
          upcoming: old.upcoming.map((j: Job) => j.id),
          completed: old.done.map((j: Job) => j.id),
          lastContact: old.lastContact,
          warrantyEnd: old.warrantyEnd,
          fgas: {
            gwp: old.f.gwp,
            kg: old.f.kg,
            tonnesCo2e: old.f.t,
            months: old.f.months,
            required: old.f.required,
            threshold: old.f.thr,
          },
        }),
      );
      const ds = L.dueStatus(s, old);
      expect(dueStatus(s, info, settings, TODAY)).toEqual({
        key: ds.key,
        label: ds.label,
        tone: toneOf(ds.cls),
        needsAction: !!ds.act,
      });
    }
  });

  it("works out the same parts lists and order", () => {
    for (const j of jobs) {
      expect(kitFor(j)).toEqual(plain(L.materialsFor(j)));
      expect(jobMaterials(j, () => kitFor(j))).toEqual(plain(L.jobMaterials(j)));
    }
    const booked = jobs.filter((j) => j.status === "booked" && !j.materialsOrdered);
    expect(aggregateOrder(booked.map((j) => jobMaterials(j, () => kitFor(j))))).toEqual(
      plain(L.aggregate(booked)),
    );
  });

  it("prices completed jobs the same", () => {
    for (const j of jobs.filter((x) => x.status === "completed")) {
      const s = systems.find((x) => x.id === j.systemId);
      const c = clientOf(s?.clientId);
      for (const l of j.materialsUsed ?? []) expect(priceOf(l)).toEqual(plain(L.Billing.linePrice(l)));
      const lines = invoiceLines({
        job: j,
        system: s,
        client: c,
        units: s ? unitsOf(s.id) : [],
        info: s ? infoOf(s) : { fgas: { required: false } as never },
        prices: L.Billing.prices(),
        planPrice: c ? L.Billing.planPrice(c) : "",
        quote: L.Billing.quote(j),
        kit: () => kitFor(j),
        priceOf,
      });
      expect(lines).toEqual(plain(L.invoiceLines(j)));
      expect(invoiceTotals({ lines, vat: true })).toEqual(plain(L.invTotals({ lines, vat: true })));
    }
  });

  it("writes the same Xero, QuickBooks and Sage files", () => {
    const list = data.invoices as Invoice[];
    for (const inv of list) expect(invoiceTotals(inv)).toEqual(plain(L.invTotals(inv)));
    expect(toCsv(xeroRows(list, settings, clientOf))).toBe(L.toCSV(L.xeroRows(list, settings)));
    expect(toCsv(quickbooksRows(list, settings, clientOf))).toBe(L.toCSV(L.quickbooksRows(list, settings)));
    expect(toCsv(sageRows(list, settings, clientOf))).toBe(L.toCSV(L.sageRows(list, settings)));
  });

  it("makes the same calendar events, files and links", () => {
    const booked = jobs.filter((j) => j.status === "booked" && j.date);
    const events = booked.map((j) => {
      const s = systems.find((x) => x.id === j.systemId);
      const e = calendarEvent({
        job: j,
        system: s,
        client: clientOf(s?.clientId),
        units: s ? unitsOf(s.id) : [],
        materials: jobMaterials(j, () => kitFor(j)),
        jobUrl: settings.appUrl ? "https://app.example/#j-" + j.id : undefined,
      });
      expect(e).toEqual(plain(L.calEvent(j)));
      expect(googleCalendarLink(e)).toBe(L.googleLink(e));
      expect(outlookCalendarLink(e, true)).toBe(L.outlookLink(e, true));
      expect(outlookCalendarLink(e, false)).toBe(L.outlookLink(e, false));
      return { jobId: j.id, type: j.type ?? "", event: e };
    });
    const old = L.buildICS(booked) as string;
    const stamp = /DTSTAMP:(\S+)/.exec(old)?.[1] ?? "";
    expect(buildIcs(events, stamp)).toBe(old);
  });

  it("fingerprints service reports the same", async () => {
    for (const j of jobs.filter((x) => x.status === "completed")) {
      const s = systems.find((x) => x.id === j.systemId);
      const records = (data.reports as SiteRecord[])
        .filter((r) => r.jobId === j.id)
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      const snap = reportSnapshot({
        job: j,
        system: s,
        client: clientOf(s?.clientId),
        units: s ? unitsOf(s.id) : [],
        records,
      });
      expect(snap).toEqual(plain(L.snapshot(j)));
      expect(await reportFingerprint(snap)).toBe(await L.fingerprint(j));
    }
  });
});

describe("QR scans", () => {
  const L = loadLegacy(TODAY, makeBusiness(0));
  it.each([
    "https://app.airledger.co.uk/#u-AC-ABC23",
    "https://claude.ai/artifact/abc#u-ac-xyz99",
    "AC-ABC23",
    "  ac-abc23 ",
    "ACABC23",
    "Unit AC-QWERT on roof",
    "AC-ABCDEF",
    "nothing here",
    "",
    "#u-",
  ])("reads %j the same", (text) => expect(parseScan(text)).toBe(L.parseScan(text)));
});
