// Service reports (stage 6, spec F10): sign-off, the issued PDFs, and every time one was sent.
// A report is issued once and never changed. Editing the job afterwards means issuing the next revision
// under the same reference; the database refuses anything else.
import type { SupabaseClient } from "@supabase/supabase-js";
import { newReportRef, reportFingerprint, type IsoDate } from "@airledger/domain";
import type { ClientRow, SystemRow, UnitRow } from "./assets";
import { toJob, type JobListRow, type JobRecord } from "./jobs";

export interface SignoffRow {
  job_id: string;
  engineer_name: string;
  engineer_cert: string;
  engineer_signature_file_id: string;
  customer_name: string;
  client_email: string;
  customer_absent: boolean;
  absent_note: string;
  customer_signature_file_id: string | null;
  signed_at: string;
}

export interface SendRow {
  id: string;
  via: "email" | "share" | "download" | "mail-app";
  sent_to: string;
  sent_at: string;
}

export interface ReportRow {
  id: string;
  job_id: string;
  ref: string;
  rev: number;
  hash: string;
  pdf_file_id: string;
  issued_at: string;
  report_sends: SendRow[];
}

export type ReportListRow = ReportRow & {
  jobs: {
    id: string;
    type: string;
    date: string | null;
    engineer: string;
    systems: { id: string; name: string; site_postcode: string; clients: { name: string } | null } | null;
  } | null;
};

