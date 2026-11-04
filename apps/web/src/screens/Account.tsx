// Your account: who you're signed in as, help and privacy, and deleting the account (app stores require
// it inside the app). Owners can also delete a business from its Business page.
import { useState } from "react";
import type { Api, Business } from "../api";
import { appOrigin } from "../native";
import { Loading, PageHead } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { go, useLoad } from "./Assets";

export function AccountPage({ api, email, signOut }: { api: Api; email: string; signOut: () => void }) {
  const plan = useLoad(() => api.deletionPlan(), [api]);
  const [typed, setTyped] = useState("");
  const { busy, error, run } = useAction();
  const web = appOrigin();
  return (
    <>
      <PageHead title="Your account" sub={email} />
      <section className="card">
        <h2>Help</h2>
        <ul className="plain">
          <li>
            <a href={`${web}/support.html`} target="_blank" rel="noreferrer">
              Support and common questions
            </a>
          </li>
          <li>
            <a href={`${web}/privacy.html`} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </li>
          <li>
            <a href="mailto:support@airledger.co.uk?subject=Air%20Ledger%3A%20missing%20something">
              Missing something? Tell us
            </a>
          </li>
        </ul>
        <button className="btn" onClick={signOut}>
          Sign out
        </button>
      </section>
      <section className="card dangerzone form">
        <h2>Delete your account</h2>
        {plan.error ? (
          <p role="alert" className="error">
            {plan.error}
          </p>
        ) : !plan.value ? (
          <Loading />
        ) : (
          <>
            <p>
              This deletes your sign-in straight away.{" "}
              {plan.value.length
                ? `It also deletes ${plan.value.map((b) => b.name).join(", ")}, with every client, install, job, photo, report and invoice in it, because no one else is in that business.`
                : "Businesses you're part of keep their records; you're just removed from the team."}
            </p>
            {plan.value.length > 0 && (
              <p className="note">
                F-gas rules say leak-check records must be kept for 5 years. Download what you need first.
              </p>
            )}
            <ErrorLine error={error} />
            <label>
              Type DELETE to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.currentTarget.value)}
                autoCapitalize="characters"
                aria-label="Type DELETE to confirm"
              />
            </label>
            <button
              className="btn danger"
              disabled={busy || typed.trim().toUpperCase() !== "DELETE"}
              onClick={() =>
                void run(async () => {
                  await api.deleteAccount();
                  signOut();
                })
              }
            >
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </>
        )}
      </section>
    </>
  );
}

/** Owners only: deletes the whole business. Typing its name guards against a slip. */
export function DeleteBusiness({ api, business, done }: { api: Api; business: Business; done: () => void }) {
  const [typed, setTyped] = useState("");
  const { busy, error, run } = useAction();
  return (
    <section className="card dangerzone form narrowform">
      <h2>Delete this business</h2>
      <p>
        Deletes {business.name} for everyone in the team: clients, installs, units, jobs, photos, service
        reports, invoices and asset labels. This can't be undone.
      </p>
      <ErrorLine error={error} />
      <label>
        Type the business name to confirm
        <input
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          aria-label="Type the business name to delete it"
        />
      </label>
      <button
        className="btn danger"
        disabled={busy || typed.trim().toLowerCase() !== business.name.trim().toLowerCase()}
        onClick={() =>
          void run(async () => {
            await api.deleteBusiness(business.id);
            go("#/");
            done();
          })
        }
      >
        {busy ? "Deleting…" : "Delete business"}
      </button>
    </section>
  );
}
