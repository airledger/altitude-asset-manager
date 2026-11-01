import { useState, type FormEvent } from "react";
import type { Api, Business } from "../api";
import { PageHead } from "../ui";
import { PROFILE_FIELDS, type Assets, type ProfileField } from "../assets";
import { Area, Text } from "../fields";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

/** Owner only: business name, the branded sign-in link (?b=slug) and the logo. */
export function BusinessSettings({
  api,
  assets,
  business,
  saved,
}: {
  api: Api;
  assets: Assets;
  business: Business;
  saved: () => void;
}) {
  const [logoUrl, setLogoUrl] = useState(business.logoUrl);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  if (business.role !== "owner")
    return (
      <>
        <PageHead title={business.name} sub="Business details" />
        <section className="card">
          <p>Only an owner can change the business details.</p>
        </section>
      </>
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
    <>
      <PageHead title="Business" sub="Your name, sign-in link and logo" />
      <form className="card form narrowform" onSubmit={submit}>
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
      <ProfileForm assets={assets} />
    </>
  );
}

const PROFILE_LABELS: Record<ProfileField, [string, string?]> = {
  trading_as: ["Trading name (if different)"],
  phone: ["Phone", "tel"],
  email: ["Email", "email"],
  website: ["Website"],
  address: ["Address"],
  company_no: ["Company number"],
  vat_no: ["VAT number"],
  fgas_cert: ["F-gas company certificate number"],
};

/** Contact and company details, used on stickers, reports and invoices. */
function ProfileForm({ assets }: { assets: Assets }) {
  const profile = useLoad(() => assets.profile(), [assets]);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  if (!profile.value) return <ErrorLine error={profile.error} />;
  const v = profile.value;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setDone(false);
    void run(async () => {
      await assets.saveProfile(
        Object.fromEntries(PROFILE_FIELDS.map((k) => [k, String(form.get(k) ?? "").trim()])),
      );
      setDone(true);
    });
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Business details</h2>
      <p className="note">Shown on your asset labels, service reports and invoices.</p>
      <ErrorLine error={error} />
      {done && <p className="ok">Saved.</p>}
      {PROFILE_FIELDS.map((k) => {
        const [label, type] = PROFILE_LABELS[k];
        return k === "address" ? (
          <Area key={k} name={k} label={label} value={v[k]} />
        ) : (
          <Text key={k} name={k} label={label} type={type ?? "text"} value={v[k]} />
        );
      })}
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}
