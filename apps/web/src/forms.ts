// Forms and checklists: owners set them up for job types; engineers fill them in on the job (with no signal too,
// through the outbox); completed ones go on the service report.
import type { SupabaseClient } from "@supabase/supabase-js";

export type FieldKind = "heading" | "check" | "yesno" | "number" | "choice" | "text";
export interface FormField {
  id: string;
  kind: FieldKind;
  label: string;
  /** Number fields: shown after the value, e.g. °C, bar, A. */
  unit?: string;
  /** Choice fields. */
  options?: string[];
  /** Must be answered before the form is done. */
  required?: boolean;
}
export const KIND_LABEL: Record<FieldKind, string> = {
  heading: "Heading",
  check: "Pass / fail / N/A",
  yesno: "Yes / no",
  number: "Number",
  choice: "Pick one",
  text: "Notes",
};
export const CHECK_ANSWERS = { pass: "Pass", fail: "Fail", na: "N/A" } as const;

export interface FormTemplate {
  id: string;
  name: string;
  job_types: string[];
  required: boolean;
  fields: FormField[];
  active: boolean;
}
export interface JobForm {
  id?: string;
  job_id: string;
  template_id: string | null;
  name: string;
  fields: FormField[];
  answers: Record<string, string>;
  completed_at: string | null;
  completed_by: string;
}

/** The forms for a job: ones already started, then active templates for its type that haven't been. */
export function formsForJob(
  type: string,
  templates: FormTemplate[],
  saved: JobForm[],
  jobId: string,
): JobForm[] {
  const fresh = templates
    .filter((t) => t.active && (!t.job_types.length || t.job_types.includes(type)))
    .filter((t) => !saved.some((s) => s.template_id === t.id))
    .map((t): JobForm => ({
      job_id: jobId,
      template_id: t.id,
      name: t.name,
      fields: t.fields,
      answers: {},
      completed_at: null,
      completed_by: "",
    }));
  return [...saved, ...fresh];
}

/** Questions that must be answered and aren't. */
export function missingAnswers(f: Pick<JobForm, "fields" | "answers">): FormField[] {
  return f.fields.filter((x) => x.kind !== "heading" && x.required && !(f.answers[x.id] ?? "").trim());
}

/** Required forms for this job that aren't done yet. */
export function formsToDo(type: string, templates: FormTemplate[], saved: JobForm[]): string[] {
  return templates
    .filter((t) => t.active && t.required && (!t.job_types.length || t.job_types.includes(type)))
    .filter((t) => !saved.some((s) => s.template_id === t.id && s.completed_at))
    .map((t) => t.name);
}

/** An answer as it reads on the report. */
export function answerText(f: FormField, v: string | undefined): string {
  if (!v) return "";
  if (f.kind === "check") return CHECK_ANSWERS[v as keyof typeof CHECK_ANSWERS] ?? v;
  if (f.kind === "yesno") return v === "yes" ? "Yes" : v === "no" ? "No" : v;
  if (f.kind === "number" && f.unit) return `${v} ${f.unit}`;
  return v;
}

/** The report's rows for a completed form: [question, answer, flag a fail]. */
export function formRows(f: Pick<JobForm, "fields" | "answers">): [string, string, boolean][] {
  return f.fields
    .filter((x) => x.kind !== "heading" && (f.answers[x.id] ?? "") !== "")
    .map((x) => [x.label, answerText(x, f.answers[x.id]), f.answers[x.id] === "fail"]);
}

let n = 0;
export const newFieldId = () => `f${Date.now().toString(36)}${(n++).toString(36)}`;

const f = (kind: FieldKind, label: string, extra: Partial<FormField> = {}): FormField => ({
  id: newFieldId(),
  kind,
  label,
  ...extra,
});

