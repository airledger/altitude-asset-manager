import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { keys, local } from "../local";
import { fakeSupabase } from "../test/fakeSupabase";

const pat = { id: "u-c", email: "pat@harbour.test" };
const overview = {
  business: { name: "Cool Air Ltd", logo_url: null, phone: "01202 111111", email: "", self_booking: false },
  client: { id: "c1", name: "Harbour Dental" },
  sites: [
    {
      id: "s1",
      name: "Surgery",
      address: "12 High St",
      postcode: "BH15 1AA",
      refrigerant: "R32",
      units: [
        {
          asset_no: 7,
          sticker_code: "AC-7K2PQ",
          role: "indoor",
          indoor_type: "Cassette",
          manufacturer: "Daikin",
          model: "FCAG",
          location: "Waiting room",
        },
      ],
    },
  ],
  visits: [
    {
      id: "j1",
      date: "2099-11-10",
      time: "09:30:00",
      type: "Annual service",
      status: "booked",
      site: "Surgery",
      engineer: "Ed",
      customer_response: null,
      customer_note: "",
    },
  ],
  reports: [
    {
      id: "r1",
      ref: "SR-261103-AB12",
      rev: 1,
      issued_at: "2026-11-03T10:00:00Z",
      type: "Annual service",
      date: "2026-11-03",
      site: "Surgery",
      path: "org/reports/r1.pdf",
    },
  ],
  contracts: [],
  requests: [],
};

