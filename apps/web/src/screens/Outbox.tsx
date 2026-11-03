// The bar that says when Air Ledger is offline or has work waiting to send, with the list behind it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { onConnectionChange, showingSavedCopy } from "../offline";
import { discard, flush, onOutboxChange, outboxItems, outboxSending, retry, startOutbox } from "../outbox";

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
function subscribeOnline(fn: () => void) {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  const off = onConnectionChange(fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
    off();
  };
}

export function useOutbox() {
  const items = useSyncExternalStore(onOutboxChange, outboxItems);
  const sending = useSyncExternalStore(onOutboxChange, outboxSending);
  return { items, sending };
}

export function OutboxBar({ client }: { client: SupabaseClient }) {
  const { items, sending } = useOutbox();
  const isOnline = useSyncExternalStore(subscribeOnline, () => online() && !showingSavedCopy());
  const [open, setOpen] = useState(false);
  useEffect(() => startOutbox(client), [client]);

  const failed = items.filter((i) => i.error);
  const waiting = items.length - failed.length;
  if (isOnline && !items.length) return null;
  const n = (k: number) => `${k} change${k === 1 ? "" : "s"}`;
  const text = !isOnline
    ? `No signal. ${waiting ? `${n(waiting)} saved on this phone, sending when you're back online.` : "Showing what you last looked at; anything you complete is saved on this phone."}`
    : sending
      ? `Sending ${n(waiting)}…`
      : waiting
        ? `${n(waiting)} waiting to send.`
        : "";
  return (
    <div className={`outbox${failed.length ? " bad" : isOnline ? "" : " off"}`} role="status">
      <div className="outbox-row">
        <span>
          {text} {failed.length > 0 && `${failed.length} couldn't be sent.`}
        </span>
        <span className="row">
          {items.length > 0 && (
            <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide" : "Show"}
            </button>
          )}
          {isOnline && waiting > 0 && !sending && (
            <button className="link" onClick={() => void flush(client)}>
              Send now
            </button>
          )}
        </span>
      </div>
      {open && (
        <ul className="outbox-list">
          {items.map((i) => (
            <li key={i.id}>
              <div>
                <b>
                  {i.kind === "photo"
                    ? "Photo"
                    : i.kind === "complete"
                      ? "Job completed"
                      : i.kind === "contact"
                        ? "Contact logged"
                        : "Site record"}
                </b>{" "}
                · {i.label} ·{" "}
                {new Date(i.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {i.error && <div className="err">{i.error}</div>}
              </div>
              {i.error && (
                <span className="row">
                  <button className="btn" onClick={() => void retry(client, i.id)}>
                    Try again
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => {
                      if (confirm("Throw this away? It hasn't been saved to Air Ledger.")) void discard(i.id);
                    }}
                  >
                    Discard
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
