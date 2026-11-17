// Text messages to customers: "On my way" from a booked job, and the business's sender name (owners).
import { useState, type FormEvent } from "react";
import { onMyWayText, SENDER, suggestSender, type SmsApi } from "../sms";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const ETAS = [10, 15, 20, 30, 45, 60, 90];

/** On a booked job: text the customer that the engineer is on the way. */
export function OnMyWayCard(p: {
  sms: SmsApi;
  phone: string;
  contact: string;
  engineer: string;
  business: string;
  jobId: string;
  systemId: string;
  clientId: string | null;
}) {
  const [minutes, setMinutes] = useState(30);
  // Follows the time picked (and the engineer's name once it loads) until someone types in it.
  const [typed, setTyped] = useState<string | null>(null);
  const message =
    typed ?? onMyWayText({ contact: p.contact, engineer: p.engineer, business: p.business, minutes });
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  const tel = p.phone.replace(/\s/g, "");

  const send = () =>
    void run(async () => {
      await p.sms.send({
        to: tel,
        message: message.trim(),
        kind: "on_the_way",
        clientId: p.clientId,
        jobId: p.jobId,
        systemId: p.systemId,
      });
      setSent(true);
    });

  return (
    <section className="card">
      <h2>Text the customer</h2>
      {sent ? (
        <p className="ok">Sent to {p.phone}.</p>
      ) : (
        <>
          <label>
            Be there in about
            <select value={minutes} onChange={(e) => setMinutes(Number(e.currentTarget.value))}>
              {ETAS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : "1½ hours"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Message
            <textarea rows={3} value={message} onChange={(e) => setTyped(e.currentTarget.value)} />
          </label>
          <ErrorLine error={error} />
          <div className="row">
            <button type="button" className="btn pri" disabled={busy || !message.trim()} onClick={send}>
              {busy ? "Sending…" : "Send “On my way”"}
            </button>
            <a className="btn" href={`sms:${tel}?&body=${encodeURIComponent(message)}`}>
              Open Messages
            </a>
          </div>
        </>
      )}
    </section>
  );
}

/** Owners: the name customers see texts come from. */
export function TextSettingsForm({ sms, business }: { sms: SmsApi; business: string }) {
  const current = useLoad(() => sms.sender(), [sms]);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  if (current.value === undefined) return <ErrorLine error={current.error} />;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("sender") ?? "").trim();
    setDone(false);
    void run(async () => {
      if (name && !SENDER.test(name))
        throw new Error("Use 3 to 11 letters, numbers or spaces, starting with a letter.");
      await sms.saveSender(name);
      setDone(true);
    });
  }
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Text messages</h2>
      <p className="note">
        Engineers can text customers "On my way" from a job, and reminders can be sent as a text. Customers
        see texts come from this name (in the US and Canada they come from a number instead).
      </p>
      <ErrorLine error={error} />
      {done && <p className="ok">Saved.</p>}
      <label>
        Texts come from
        <input
          name="sender"
          defaultValue={current.value}
          placeholder={suggestSender(business)}
          maxLength={11}
        />
      </label>
      <div className="row">
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
