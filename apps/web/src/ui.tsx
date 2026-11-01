// Page furniture shared by every screen: the branded frame, page headings and empty states.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Navy header (logo, optional action, optional tabs), the page, and the beta note. */
export function Frame(p: { nav?: ReactNode; action?: ReactNode; narrow?: boolean; children: ReactNode }) {
  return (
    <div className={p.nav ? "app has-nav" : "app"}>
      <header className="top">
        <div className="brandrow">
          <a href="#/" className="logo-link">
            <img src="/logo-reverse.svg" alt="Air Ledger" className="logo" />
          </a>
          <span className="badge">Beta</span>
          <span className="sp" />
          {p.action}
        </div>
        {p.nav}
      </header>
      <main className={p.narrow ? "narrow" : undefined}>{p.children}</main>
      <footer className="foot">
        Test version of the new Air Ledger. Nothing here changes the live app at app.airledger.co.uk.
      </footer>
    </div>
  );
}

/** A page title with an optional back link, a line under it and buttons on the right. */
export function PageHead(p: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { href: string; label: string } | null | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="pghead">
      {p.back && (
        <a className="back" href={p.back.href}>
          <Icon name="back" size={16} />
          {p.back.label}
        </a>
      )}
      <div className="pgrow">
        <div className="pgtitle">
          <h1 className="pg">{p.title}</h1>
          {p.sub && <div className="sub">{p.sub}</div>}
        </div>
        {p.children && <div className="pgactions">{p.children}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ic">
        <Icon name={icon} size={26} />
      </span>
      <b>{title}</b>
      {children && <span className="note">{children}</span>}
    </div>
  );
}

export function Loading() {
  return (
    <p className="note loading" aria-live="polite">
      Loading…
    </p>
  );
}

/** Two- or three-letter initials for a client avatar. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