function customer(extra: Record<string, unknown> = {}) {
  const fake = fakeSupabase({
    signedInAs: pat,
    rpc: {
      my_portals: [
        {
          client_id: "c1",
          client_name: "Harbour Dental",
          org_id: "org-a",
          org_name: "Cool Air Ltd",
          logo_url: null,
        },
      ],
      portal_overview: overview,
      portal_request: { request: "q1", job: null },
      ...extra,
    },
    tables: { members: [] },
  });
  render(<App client={fake.client} />);
  return fake.calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("the customer's portal", () => {
  it("shows their units, reports and the visit to accept", async () => {
    const calls = customer();
    expect(await screen.findByRole("heading", { name: "Harbour Dental" })).toBeTruthy();
    expect(screen.getByText(/looked after by/)).toBeTruthy();
    expect(screen.getByText(/Asset #7 · Cassette/)).toBeTruthy();
    expect(screen.getByText(/SR-261103-AB12/)).toBeTruthy();
    const visits = screen.getByRole("region", { name: "Visits to come" });
    fireEvent.click(within(visits).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(calls.some((c) => c.name === "portal_respond")).toBe(true));
    expect(calls.find((c) => c.name === "portal_respond")?.args).toEqual({
      p_job: "j1",
      p_response: "accepted",
      p_note: "",
    });
  });

  it("asks for another time with a note", async () => {
    const calls = customer();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for another time" }));
    fireEvent.change(screen.getByLabelText("What times suit you?"), { target: { value: "Afternoons" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "portal_respond")?.args).toMatchObject({
        p_response: "change",
        p_note: "Afternoons",
      }),
    );
  });

  it("sends a repair request from a scanned label, and tells the business", async () => {
    window.location.hash = "#/u/AC-7K2PQ";
    const calls = customer();
    expect(await screen.findByText(/the unit you scanned/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Visit request" });
    expect((within(form).getByLabelText("What's wrong?") as HTMLTextAreaElement).value).toContain("Asset #7");
    fireEvent.change(within(form).getByLabelText("What's wrong?"), {
      target: { value: "Asset #7: dripping" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/They'll book a time and email you/)).toBeTruthy();
    expect(calls.find((c) => c.name === "portal_request")?.args).toMatchObject({
      p_client: "c1",
      p_system: "s1",
      p_kind: "Repair",
      p_message: "Asset #7: dripping",
      p_slot_date: null,
    });
    await waitFor(() =>
      expect((calls.find((c) => c.name === "fn.portal-notify")?.args as { body: unknown }).body).toEqual({
        request: "q1",
      }),
    );
  });

  it("offers free slots only when the business allows self-booking", async () => {
    const calls = customer({
      portal_overview: { ...overview, business: { ...overview.business, self_booking: true } },
      portal_slots: [{ day: "2099-11-12", part: "pm" }],
      portal_request: { request: "q1", job: "j9" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Ask for a visit" }));
    const form = screen.getByRole("form", { name: "Visit request" });
    fireEvent.change(await within(form).findByLabelText("Pick a time"), {
      target: { value: "2099-11-12-pm" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/Booked for Thu 12 Nov, afternoon/)).toBeTruthy();
    expect(calls.find((c) => c.name === "portal_request")?.args).toMatchObject({
      p_kind: "Service",
      p_slot_date: "2099-11-12",
      p_slot_part: "pm",
    });
  });

  it("explains a portal link on the sign-in screen", async () => {
    local.set(keys.portal, "PABC123456");
    const fake = fakeSupabase({
      rpc: {
        portal_invite_info: [
          { valid: true, org_name: "Cool Air Ltd", client_name: "Harbour Dental", email: "pat@harbour.test" },
        ],
      },
    });
    render(<App client={fake.client} />);
    expect(await screen.findByText(/Cool Air Ltd has invited you to the Harbour Dental portal/)).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("pat@harbour.test");
  });
});

describe("the business's side", () => {
  const owner = { id: "u-o", email: "olivia@a.test" };
  const tables = {
    members: [{ role: "owner", orgs: { id: "org-a", name: "Cool Air Ltd", slug: "a", logo_url: null } }],
    clients: [
      {
        id: "c1",
        name: "Harbour Dental",
        contact_name: "Pat",
        phone: "",
        email: "pat@harbour.test",
        preferred_contact: "Email",
        billing_address: "",
        postcode: "",
        on_service_plan: false,
        reminders_opt_in: true,
        notes: "",
      },
    ],
    systems: [],
    portal_users: [],
    portal_invites: [],
  };

  it("invites a client's contact from the client page", async () => {
    window.location.hash = "#/client/c1";
    const fake = fakeSupabase({ signedInAs: owner, rpc: { create_portal_invite: "PXYZ987654" }, tables });
    render(<App client={fake.client} />);
    const card = await screen.findByRole("region", { name: "Customer portal" });
    await waitFor(() =>
      expect((within(card).getByLabelText("Their email") as HTMLInputElement).value).toBe("pat@harbour.test"),
    );
    fireEvent.click(within(card).getByRole("button", { name: "Invite to portal" }));
    const link = (await within(card).findByLabelText("Portal link")) as HTMLInputElement;
    expect(link.value).toMatch(/\/\?portal=PXYZ987654$/);
    expect(fake.calls.find((c) => c.name === "create_portal_invite")?.args).toEqual({
      p_client: "c1",
      p_email: "pat@harbour.test",
    });
  });

  it("lists customers' requests on Home, ready to book", async () => {
    const fake = fakeSupabase({
      signedInAs: owner,
      tables: {
        ...tables,
        service_requests: [
          {
            id: "q1",
            client_id: "c1",
            system_id: "s1",
            kind: "Repair",
            message: "Dripping",
            preferred: "Mornings",
            created_at: "2026-11-08T08:00:00Z",
            clients: { name: "Harbour Dental" },
            systems: { name: "Surgery", site_postcode: "" },
          },
        ],
      },
    });
    render(<App client={fake.client} />);
    const card = await screen.findByRole("region", { name: "Visit requests" });
    const book = within(card).getByRole("link", { name: "Book it" }).getAttribute("href") ?? "";
    expect(book).toContain("#/job/new?system=s1&type=Repair%20%2F%20breakdown&request=q1");
  });
});