export interface ReportSettings {
  /** The office copy (Cc). */
  report_email: string;
  auto_email_reports: boolean;
  /** Replies go to the business. */
  email: string;
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

/** The latest revision first. */
export const latest = (reports: ReportRow[]) => [...reports].sort((a, b) => b.rev - a.rev)[0] ?? null;

/** What the report states, in a fixed shape, so editing anything on it changes the fingerprint. */
export function snapshot(a: {
  job: JobListRow;
  record: JobRecord;
  system: SystemRow;
  client: ClientRow | null;
  units: UnitRow[];
}) {
  const j = a.job;
  return {
    job: {
      type: j.type,
      date: j.date,
      engineer: j.engineer,
      duration: j.duration_hrs,
      notes: j.completion_notes,
    },
    record: a.record,
    system: [a.system.name, a.system.site_address, a.system.site_postcode, a.system.refrigerant],
    charge: [a.system.factory_charge_kg, a.system.added_charge_kg],
    client: a.client
      ? [a.client.name, a.client.contact_name, a.client.billing_address, a.client.postcode]
      : null,
    units: a.units.map((u) => [u.id, u.role, u.indoor_type, u.manufacturer, u.model, u.serial, u.location]),
  };
}

export const fingerprint = (s: ReturnType<typeof snapshot>) => reportFingerprint(s);

/** The reference for a new report, or the existing one for a revision. */
export function nextRef(job: JobListRow, reports: ReportRow[], today: IsoDate) {
  const prev = latest(reports);
  return prev ? { ref: prev.ref, rev: prev.rev + 1 } : { ref: newReportRef(toJob(job), today), rev: 1 };
}

export const reportFileName = (r: { ref: string; rev: number }, client: string) =>
  `${r.ref}${r.rev > 1 ? `-rev${r.rev}` : ""}${
    client
      ? "-" +
        client
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      : ""
  }.pdf`;

const VIA_LABEL: Record<SendRow["via"], string> = {
  email: "Emailed",
  share: "Shared",
  download: "Downloaded",
  "mail-app": "Opened in Mail",
};
export const viaLabel = (v: SendRow["via"]) => VIA_LABEL[v] ?? v;

export function reportsApi(sb: SupabaseClient, orgId: string) {
  async function upload(blob: Blob, path: string, kind: "signature" | "report_pdf"): Promise<string> {
    const up = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type });
    fail(up.error);
    const { data, error } = await sb
      .from("files")
      .insert({ org_id: orgId, bucket: "photos", path, kind, content_type: blob.type, size_bytes: blob.size })
      .select("id")
      .single();
    fail(error);
    return (data as { id: string }).id;
  }

  return {
    orgId,

    async signoff(jobId: string): Promise<SignoffRow | null> {
      const { data, error } = await sb.from("job_signoffs").select("*").eq("job_id", jobId).maybeSingle();
      fail(error);
      return (data as SignoffRow | null) ?? null;
    },

    async saveSignoff(row: Omit<SignoffRow, "signed_at">): Promise<void> {
      const { error } = await sb
        .from("job_signoffs")
        .upsert({ ...row, org_id: orgId, signed_at: new Date().toISOString() }, { onConflict: "job_id" });
      fail(error);
    },

    uploadSignature: (png: Blob) =>
      upload(png, `${orgId}/signatures/${crypto.randomUUID()}.png`, "signature"),

    /** Stores the PDF and records the report. Neither can be changed afterwards. */
    async issue(r: { jobId: string; ref: string; rev: number; hash: string; pdf: Blob }): Promise<ReportRow> {
      const path = `${orgId}/reports/${r.ref}-rev${r.rev}-${crypto.randomUUID().slice(0, 8)}.pdf`;
      const fileId = await upload(r.pdf, path, "report_pdf");
      const { data, error } = await sb
        .from("service_reports")
        .insert({ org_id: orgId, job_id: r.jobId, ref: r.ref, rev: r.rev, hash: r.hash, pdf_file_id: fileId })
        .select("*, report_sends(*)")
        .single();
      fail(error);
      return data as ReportRow;
    },

    /** A job's reports, newest revision first, with their sends. */
    async reports(jobId: string): Promise<ReportRow[]> {
      const { data, error } = await sb
        .from("service_reports")
        .select("*, report_sends(*)")
        .eq("job_id", jobId)
        .order("rev", { ascending: false });
      fail(error);
      return (data ?? []) as ReportRow[];
    },

    /** Every report the business has issued, newest first. */
    async allReports(): Promise<ReportListRow[]> {
      const { data, error } = await sb
        .from("service_reports")
        .select(
          "*, report_sends(*), jobs(id, type, date, engineer, systems(id, name, site_postcode, clients(name)))",
        )
        .eq("org_id", orgId)
        .order("issued_at", { ascending: false })
        .limit(1000);
      fail(error);
      return (data ?? []) as ReportListRow[];
    },

    async pdf(r: Pick<ReportRow, "pdf_file_id">): Promise<{ blob: Blob; path: string }> {
      const f = await sb.from("files").select("path").eq("id", r.pdf_file_id).single();
      fail(f.error);
      const path = (f.data as { path: string }).path;
      const { data, error } = await sb.storage.from("photos").download(path);
      fail(error);
      return { blob: data as Blob, path };
    },

    /** Any stored image (photos, signatures), or null if it can't be read. */
    async fileBlob(fileId: string): Promise<Blob | null> {
      const f = await sb.from("files").select("path").eq("id", fileId).maybeSingle();
      const path = (f.data as { path: string } | null)?.path;
      if (!path) return null;
      const { data } = await sb.storage.from("photos").download(path);
      return (data as Blob | null) ?? null;
    },

    async logSend(reportId: string, via: SendRow["via"], to: string[] = []): Promise<void> {
      const { error } = await sb
        .from("report_sends")
        .insert({ org_id: orgId, report_id: reportId, via, sent_to: to.join(", ") });
      fail(error);
    },

    /** Emails the PDF from "<business> <reports@airledger.co.uk>" through the send-report function. */
    async email(m: {
      report: ReportRow;
      pdfPath: string;
      filename: string;
      to: string[];
      cc: string[];
      subject: string;
      message: string;
      replyTo: string;
    }): Promise<void> {
      const { error } = await sb.functions.invoke("send-report", {
        body: {
          orgId,
          pdf: m.pdfPath,
          filename: m.filename,
          to: m.to,
          cc: m.cc,
          subject: m.subject,
          message: m.message,
          replyTo: m.replyTo,
        },
      });
      if (error) {
        // The function's own message ("Check the email addresses") is more use than "non-2xx status".
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        throw new Error((body as { error?: string } | null)?.error || error.message);
      }
      await this.logSend(m.report.id, "email", [...m.to, ...m.cc]);
    },

    async settings(): Promise<ReportSettings> {
      const { data, error } = await sb
        .from("org_settings")
        .select("report_email, auto_email_reports, email")
        .eq("org_id", orgId)
        .maybeSingle();
      fail(error);
      const r = (data ?? {}) as Partial<ReportSettings>;
      return {
        report_email: r.report_email ?? "",
        auto_email_reports: !!r.auto_email_reports,
        email: r.email ?? "",
      };
    },

    /** Owner only (the database refuses anyone else). */
    async saveSettings(s: Pick<ReportSettings, "report_email" | "auto_email_reports">): Promise<void> {
      const { data, error } = await sb.from("org_settings").update(s).eq("org_id", orgId).select("org_id");
      fail(error);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can change this.");
    },

    /** A customer email typed at sign-off is kept on the client if they had none. */
    async keepClientEmail(client: ClientRow | null, email: string): Promise<void> {
      if (!client || client.email || !email) return;
      const { error } = await sb.from("clients").update({ email }).eq("id", client.id).eq("org_id", orgId);
      fail(error);
    },
  };
}

export type ReportsApi = ReturnType<typeof reportsApi>;
