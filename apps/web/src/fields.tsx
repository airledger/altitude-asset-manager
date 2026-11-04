// Small form fields. Forms are uncontrolled: read them back with readForm() on submit.

type Opt = readonly string[];

export function Text(p: {
  name: string;
  label: string;
  value?: string | number | null | undefined;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {p.label}
      <input
        name={p.name}
        type={p.type ?? "text"}
        defaultValue={p.value ?? ""}
        required={p.required}
        step="any"
      />
    </label>
  );
}

export function Area(p: { name: string; label: string; value?: string | undefined; rows?: number }) {
  return (
    <label>
      {p.label}
      <textarea name={p.name} defaultValue={p.value ?? ""} rows={p.rows ?? 3} />
    </label>
  );
}

export function Pick(p: {
  name: string;
  label: string;
  value?: string | null | undefined;
  options: Opt;
  blank?: string;
  /** Shown instead of the stored value. */
  labels?: Record<string, string>;
}) {
  return (
    <label>
      {p.label}
      <select name={p.name} defaultValue={p.value ?? ""}>
        {p.blank !== undefined && <option value="">{p.blank}</option>}
        {p.options.map((o) => (
          <option key={o} value={o}>
            {p.labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check(p: { name: string; label: string; value?: boolean | undefined }) {
  return (
    <label className="check">
      <input name={p.name} type="checkbox" defaultChecked={!!p.value} />
      {p.label}
    </label>
  );
}

/** Reads a form: text is trimmed, checkboxes become booleans, numbers/dates become null when blank. */
export function readForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const text = (n: string) => String(data.get(n) ?? "").trim();
  return {
    text,
    orNull: (n: string) => text(n) || null,
    num: (n: string) => (text(n) === "" ? null : Number(text(n))),
    bool: (n: string) => data.get(n) === "on",
  };
}
