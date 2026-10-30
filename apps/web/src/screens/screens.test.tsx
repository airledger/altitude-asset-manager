import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { keys, local, readLinkParams } from "../local";
import { fakeSupabase } from "../test/fakeSupabase";
import { inviteLink } from "./Team";

const olivia = { id: "u-olivia", email: "olivia@a.test" };
const bizA = { id: "org-a", name: "Business A", slug: "business-a", logo_url: null };

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("signed out", () => {
  it("shows sign in, and sends a reset link", async () => {
    const { client, calls } = fakeSupabase({});
    render(<App client={client} />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText(/Create an account/)).toBeNull();
    fireEvent.click(screen.getByText("Forgotten your password?"));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "olivia@a.test" } });
    fireEvent.click(screen.getByText("Send reset link"));
    expect(await screen.findByText(/we've sent it a link/)).toBeTruthy();
    expect(calls).toContainEqual({ kind: "auth", name: "reset", args: "olivia@a.test" });
  });

  it("opens on sign-up with the business named when arriving from an invite link", async () => {
    local.set(keys.invite, "ABC123");
    const { client } = fakeSupabase({
      rpc: { invite_info: [{ valid: true, joins: true, org_name: "Business A" }] },
    });
    render(<App client={client} />);
    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect(await screen.findByText("You've been invited to join Business A on Air Ledger.")).toBeTruthy();
  });

  it("shows the business's name on its own sign-in link", async () => {
    local.set(keys.brand, "business-a");
    const { client } = fakeSupabase({ rpc: { org_public: [{ name: "Business A", logo_url: null }] } });
    render(<App client={client} />);
    expect(await screen.findByText("Business A")).toBeTruthy();
  });
});

describe("signed in", () => {
  it("asks someone with no business to set one up", async () => {
    const { client, calls } = fakeSupabase({ signedInAs: olivia, rpc: { create_business: "org-new" } });
    render(<App client={client} />);
    fireEvent.change(await screen.findByLabelText("Business name"), { target: { value: "Cool Air Ltd" } });
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "NEWBIZ" } });
    fireEvent.click(screen.getByText("Set up business"));
    await waitFor(() =>
      expect(calls).toContainEqual({
        kind: "rpc",
        name: "create_business",
        args: { p_name: "Cool Air Ltd", p_code: "NEWBIZ" },
      }),
    );
  });

  it("joins the business a waiting invite is for", async () => {
    local.set(keys.invite, "JOINME");
    const { client, calls } = fakeSupabase({
      signedInAs: olivia,
      rpc: { invite_info: [{ valid: true, joins: true, org_name: "Business A" }], join_business: "org-a" },
    });
    render(<App client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ kind: "rpc", name: "join_business", args: { p_code: "JOINME" } }),
    );
    expect(local.get(keys.invite)).toBeNull();
  });

  it("lets an owner see the team and make an invite link", async () => {
    window.location.hash = "#/team";
    const { client, calls } = fakeSupabase({
      signedInAs: olivia,
      tables: {
        members: [
          { role: "owner", orgs: bizA, user_id: olivia.id, email: olivia.email, created_at: "2026-10-01" },
          { role: "member", orgs: bizA, user_id: "u-ed", email: "ed@a.test", created_at: "2026-10-02" },
        ],
      },
      rpc: { create_invite: "XYZ789" },
    });
    render(<App client={client} />);
    expect(await screen.findByText("ed@a.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make owner" })).toBeTruthy();
    fireEvent.click(screen.getByText("Create invite link"));
    expect(((await screen.findByLabelText("Invite link")) as HTMLInputElement).value).toBe(
      inviteLink("XYZ789"),
    );
    expect(calls).toContainEqual({
      kind: "rpc",
      name: "create_invite",
      args: { p_org: "org-a", p_email: null },
    });
  });

  it("doesn't let an engineer change the business or the team", async () => {
    window.location.hash = "#/business";
    const { client } = fakeSupabase({
      signedInAs: olivia,
      tables: {
        members: [{ role: "member", orgs: bizA, user_id: olivia.id, email: olivia.email, created_at: "x" }],
      },
    });
    render(<App client={client} />);
    expect(await screen.findByText("Only an owner can change the business details.")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Team" }));
    expect(await screen.findByText(/olivia@a.test/)).toBeTruthy();
    expect(screen.queryByText("Invite someone")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

describe("link params", () => {
  it("remembers ?invite= and ?b= and tidies the address", () => {
    window.history.replaceState(null, "", "/?invite=abc123&b=Business-A");
    readLinkParams();
    expect(local.get(keys.invite)).toBe("ABC123");
    expect(local.get(keys.brand)).toBe("business-a");
    expect(window.location.search).toBe("");
  });
});
