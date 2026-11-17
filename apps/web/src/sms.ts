// Text messages to customers (part 2), sent by the send-sms server function: "on my way" from a job and
// service-due reminders. Until the business's text account is set up the function says so, and people can still
// use Open Messages on their phone.
import type { SupabaseClient } from "@supabase/supabase-js";

/** A phone number as +<country><number>; UK numbers can be typed 07…; UK landlines can't take texts. */
export function toMobile(raw: string): string | null {
  let n = raw.replace(/[\s().-]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (/^07\d{9}$/.test(n)) n = "+44" + n.slice(1);
  if (n.startsWith("+44")) return /^\+447\d{9}$/.test(n) ? n : null;
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

/** A sender name texts can come from: 3 to 11 letters, numbers or spaces, starting with a letter. */
export const SENDER = /^[A-Za-z][A-Za-z0-9 ]{2,10}$/;

/** A suggested sender name from the business name, e.g. "Altitude Climate Ltd" → "Altitude". */
export function suggestSender(business: string): string {
  const words = business
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > 11) break;
    out = next;
  }
  return SENDER.test(out) ? out : (words[0] ?? "").slice(0, 11);
}

export function onMyWayText(a: { contact: string; engineer: string; business: string; minutes: number }) {
  const first = a.contact.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, it's ${a.engineer} from ${a.business}. I'm on my way and should be with you in about ${a.minutes} minutes.`;
}

export interface SmsMessage {
  to: string;
  message: string;
  kind: "on_the_way" | "service_due" | "other";
  clientId?: string | null;
  jobId?: string | null;
  systemId?: string | null;
}

export function smsApi(sb: SupabaseClient, orgId: string) {
  return {
    async send(m: SmsMessage): Promise<void> {
      const { error } = await sb.functions.invoke("send-sms", { body: { orgId, ...m } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        throw new Error((body as { error?: string } | null)?.error || error.message);
      }
    },
    async sender(): Promise<string> {
      const { data, error } = await sb
        .from("org_settings")
        .select("sms_sender")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { sms_sender?: string } | null)?.sms_sender ?? "";
    },
    async saveSender(name: string): Promise<void> {
      const { data, error } = await sb
        .from("org_settings")
        .update({ sms_sender: name })
        .eq("org_id", orgId)
        .select("org_id");
      if (error) throw new Error(error.message);
      if (Array.isArray(data) && data.length === 0) throw new Error("Only an owner can change this.");
    },
  };
}

export type SmsApi = ReturnType<typeof smsApi>;
