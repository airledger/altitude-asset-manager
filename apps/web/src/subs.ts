// Subcontractors: outside engineers a business sends jobs to. They see only those jobs (the database makes
// sure of it), accept or decline them, send their charge once a job is done, and keep their insurance and
// certificates on file. Owners approve charges and see whose papers are running out.
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChargeStatus = "submitted" | "approved" | "rejected";
export interface SubCharge {
  id: string;
  job_id: string;
  person_id: string;
  amount: number;
  note: string;
  their_ref: string;
  status: ChargeStatus;
  /** The owner's reason when turning one down. */
  reply: string;
  submitted_at: string;
  decided_at: string | null;
}
export type SubChargeRow = SubCharge & {
  people: { name: string; company: string } | null;
  jobs: {
    type: string;
    date: string | null;
    systems: { name: string; clients: { name: string } | null } | null;
  } | null;
};

export type PaperKind = "insurance" | "certificate";
export const PAPER_KINDS: Record<PaperKind, string> = {
  insurance: "Insurance",
  certificate: "Certificate (F-gas, electrical, …)",
};
export interface SubPaper {
  id: string;
  person_id: string;
  kind: PaperKind;
  name: string;
  file_id: string;
  expires_on: string | null;
  created_at: string;
}
export type SubPaperRow = SubPaper & { people: { name: string; company: string } | null };

export const CHARGE_LABEL: Record<ChargeStatus, string> = {
  submitted: "Waiting for approval",
  approved: "Approved",
  rejected: "Turned down",
};

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** A paper is replaced when the same person uploads another of the same kind later that lasts longer. */
export function replaced(p: SubPaper, all: SubPaper[]): boolean {
  return all.some(
    (q) =>
      q.id !== p.id &&
      q.person_id === p.person_id &&
      q.kind === p.kind &&
      q.created_at > p.created_at &&
      (!q.expires_on || (!!p.expires_on && q.expires_on > p.expires_on)),
  );
}

/** Papers that have run out, or run out within 30 days (and haven't been replaced), soonest first. */
export function expiringPapers<T extends SubPaper>(papers: T[], today: string): T[] {
  return papers
    .filter((p) => p.expires_on && days(today, p.expires_on) <= 30 && !replaced(p, papers))
    .sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));
}

export function expiryText(expires: string | null, today: string): string {
  if (!expires) return "No expiry date";
  const d = days(today, expires);
  const date = new Date(`${expires}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (d < 0) return `Ran out ${date}`;
  if (d === 0) return "Runs out today";
  if (d <= 30) return `Runs out ${date} (${d} day${d === 1 ? "" : "s"})`;
  return `Valid until ${date}`;
}

/** Approved charges as a spreadsheet, for the bookkeeper. */
export function chargeCsvRows(rows: SubChargeRow[]): string[][] {
  return [
    [
      "Subcontractor",
      "Company",
      "Their invoice",
      "Job",
      "Client",
      "Install",
      "Job date",
      "Amount",
      "Approved",
      "Note",
    ],
    ...rows
      .filter((r) => r.status === "approved")
      .map((r) => [
        r.people?.name ?? "",
        r.people?.company ?? "",
        r.their_ref,
        r.jobs?.type ?? "",
        r.jobs?.systems?.clients?.name ?? "",
        r.jobs?.systems?.name ?? "",
        r.jobs?.date ?? "",
        Number(r.amount).toFixed(2),
        r.decided_at?.slice(0, 10) ?? "",
        r.note,
      ]),
  ];
}

const safeName = (n: string) => n.replace(/[^\w.-]+/g, "-").slice(-80) || "file";
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const CHARGE = "id, job_id, person_id, amount, note, their_ref, status, reply, submitted_at, decided_at";
const PAPER = "id, person_id, kind, name, file_id, expires_on, created_at";

export function subsApi(sb: SupabaseClient, orgId: string) {
  return {
    /** The subcontractor says yes, or no with a reason. */
    async reply(jobId: string, accept: boolean, note = ""): Promise<void> {
      const { error } = await sb.rpc("sub_reply", { p_job: jobId, p_accept: accept, p_note: note });
      fail(error);
    },
    async charge(jobId: string): Promise<SubCharge | null> {
      const { data, error } = await sb.from("sub_charges").select(CHARGE).eq("job_id", jobId).maybeSingle();
      fail(error);
      return (data as SubCharge | null) ?? null;
    },
    /** Sends (or sends again, after a change or being turned down) the charge for a completed job. */
    async sendCharge(c: {
      id?: string | undefined;
      job_id: string;
      person_id: string;
      amount: number;
      note: string;
      their_ref: string;
    }) {
      const row = {
        amount: c.amount,
        note: c.note.trim(),
        their_ref: c.their_ref.trim(),
        status: "submitted" as const,
      };
      const { error } = c.id
        ? await sb.from("sub_charges").update(row).eq("id", c.id)
        : await sb
            .from("sub_charges")
            .insert({ ...row, org_id: orgId, job_id: c.job_id, person_id: c.person_id });
      fail(error);
    },
    /** Owners: approve, or turn down with a reason. */
    async decide(id: string, approve: boolean, reply = ""): Promise<void> {
      const { error } = await sb
        .from("sub_charges")
        .update({ status: approve ? "approved" : "rejected", reply: reply.trim() })
        .eq("id", id);
      fail(error);
    },
    /** Owners: every charge, newest first. */
    async charges(): Promise<SubChargeRow[]> {
      const { data, error } = await sb
        .from("sub_charges")
        .select(`${CHARGE}, people(name, company), jobs(type, date, systems(name, clients(name)))`)
        .eq("org_id", orgId)
        .order("submitted_at", { ascending: false });
      fail(error);
      return (data ?? []) as unknown as SubChargeRow[];
    },
    /** Insurance and certificates: a subcontractor sees their own, owners see everyone's. */
    async papers(personId?: string): Promise<SubPaperRow[]> {
      let q = sb
        .from("documents")
        .select(`${PAPER}, people(name, company)`)
        .eq("org_id", orgId)
        .not("person_id", "is", null);
      if (personId) q = q.eq("person_id", personId);
      const { data, error } = await q.order("created_at", { ascending: false });
      fail(error);
      return (data ?? []) as unknown as SubPaperRow[];
    },
    async addPaper(personId: string, kind: PaperKind, name: string, expires: string | null, file: File) {
      if (file.size > 20 * 1024 * 1024) throw new Error("That file is over 20 MB. Try a smaller scan.");
      const path = `${orgId}/docs/${crypto.randomUUID()}-${safeName(file.name)}`;
      const up = await sb.storage
        .from("photos")
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      fail(up.error);
      const f = await sb
        .from("files")
        .insert({
          org_id: orgId,
          bucket: "photos",
          path,
          kind: "document",
          content_type: file.type,
          size_bytes: file.size,
        })
        .select("id")
        .single();
      fail(f.error);
      const { error } = await sb.from("documents").insert({
        org_id: orgId,
        person_id: personId,
        system_id: null,
        kind,
        name: name.trim() || file.name.trim() || PAPER_KINDS[kind],
        file_id: (f.data as { id: string }).id,
        expires_on: expires || null,
      });
      fail(error);
    },
  };
}

export type SubsApi = ReturnType<typeof subsApi>;