/** Ready-made forms an owner can add and change. */
export function readyMade(): Omit<FormTemplate, "id">[] {
  return [
    {
      name: "Service checklist",
      job_types: ["Annual service", "Service + repair"],
      required: false,
      active: true,
      fields: [
        f("heading", "Indoor units"),
        f("check", "Filters cleaned or replaced", { required: true }),
        f("check", "Indoor coil and fan cleaned"),
        f("check", "Condensate drain and pump tested", { required: true }),
        f("check", "Louvres, fan and controller working"),
        f("heading", "Outdoor unit"),
        f("check", "Coil cleaned and clear of debris"),
        f("check", "Fan, guard and fixings secure"),
        f("check", "Electrical connections checked and tight"),
        f("check", "Pipework and insulation in good order"),
        f("heading", "Readings"),
        f("number", "Supply air temperature", { unit: "°C" }),
        f("number", "Return air temperature", { unit: "°C" }),
        f("number", "Outdoor temperature", { unit: "°C" }),
        f("number", "Running current", { unit: "A" }),
        f("text", "Recommendations"),
      ],
    },
    {
      name: "Commissioning checklist",
      job_types: ["Installation", "Commissioning"],
      required: false,
      active: true,
      fields: [
        f("number", "Nitrogen pressure test held at", { unit: "bar", required: true }),
        f("number", "Vacuum reached", { unit: "microns", required: true }),
        f("check", "Leak test of all joints", { required: true }),
        f("number", "Refrigerant added on site", { unit: "kg" }),
        f("check", "Condensate drain tested"),
        f("check", "Local isolator fitted and labelled"),
        f("check", "Tested in cooling and heating"),
        f("yesno", "Controls shown to the customer"),
        f("yesno", "Manuals and warranty details left with the customer"),
        f("text", "Notes"),
      ],
    },
    {
      name: "Breakdown report",
      job_types: ["Repair / breakdown", "Service + repair"],
      required: false,
      active: true,
      fields: [
        f("text", "Fault reported"),
        f("text", "What was found", { required: true }),
        f("choice", "Outcome", {
          options: ["Fixed", "Made safe, return visit needed", "Parts needed", "Unit needs replacing"],
          required: true,
        }),
        f("text", "Parts needed"),
        f("yesno", "Customer told what happens next"),
      ],
    },
  ];
}

export function formsApi(sb: SupabaseClient, orgId: string) {
  return {
    async templates(): Promise<FormTemplate[]> {
      const { data, error } = await sb
        .from("form_templates")
        .select("id, name, job_types, required, fields, active")
        .eq("org_id", orgId)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data as FormTemplate[] | null) ?? [];
    },
    async saveTemplate(t: Omit<FormTemplate, "id"> & { id?: string | undefined }): Promise<string> {
      const row = {
        name: t.name.trim(),
        job_types: t.job_types,
        required: t.required,
        fields: t.fields,
        active: t.active,
      };
      const { data, error } = t.id
        ? await sb.from("form_templates").update(row).eq("id", t.id).select("id").single()
        : await sb
            .from("form_templates")
            .insert({ ...row, org_id: orgId })
            .select("id")
            .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },
    async deleteTemplate(id: string): Promise<void> {
      const { error } = await sb.from("form_templates").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    async forJob(jobId: string): Promise<JobForm[]> {
      const { data, error } = await sb
        .from("job_forms")
        .select("id, job_id, template_id, name, fields, answers, completed_at, completed_by")
        .eq("org_id", orgId)
        .eq("job_id", jobId)
        .order("updated_at");
      if (error) throw new Error(error.message);
      return (data as JobForm[] | null) ?? [];
    },
    /** Saves a job's form; a second save of the same form replaces the first. */
    async saveForJob(form: JobForm): Promise<void> {
      const row = {
        org_id: orgId,
        job_id: form.job_id,
        template_id: form.template_id,
        name: form.name,
        fields: form.fields,
        answers: form.answers,
        completed_at: form.completed_at,
        completed_by: form.completed_by,
      };
      const { error } = form.id
        ? await sb.from("job_forms").update(row).eq("id", form.id)
        : await sb.from("job_forms").upsert(row, { onConflict: "job_id,template_id" });
      if (error) throw new Error(error.message);
    },
  };
}

export type FormsApi = ReturnType<typeof formsApi>;
