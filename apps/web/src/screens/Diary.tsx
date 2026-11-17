// "Your calendar on the schedule": each person connects their own Google, Outlook or iCloud calendar by its
// private address, so the times they're busy show next to their jobs. Owners see who has one connected.
import { useState, type FormEvent } from "react";
import { diaryProvider, diaryUrl, type DiaryApi } from "../diary";
import type { PersonRow } from "../jobs";
import { ErrorLine, useAction } from "../useAction";
import { useLoad } from "./Assets";

const ago = (t: string | null) => {
  if (!t) return "not read yet";
  const min = Math.round((Date.now() - Date.parse(t)) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export function DiaryCard(p: {
  diary: DiaryApi;
  owner: boolean;
  team: PersonRow[];
  me: PersonRow | null;
  changed: () => void;
}) {
  const mine = useLoad(() => p.diary.mine(), [p.diary]);
  const status = useLoad(() => (p.owner ? p.diary.status() : Promise.resolve([])), [p.diary, p.owner]);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();
  const link = mine.value ?? null;
  const done = () => {
    mine.reload();
    status.reload();
    p.changed();
  };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      const checked = diaryUrl(String(f.get("url") ?? ""));
      if ("error" in checked) throw new Error(checked.error);
      await p.diary.connect(checked.url, f.get("show_titles") === "on", link?.id ?? null);
      setEditing(false);
      done();
    });
  }
  const refresh = () =>
    void run(async () => {
      await p.diary.sync({ mine: true });
      done();
    });
  const remove = () =>
    void run(async () => {
      if (!link || !confirm("Stop showing your calendar on the schedule?")) return;
      await p.diary.disconnect(link.id);
      done();
    });

  const others = (status.value ?? [])
    .map((s) => ({ ...s, person: p.team.find((x) => x.user_id === s.user_id) }))
    .filter((s) => s.person && s.person.id !== p.me?.id);

  return (
    <section className="card form">
      <h2>Your calendar on the schedule</h2>
      <p className="note">
        Connect your own Google, Outlook or iPhone (iCloud) calendar and the times you're busy show here next
        to your jobs, so nobody books you when you're not free. Tap a busy time to book a job in it.
      </p>
      <ErrorLine error={error || mine.error} />
      {mine.value === undefined ? null : link && !editing ? (
        <>
          <p>
            <b>{diaryProvider(link.url)}</b> connected · updated {ago(link.synced_at)}
            {link.show_titles ? " · the team sees what each entry is called" : " · the team just sees “Busy”"}
          </p>
          {link.error && <p className="banner">{link.error}</p>}
          <div className="row">
            <button type="button" className="btn" disabled={busy} onClick={refresh}>
              {busy ? "Updating…" : "Update now"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(true)}>
              Change
            </button>
            <button type="button" className="btn" disabled={busy} onClick={remove}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <label>
            Your calendar's private address
            <input
              name="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              defaultValue={link?.url ?? ""}
            />
          </label>
          <label className="check">
            <input type="checkbox" name="show_titles" defaultChecked={link?.show_titles ?? false} />
            Let the team see what each entry is called (otherwise it just says “Busy”)
          </label>
          <details>
            <summary>Where do I find it?</summary>
            <p>
              <b>Google Calendar</b> (on a computer): Settings → click your calendar on the left → Integrate
              calendar → copy <i>Secret address in iCal format</i>.
            </p>
            <p>
              <b>Outlook</b>: Settings → Calendar → Shared calendars → Publish a calendar → pick your calendar
              and “Can view when I'm busy” (or “titles and locations”) → Publish → copy the <i>ICS</i> link.
            </p>
            <p>
              <b>iPhone / iCloud</b>: in the Calendar app tap Calendars → the ⓘ next to your calendar → turn
              on <i>Public Calendar</i> → Share Link → Copy. Anyone with that link could see the calendar, so
              only paste it here.
            </p>
          </details>
          <div className="row">
            <button className="btn pri" type="submit" disabled={busy}>
              {busy ? "Connecting…" : "Connect my calendar"}
            </button>
            {editing && (
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p className="note">
            Your calendar's address is kept private to you. Busy times are read every time someone opens the
            schedule (at most every 10 minutes) for the next nine weeks.
          </p>
        </form>
      )}
      {p.owner && others.length > 0 && (
        <>
          <h3>Team calendars</h3>
          <ul className="plain">
            {others.map((s) => (
              <li key={s.user_id}>
                {s.person?.name || s.person?.email}:{" "}
                {s.error ? `problem: ${s.error}` : `updated ${ago(s.synced_at)}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
