// Card payments: the owner sets up Stripe (Prices and accounts), each invoice's pay link (invoice page), and the
// page a customer lands on from a pay link.
import { formatDate } from "@airledger/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import type { InvoiceRow } from "../invoices";
import { checkoutUrl, payInfo, payLink, type PaymentsApi } from "../payments";
import { Frame, Loading } from "../ui";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const money = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

/** Prices and accounts: connect Stripe once, then every invoice can be paid by card. */
export function CardPaymentsCard(p: { payments: PaymentsApi; came: string }) {
  // Coming back from Stripe's set-up pages: ask Stripe how it went rather than waiting for its message.
  const status = useLoad(() => (p.came ? p.payments.refresh() : p.payments.status()), [p.payments, p.came]);
  const act = useAction();
  const s = status.value;
  const setUp = () =>
    void act.run(async () => {
      window.location.assign(await p.payments.connectUrl());
    });
  return (
    <section className="card form" aria-label="Card payments">
      <h2>Card payments</h2>
      <ErrorLine error={status.error || act.error} />
      {!s ? (
        !status.error && <Loading />
      ) : s.charges_enabled ? (
        <>
          <p>
            <span className="pill green">On</span> Customers can pay your invoices by card, Apple Pay or
            Google Pay. The money goes straight to your Stripe account, and the invoice is marked paid here.
          </p>
          <p className="note">
            Each invoice has a pay link to send. Stripe's fees come out of each payment; Air Ledger takes
            nothing.
          </p>
          <div className="row">
            <button
              className="btn"
              disabled={act.busy}
              onClick={() => {
                if (
                  !window.confirm("Turn off card payments? Pay links stop working until you connect again.")
                )
                  return;
                void act.run(async () => (await p.payments.disconnect(), status.reload()));
              }}
            >
              Turn off
            </button>
          </div>
        </>
      ) : s.connected ? (
        <>
          <p>
            <span className="pill amber">Not finished</span> Stripe needs a few more details before you can
            take payments.
          </p>
          <div className="row">
            <button className="btn pri" disabled={act.busy} onClick={setUp}>
              Finish setting up Stripe
            </button>
            <button
              className="btn"
              disabled={act.busy}
              onClick={() => void act.run(async () => (await p.payments.refresh(), status.reload()))}
            >
              Check again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="note">
            Let customers pay invoices by card, Apple Pay or Google Pay. You'll set up a free Stripe account
            (or use the one you have); payments go straight into it, and invoices are marked paid here by
            themselves.
          </p>
          <div className="row">
            <button className="btn pri" disabled={act.busy} onClick={setUp}>
              Set up card payments
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** On an invoice: the pay link to send, and card payments received. */
export function InvoicePayCard(p: {
  payments: PaymentsApi;
  inv: InvoiceRow & { clients: { name: string; email?: string } | null };
  gross: number;
  businessName: string;
}) {
  const data = useLoad(async () => {
    const [status, received] = await Promise.all([p.payments.status(), p.payments.received(p.inv.id)]);
    return { status, received };
  }, [p.payments, p.inv.id]);
  const [copied, setCopied] = useState(false);
  if (!data.value) return data.error ? <ErrorLine error={data.error} /> : null;
  const { status, received } = data.value;
  const due = Math.max(0, Math.round((p.gross - Number(p.inv.amount_paid ?? 0)) * 100) / 100);
  if (!status.charges_enabled && !received.length) return null;
  const link = p.inv.pay_token ? payLink(p.inv.pay_token) : "";
  const email = p.inv.clients?.email ?? "";
  const body =
    `Hello,\n\nHere's invoice ${p.inv.number} for ${money(due)}. You can pay it by card, Apple Pay or Google Pay here:\n` +
    `${link}\n\nThanks,\n${p.businessName}`;
  return (
    <section className="card" aria-label="Card payment">
      <h2>Card payment</h2>
      {received.length > 0 && (
        <ul className="rows">
          {received.map((r, i) => (
            <li key={i}>
              <div className="item">
                <span className="main">
                  <span className="t">{money(r.amount)} paid by card</span>
                  <span className="m">{formatDate(r.paid_at.slice(0, 10))}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {due <= 0 ? (
        <p>
          <span className="pill green">Paid</span>
        </p>
      ) : status.charges_enabled && link ? (
        <>
          <p className="note">Send this link and the customer can pay the {money(due)} still owed by card.</p>
          <div className="copy">
            <input readOnly value={link} aria-label="Pay link" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="row">
            <a
              className="btn pri"
              href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Invoice ${p.inv.number} from ${p.businessName}`)}&body=${encodeURIComponent(body)}`}
            >
              Email it
            </a>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Where a pay link lands: the invoice, what's owed, and Pay by card. No sign-in. */
export function PayPage(p: { client: SupabaseClient; token: string; paid: boolean }) {
  const info = useLoad(() => payInfo(p.client, p.token), [p.client, p.token]);
  const act = useAction();
  const i = info.value;
  return (
    <Frame narrow>
      <section className="card" aria-label="Pay an invoice">
        {!i ? (
          info.error ? (
            <>
              <h1>Pay an invoice</h1>
              <ErrorLine error={info.error} />
            </>
          ) : (
            <Loading />
          )
        ) : (
          <>
            <h1>
              Invoice {i.number} from {i.business}
            </h1>
            <dl className="facts totals">
              <dt>For</dt>
              <dd>{i.client}</dd>
              <dt>Total</dt>
              <dd>{money(i.total)}</dd>
              {i.paid > 0 && (
                <>
                  <dt>Paid</dt>
                  <dd>{money(i.paid)}</dd>
                </>
              )}
              <dt>To pay</dt>
              <dd>
                <b>{money(i.due)}</b>
              </dd>
            </dl>
            <ErrorLine error={act.error} />
            {i.due <= 0 ? (
              <p className="banner ok">Paid in full. Thank you.</p>
            ) : p.paid ? (
              <>
                <p className="banner ok">Thank you. Your payment has gone through.</p>
                <p className="note">It can take a minute to show here as paid.</p>
                <button className="btn" onClick={info.reload}>
                  Check again
                </button>
              </>
            ) : i.canPay ? (
              <button
                className="btn pri"
                disabled={act.busy}
                onClick={() =>
                  void act.run(async () => {
                    window.location.assign(await checkoutUrl(p.client, p.token));
                  })
                }
              >
                {act.busy ? "Opening secure payment…" : `Pay ${money(i.due)} by card`}
              </button>
            ) : (
              <p className="note">
                {i.business} isn't taking card payments online yet. Please contact them to pay.
              </p>
            )}
            <p className="note">
              Payment is taken securely by Stripe. Card, Apple Pay and Google Pay accepted.
            </p>
          </>
        )}
      </section>
    </Frame>
  );
}
