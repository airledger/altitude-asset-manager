import { useState, type FormEvent } from "react";
import type { Api, Business } from "../api";
import { ErrorLine, useAction } from "../useAction";

/** Owner only: business name, the branded sign-in link (?b=slug) and the logo. */
export function BusinessSettings({
  api,
  business,
  saved,
}: {
  api: Api;
  business: Business;
  saved: () => void;
}) {
  const [logoUrl, setLogoUrl] = useState(business.logoUrl);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  if (business.role !== "owner")
    return (
      <section className="card">
        <h1>{business.name}</h1>
        <p>Only an owner can change the business details.</p>
      </section>
    );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setDone(false);
    void run(async () => {
      await api.updateBusiness(
        business.id,
        String(form.get("name") ?? ""),
        String(form.get("slug") ?? ""),
        logoUrl,
      );
      setDone(true);
      saved();
    });
  }

  function upload(file: File | undefined) {
    if (!file) return;
    void run(async () => setLogoUrl(await api.uploadLogo(business.id, file)));
  }

  const link = business.slug ? `${window.location.origin}/?b=${business.slug}` : "";
  return (
    <form className="card" onSubmit={submit}>
      <h1>Business</h1>
      <ErrorLine error={error} />
      {done && <p className="ok">Saved.</p>}
      <label>
        Business name
        <input name="name" defaultValue={business.name} required />
      </label>
      <label>
        Sign-in link name
        <input name="slug" defaultValue={business.slug ?? ""} pattern="[a-z0-9-]*" />
      </label>
      {link && <p className="note">Your team signs in at {link}</p>}
      <div className="logo-row">
        {logoUrl ? <img src={logoUrl} alt="Business logo" /> : <span className="note">No logo yet</span>}
        <label className="btn">
          {logoUrl ? "Change logo" : "Add logo"}
          <input type="file" accept="image/*" hidden onChange={(e) => upload(e.currentTarget.files?.[0])} />
        </label>
        {logoUrl && (
          <button type="button" className="btn" onClick={() => setLogoUrl(null)}>
            Remove
          </button>
        )}
      </div>
      <button className="btn pri" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
