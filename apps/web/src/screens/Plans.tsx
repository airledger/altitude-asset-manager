// Plans on screen: the trial banner, an owner's Plan and billing page (#/plan) with the Direct Debit step,
// and Air Ledger Ltd's own page (#/platform) with every business, who to bill this month, and sign-up settings.
import { useState } from "react";
import { isNative } from "../native";
import { download } from "../stickerPdf";
import {
  DD_LABEL,
  STATUS_LABEL,
  billingCsv,
  dueThisMonth,
  planState,
  price,
  priceText,
  type OrgPlan,
  type Plan,
  type PlanStatus,
  type PlansApi,
  type PlatformBusiness,
  type PlatformSettings,
} from "../plans";
import { Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { todayIso, useLoad } from "./Assets";

const dateText = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Across the top of every page: how long the trial has left (last week only), or that it's ended. */
export function PlanBanner({ plans, orgId, owner }: { plans: PlansApi; orgId: string; owner: boolean }) {
  const mine = useLoad(() => plans.mine(orgId).catch(() => null), [plans, orgId]);
  const o = mine.value;
  if (!o) return null;
  const s = planState(o, todayIso());
  const show =
    !s.live ||
    o.status === "past_due" ||
    (s.daysLeft !== null && s.daysLeft <= 7 && o.dd_status !== "active");
  if (!show || !s.message) return null;
  return (
    <p className={`banner${s.live ? "" : " bad"}`} role="status">
      {s.message}{" "}
      {isNative() ? (
        "Your plan is managed on the Air Ledger website."
      ) : owner ? (
        <a href="#/plan">{s.live ? "Choose a plan" : "Choose a plan now"}</a>
      ) : (
        "Ask the business's owner to choose a plan."
      )}
    </p>
  );
}

/** Owners: the plan, the price, who the invoices go to, and the Direct Debit. */
export function PlanPage({
  plans,
  orgId,
  businessName,
}: {
  plans: PlansApi;
  orgId: string;
  businessName: string;
}) {
  const data = useLoad(
    () => Promise.all([plans.plans(), plans.mine(orgId), plans.settings()]),
    [plans, orgId],
  );
  const [list, mine, settings] = data.value ?? [];
  // App Store and Google Play rules: the phone apps don't sell plans or link to paying, they only show the plan.
  if (isNative())
    return (
      <>
        <PageHead
          back={{ href: "#/business", label: "Business" }}
          title="Plan and billing"
          sub={businessName}
        />
        <ErrorLine error={data.error} />
        {!data.value ? (
          <Loading />
        ) : mine ? (
          <section className="card">
            <p>
              <b>{mine.status === "free" ? "Free" : list?.find((x) => x.code === mine.plan)?.name}</b> ·{" "}
              {STATUS_LABEL[mine.status]}
              {mine.status === "trial" && ` until ${dateText(mine.trial_ends)}`}
            </p>
            <p className="note">Your plan is managed on the Air Ledger website.</p>
          </section>
        ) : null}
      </>
    );
  return (
    <>
      <PageHead
        back={{ href: "#/business", label: "Business" }}
        title="Plan and billing"
        sub={businessName}
      />
      <ErrorLine error={data.error} />
      {!data.value || !list || !settings ? (
        <Loading />
      ) : !mine ? (
        <p className="banner">This business doesn't have a plan yet. Contact Air Ledger.</p>
      ) : (
        <PlanForm
          plans={plans}
          orgId={orgId}
          list={list}
          mine={mine}
          settings={settings}
          reload={data.reload}
        />
      )}
    </>
  );
}

function PlanForm(p: {
  plans: PlansApi;
  orgId: string;
  list: Plan[];
  mine: OrgPlan;
  settings: PlatformSettings;
  reload: () => void;
}) {
  const { mine } = p;
  const [plan, setPlan] = useState(mine.plan);
  const [billing, setBilling] = useState(mine.billing);
  const [extra, setExtra] = useState(mine.extra_engineers);
  const [name, setName] = useState(mine.billing_name);
  const [email, setEmail] = useState(mine.billing_email);
  const act = useAction();
  const today = todayIso();
  const s = planState(mine, today);
  const current = p.list.find((x) => x.code === mine.plan);
  const picked = p.list.find((x) => x.code === plan);
  const free = mine.status === "free";
  const chosen = !!mine.chosen_at;
  const changed =
    !chosen ||
    plan !== mine.plan ||
    billing !== mine.billing ||
    extra !== mine.extra_engineers ||
    name !== mine.billing_name ||
    email !== mine.billing_email;
  return (
    <>
      <section className="card">
        <h2>Your plan</h2>
        <p>
          <b>{free ? "Free" : current?.name}</b> · {STATUS_LABEL[mine.status]}
          {mine.status === "trial" && ` until ${dateText(mine.trial_ends)}`}
          {chosen &&
            !free &&
            current &&
            ` · ${priceText(price(current, mine.billing, mine.extra_engineers), mine.billing)}`}
        </p>
        {s.message && <p className={`banner${s.live ? "" : " bad"}`}>{s.message}</p>}
        {free && <p className="note">Air Ledger doesn't charge this business.</p>}
        {!free && mine.status === "trial" && !chosen && (
          <p className="note">
            Your trial includes everything. Choose the plan you want before it ends; you aren't charged until
            then.
          </p>
        )}
      </section>
      {!free && (
        <>
          <section className="card" aria-label="Choose a plan">
            <div className="row spread">
              <h2>{chosen ? "Change plan" : "Choose a plan"}</h2>
              <div className="chips" role="radiogroup" aria-label="Pay">
                {(["monthly", "yearly"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="radio"
                    aria-checked={billing === b}
                    className="chip"
                    onClick={() => setBilling(b)}
                  >
                    {b === "monthly" ? "Monthly" : "Yearly (2 months free)"}
                  </button>
                ))}
              </div>
            </div>
            <div className="plans">
              {p.list
                .filter((x) => x.active || x.code === mine.plan)
                .map((x) => (
                  <label key={x.code} className={`plancard${plan === x.code ? " on" : ""}`}>
                    <input
                      type="radio"
                      name="plan"
                      value={x.code}
                      checked={plan === x.code}
                      onChange={() => setPlan(x.code)}
                    />
                    <b>{x.name}</b>
                    <span className="price">
                      {priceText(billing === "yearly" ? x.yearly : x.monthly, billing)}
                    </span>
                    <span className="note">{x.blurb}</span>
                    <span className="note">
                      {x.engineers} engineers ·{" "}
                      {x.assets ? `${x.assets.toLocaleString("en-GB")} assets` : "unlimited assets"}
                    </span>
                  </label>
                ))}
            </div>
            <div className="form">
              <div className="grid2">
                <label>
                  Extra engineers ({picked ? `£${picked.extra_engineer} a month each` : ""})
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={extra}
                    onChange={(e) => setExtra(Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))}
                  />
                </label>
                <span />
                <label>
                  Name on the invoices
                  <input
                    value={name}
                    placeholder="Your company name"
                    onChange={(e) => setName(e.currentTarget.value)}
                  />
                </label>
                <label>
                  Email invoices to
                  <input type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
                </label>
              </div>
              <p className="note">
                Subcontractors don't count as engineers. Owners do.{" "}
                {picked && `Total: ${priceText(price(picked, billing, extra), billing)}`}
                {p.settings.vat_registered ? " plus VAT." : "."}
              </p>
              <ErrorLine error={act.error} />
              <button
                type="button"
                className="btn pri"
                disabled={act.busy || !changed}
                onClick={() =>
                  void act.run(async () => {
                    await p.plans.choose(p.orgId, { plan, billing, extra, name, email });
                    p.reload();
                  })
                }
              >
                {chosen ? "Save changes" : `Choose ${picked?.name ?? "plan"}`}
              </button>
            </div>
          </section>
          {chosen && (
            <section className="card" aria-label="Direct Debit">
              <h2>Direct Debit</h2>
              <p>
                <b>{DD_LABEL[mine.dd_status]}</b>
                {mine.dd_ref && ` · reference ${mine.dd_ref}`}
              </p>
              {mine.dd_status !== "active" && mine.dd_status !== "requested" && (
                <>
                  <p className="note">
                    Air Ledger collects your plan by Direct Debit, through Adfin. You enter your bank details
                    on Adfin's secure page, never in Air Ledger, and you're covered by the Direct Debit
                    Guarantee.
                  </p>
                  <div className="row">
                    {p.settings.dd_setup_url ? (
                      <a className="btn pri" href={p.settings.dd_setup_url} target="_blank" rel="noreferrer">
                        Set up the Direct Debit
                      </a>
                    ) : (
                      <span className="note">
                        The Direct Debit link isn't ready yet. Air Ledger will email it to you.
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={act.busy}
                      onClick={() =>
                        void act.run(async () => {
                          await p.plans.ddRequested(p.orgId);
                          p.reload();
                        })
                      }
                    >
                      I've set it up
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
          {mine.status !== "cancelled" && (
            <section className="card dangerzone">
              <h2>Cancel</h2>
              <p className="note">
                You keep everything and can download it, but can't add new clients, installs, units or jobs.
                Choose a plan again whenever you like.
              </p>
              <button
                type="button"
                className="btn danger"
                disabled={act.busy}
                onClick={() =>
                  confirm("Cancel your Air Ledger plan?") &&
                  void act.run(async () => {
                    await p.plans.cancel(p.orgId);
                    p.reload();
                  })
                }
              >
                Cancel plan
              </button>
            </section>
          )}
        </>
      )}
    </>
  );
}

const STATUSES: PlanStatus[] = ["trial", "active", "past_due", "cancelled", "free"];

/** Air Ledger Ltd only: every business, this month's billing, and how sign-up works. */
export function PlatformPage({ plans }: { plans: PlansApi }) {
  const data = useLoad(() => Promise.all([plans.businesses(), plans.settings(), plans.plans()]), [plans]);
  const [rows, settings, list] = data.value ?? [];
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [editing, setEditing] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const act = useAction();
  const due = rows ? dueThisMonth(rows, month) : [];
  const total = due.reduce((n, r) => n + Number(r.amount), 0);
  return (
    <>
      <PageHead
        back={{ href: "#/business", label: "Business" }}
        title="Air Ledger"
        sub="Every business, their plans and billing"
      />
      <ErrorLine error={data.error || act.error} />
      {!rows || !settings || !list ? (
        <Loading />
      ) : (
        <>
          <section className="card">
            <div className="row spread">
              <h2>Bill this month</h2>
              <label className="row">
                Month
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.currentTarget.value || month)}
                />
              </label>
            </div>
            <p>
              {due.length} business{due.length === 1 ? "" : "es"} · £{total.toFixed(2)}
              {settings.vat_registered ? " plus VAT" : ""}
            </p>
            <p className="note">
              Import the file into Xero (Business → Invoices → Import), approve the invoices, and Adfin
              collects them by Direct Debit. Paying businesses, and trials that end this month, are included.
            </p>
            <button
              type="button"
              className="btn pri"
              disabled={!due.length}
              onClick={() =>
                download(
                  new Blob([billingCsv(due, month, settings.vat_registered)], { type: "text/csv" }),
                  `air-ledger-billing-${month}.csv`,
                )
              }
            >
              Download for Xero (CSV)
            </button>
          </section>
          <section className="card">
            <h2>Businesses ({rows.length})</h2>
            <ul className="list">
              {rows.map((r) => (
                <li key={r.org_id}>
                  {editing === r.org_id ? (
                    <EditBusiness
                      plans={plans}
                      row={r}
                      list={list}
                      done={() => {
                        setEditing(null);
                        data.reload();
                      }}
                    />
                  ) : (
                    <>
                      <div>
                        <b>{r.name}</b> · {STATUS_LABEL[r.status]}
                        {r.status === "trial" && ` to ${dateText(r.trial_ends)}`}
                        <div className="note">
                          {r.plan_name} {r.billing} · £{Number(r.amount).toFixed(2)} · {r.engineers} engineers
                          {r.subcontractors ? `, ${r.subcontractors} subcontractors` : ""} · {r.assets} assets
                        </div>
                        <div className="note">
                          {[
                            r.owner_email,
                            r.billing_email &&
                              r.billing_email !== r.owner_email &&
                              `invoices to ${r.billing_email}`,
                            DD_LABEL[r.dd_status],
                            r.dd_ref,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <button type="button" className="btn" onClick={() => setEditing(r.org_id)}>
                        Change
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <PlatformSettingsForm plans={plans} settings={settings} saved={data.reload} />
          <section className="card form">
            <h2>Invite a new business</h2>
            {settings.require_invite ? (
              <p className="note">
                Sign-up is invite-only. Make a code for the business to enter when they sign up.
              </p>
            ) : (
              <p className="note">
                Anyone can sign up and start a trial. You can still make a code if you like.
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={act.busy}
                onClick={() => void act.run(async () => setInvite(await plans.businessInvite("")))}
              >
                Make an invite code
              </button>
              {invite && (
                <input
                  readOnly
                  value={invite}
                  aria-label="New business invite code"
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </div>
          </section>
          <PlansEditor plans={plans} list={list} saved={data.reload} />
        </>
      )}
    </>
  );
}

function EditBusiness(p: { plans: PlansApi; row: PlatformBusiness; list: Plan[]; done: () => void }) {
  const r = p.row;
  const act = useAction();
  return (
    <form
      className="form"
      aria-label={`Change ${r.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const g = (k: string) => String(f.get(k) ?? "");
        void act.run(async () => {
          await p.plans.setPlan(r.org_id, {
            status: g("status") as PlanStatus,
            plan: g("plan"),
            billing: g("billing") as "monthly" | "yearly",
            trial_ends: g("trial_ends"),
            extra_engineers: Number(g("extra_engineers")) || 0,
            dd_status: g("dd_status") as OrgPlan["dd_status"],
            dd_ref: g("dd_ref").trim(),
            paid_until: g("paid_until") || null,
          });
          p.done();
        });
      }}
    >
      <h3>{r.name}</h3>
      <div className="grid2">
        <label>
          Status
          <select name="status" defaultValue={r.status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Plan
          <select name="plan" defaultValue={r.plan}>
            {p.list.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pays
          <select name="billing" defaultValue={r.billing}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label>
          Trial ends
          <input type="date" name="trial_ends" defaultValue={r.trial_ends} />
        </label>
        <label>
          Extra engineers
          <input type="number" name="extra_engineers" min={0} defaultValue={r.extra_engineers} />
        </label>
        <label>
          Yearly: paid up to
          <input type="date" name="paid_until" defaultValue={r.paid_until ?? ""} />
        </label>
        <label>
          Direct Debit
          <select name="dd_status" defaultValue={r.dd_status}>
            {Object.entries(DD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Adfin reference
          <input name="dd_ref" defaultValue={r.dd_ref} />
        </label>
      </div>
      <ErrorLine error={act.error} />
      <div className="row">
        <button className="btn pri" type="submit" disabled={act.busy}>
          Save
        </button>
        <button className="btn" type="button" onClick={p.done}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PlatformSettingsForm(p: { plans: PlansApi; settings: PlatformSettings; saved: () => void }) {
  const [s, setS] = useState(p.settings);
  const act = useAction();
  return (
    <section className="card form">
      <h2>Sign-up and billing</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={!s.require_invite}
          onChange={(e) => setS({ ...s, require_invite: !e.currentTarget.checked })}
        />
        Anyone can sign up and start a free trial (otherwise they need an invite code)
      </label>
      <div className="grid2">
        <label>
          Free trial (days)
          <input
            type="number"
            min={0}
            max={90}
            value={s.trial_days}
            onChange={(e) => setS({ ...s, trial_days: Math.round(Number(e.currentTarget.value) || 0) })}
          />
        </label>
        <label>
          Adfin Direct Debit sign-up link
          <input
            value={s.dd_setup_url}
            placeholder="https://…"
            onChange={(e) => setS({ ...s, dd_setup_url: e.currentTarget.value.trim() })}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={s.vat_registered}
          onChange={(e) => setS({ ...s, vat_registered: e.currentTarget.checked })}
        />
        Air Ledger Ltd charges VAT (prices shown plus VAT)
      </label>
      <ErrorLine error={act.error} />
      <button
        type="button"
        className="btn pri"
        disabled={act.busy}
        onClick={() =>
          void act.run(async () => {
            await p.plans.saveSettings(s);
            p.saved();
          })
        }
      >
        Save
      </button>
    </section>
  );
}

function PlansEditor(p: { plans: PlansApi; list: Plan[]; saved: () => void }) {
  const act = useAction();
  return (
    <section className="card">
      <h2>Plans and prices</h2>
      <ErrorLine error={act.error} />
      {p.list.map((x) => (
        <form
          key={x.code}
          className="form"
          aria-label={`${x.name} plan`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const n = (k: string) => Number(f.get(k) ?? 0);
            void act.run(async () => {
              await p.plans.savePlan({
                ...x,
                name: String(f.get("name") ?? x.name).trim() || x.name,
                monthly: n("monthly"),
                yearly: n("yearly"),
                engineers: Math.max(1, Math.round(n("engineers"))),
                assets: String(f.get("assets") ?? "").trim() ? Math.max(1, Math.round(n("assets"))) : null,
                extra_engineer: n("extra_engineer"),
                active: f.get("active") === "on",
              });
              p.saved();
            });
          }}
        >
          <div className="grid2">
            <label>
              Name
              <input name="name" defaultValue={x.name} />
            </label>
            <label>
              Monthly (£)
              <input name="monthly" type="number" step="0.01" min={0} defaultValue={x.monthly} />
            </label>
            <label>
              Yearly (£)
              <input name="yearly" type="number" step="0.01" min={0} defaultValue={x.yearly} />
            </label>
            <label>
              Engineers included
              <input name="engineers" type="number" min={1} defaultValue={x.engineers} />
            </label>
            <label>
              Assets included (blank: unlimited)
              <input name="assets" type="number" min={1} defaultValue={x.assets ?? ""} />
            </label>
            <label>
              Extra engineer (£ a month)
              <input
                name="extra_engineer"
                type="number"
                step="0.01"
                min={0}
                defaultValue={x.extra_engineer}
              />
            </label>
          </div>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked={x.active} />
            Offered to new businesses
          </label>
          <button className="btn" type="submit" disabled={act.busy}>
            Save {x.name}
          </button>
        </form>
      ))}
    </section>
  );
}

/** On the Business page: the plan, and Air Ledger Ltd's own page for its admins. */
export function PlanLinks({ plans, orgId }: { plans: PlansApi; orgId: string }) {
  const data = useLoad(
    () => Promise.all([plans.mine(orgId).catch(() => null), plans.isAdmin()]),
    [plans, orgId],
  );
  const [mine, admin] = data.value ?? [];
  return (
    <nav className="card linkcard" aria-label="Plan">
      <ul className="rows">
        <li>
          <a className="item" href="#/plan">
            <span className="main">
              <span className="t">Plan and billing</span>
              <span className="m">
                {mine
                  ? `${STATUS_LABEL[mine.status]}${mine.status === "trial" ? ` until ${dateText(mine.trial_ends)}` : ""}`
                  : "Your plan and Direct Debit"}
              </span>
            </span>
          </a>
        </li>
        {admin && (
          <li>
            <a className="item" href="#/platform">
              <span className="main">
                <span className="t">Air Ledger: every business</span>
                <span className="m">Plans, who to bill this month, sign-up</span>
              </span>
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
}
