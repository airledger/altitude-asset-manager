// One business's whole week in Air Ledger, on the real beta site: set up, clients, installs, units and asset
// labels, booking (with the engineer's calendar invite), the schedule and calendar link, completing a job,
// signing off and emailing the service report, prices and invoices, the asset register, reminders, parts,
// working with no signal, inviting an engineer (who mustn't see prices), and deleting the business and an
// account. Runs once on a desktop browser and once on an iPhone-sized Safari, each with its own business.
// Every email goes to Resend's test inbox (delivered@resend.dev), so nothing reaches a real person.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PW = process.env.E2E_PASSWORD ?? "";
// Each run (desktop, iPhone) has its own owner account, so one stopping early never trips up the other.
const ownerFor = (project: string) => (process.env.E2E_OWNER ?? "").replace("@", `-${project}@`);
const ENGINEER = process.env.E2E_ENGINEER ?? "";
const INBOX = "delivered@resend.dev";

test.describe.configure({ mode: "serial" });

async function snap(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}
const open = async (page: Page, hash: string) => {
  await page.evaluate((h) => (window.location.hash = h), hash);
};
async function signIn(page: Page, email: string, query = "") {
  await page.goto(`/${query}`);
  const already = page.getByRole("button", { name: "Already have an account? Sign in" });
  if (await already.isVisible().catch(() => false)) await already.click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
}
async function sign(page: Page, label: string) {
  const pad = page.getByRole("img", { name: label });
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error(`No ${label}`);
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + 20 + i * 18, box.y + box.height / 2 + (i % 2 ? 12 : -12));
  await page.mouse.up();
}
const idFrom = (page: Page, kind: string) => {
  const m = new RegExp(`#/${kind}/([0-9a-f-]{36})`).exec(page.url());
  if (!m?.[1]) throw new Error(`No ${kind} id in ${page.url()}`);
  return m[1];
};

test("a business's week in Air Ledger", async ({ page, browser }, info) => {
  test.skip(
    !PW || !process.env.E2E_OWNER || !ENGINEER,
    "E2E_PASSWORD, E2E_OWNER and E2E_ENGINEER are needed",
  );
  const phone = info.project.name === "iphone";
  const OWNER = ownerFor(info.project.name);
  const biz = phone ? "E2E Phone Cooling" : "E2E Desktop Cooling";
  const step = (name: string, fn: () => Promise<void>) =>
    test.step(name, async () => {
      try {
        await fn();
      } catch (e) {
        // What was on screen, as text, so the run's log says why without opening the report.
        console.log(
          `--- ${name}: ${page.url()}\n${await page
            .locator("body")
            .ariaSnapshot()
            .catch(() => "")}`,
        );
        throw e;
      }
      await snap(page, info, name);
    });
  let clientId = "";
  let systemId = "";
  let jobId = "";
  let labelCode = "";

  await step("Sign in and set up the business", async () => {
    await signIn(page, OWNER);
    await page.getByLabel("Business name", { exact: true }).fill(biz);
    await page.getByLabel("Invite code", { exact: true }).fill(phone ? "E2EPHONE" : "E2EDESKTOP");
    await page.getByRole("button", { name: "Set up business" }).click();
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
  });

  await step("Business details", async () => {
    await open(page, "#/business");
    await page.getByLabel("Phone", { exact: true }).fill("01202 000000");
    await page.getByLabel("Email", { exact: true }).fill(INBOX);
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Saved").first()).toBeVisible();
  });

  await step("Add an engineer, which makes an invite link", async () => {
    await open(page, "#/team");
    const form = page.getByRole("form", { name: "Add an engineer" });
    await form.getByLabel("Name", { exact: true }).fill("Eddie Engineer");
    await form.getByLabel("Email", { exact: true }).fill(ENGINEER);
    await form.getByRole("button", { name: "Add engineer" }).click();
    await expect(page.getByLabel("Invite link", { exact: true })).toBeVisible();
  });
  const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
  expect(invite).toContain("invite=");

  await step("Add a client", async () => {
    await open(page, "#/client/new");
    await page.getByLabel("Client or company name", { exact: true }).fill("Harbour Dental (test)");
    await page.getByLabel("Contact name", { exact: true }).fill("Pat");
    await page.getByLabel("Email", { exact: true }).fill(INBOX);
    await page.getByLabel("Postcode", { exact: true }).fill("BH15 1AA");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/#\/client\/[0-9a-f-]{36}/);
    clientId = idFrom(page, "client");
  });

  await step("Add an install", async () => {
    await page.getByRole("link", { name: "Add install" }).click();
    await page.getByLabel("Name (e.g. Office heat pumps)", { exact: true }).fill("Surgery heat pumps");
    await page.getByLabel("Site address", { exact: true }).fill("12 High St, Poole");
    await page.getByLabel("Site postcode", { exact: true }).fill("BH15 1AA");
    await page.getByLabel("Install date", { exact: true }).fill("2025-03-01");
    await page.getByLabel("Factory charge (kg)", { exact: true }).fill("1.2");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/#\/system\/[0-9a-f-]{36}/);
    systemId = idFrom(page, "system");
  });

  for (const [type, maker] of [
    ["Indoor", "Daikin"],
    ["Outdoor", "Daikin"],
  ] as const)
    await step(`Add the ${type.toLowerCase()} unit, with a new asset label`, async () => {
      await page
        .getByRole("button", { name: "Add unit" })
        .or(page.getByRole("link", { name: "Add unit" }))
        .first()
        .click();
      await page.getByLabel(type, { exact: true }).check();
      await page.getByLabel("Manufacturer", { exact: true }).fill(maker);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(maker).first()).toBeVisible();
    });

  await step("Find a unit by its asset label code", async () => {
    const text = await page.locator("main, body").first().innerText();
    labelCode = /AC-[A-Z0-9]{5}/.exec(text)?.[0] ?? "";
    expect(labelCode).not.toBe("");
    await open(page, "#/labels");
    await page.getByLabel("Label code or link", { exact: true }).fill(labelCode.toLowerCase());
    await page.getByRole("button", { name: "Open unit" }).click();
    await expect(page.getByText(/Asset #\d+/).first()).toBeVisible();
  });

  await step("Book a service for the engineer (they're emailed a calendar invite)", async () => {
    await open(page, `#/job/new?system=${systemId}`);
    await page.locator('select[name="engineer_id"]').selectOption({ label: "Eddie Engineer" });
    await page.getByLabel("Time (optional)", { exact: true }).fill("09:30");
    const invited = page.waitForResponse((r) => r.url().includes("/functions/v1/job-invite"));
    await page.getByRole("button", { name: "Book job" }).click();
    await expect(page).toHaveURL(/#\/job\/[0-9a-f-]{36}/);
    jobId = idFrom(page, "job");
    // The server's answer says whether the invite email went out.
    const res = await invited;
    const body = await res.text();
    console.log(`job-invite ${res.status()}: ${body}`);
    expect(res.status(), body).toBe(200);
    expect(body).toContain("invite");
  });

  await step("See it on the schedule, and the calendar link works", async () => {
    await open(page, "#/schedule");
    await expect(page.getByText(/Annual service/).first()).toBeVisible();
    await page.getByRole("button", { name: "Get calendar link" }).click();
    const link = await page.getByLabel("Calendar link", { exact: true }).inputValue();
    const ics = await (await page.request.get(link)).text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("Harbour Dental (test)");
  });

  await step("Complete the job", async () => {
    await open(page, `#/job/${jobId}?do=complete`);
    await page
      .getByLabel("What was found and done", { exact: true })
      .fill("Serviced both units. All working.");
    await page.getByRole("button", { name: /Complete job/ }).click();
    await expect(page.getByRole("heading", { name: "Sign off" })).toBeVisible();
  });

  await step("Sign off and make the service report", async () => {
    await page.getByLabel("Customer's name", { exact: true }).fill("Pat");
    await sign(page, "Engineer's signature");
    await sign(page, "Customer's signature");
    await page.getByRole("button", { name: "Sign and make report" }).click();
    await expect(page.getByRole("form", { name: "Email the report" })).toBeVisible({ timeout: 60_000 });
  });

  await step("Email the report to the customer", async () => {
    await page.getByRole("button", { name: "Email it" }).click();
    await expect(page.getByText(/Emailed to/).first()).toBeVisible({ timeout: 60_000 });
  });

  await step("Download the report PDF from Reports", async () => {
    await open(page, "#/reports");
    await expect(page.getByText(/Harbour Dental \(test\)/).first()).toBeVisible();
    const dl = page.waitForEvent("download");
    await page
      .getByRole("button", { name: /Download/ })
      .first()
      .click();
    expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
  });

  await step("Prices and accounts", async () => {
    await open(page, "#/pricing");
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  await step("Invoices: the completed job is drafted, edited and exported", async () => {
    await open(page, "#/invoices");
    await expect(page.getByText(/new draft invoice/)).toBeVisible({ timeout: 60_000 });
    await page
      .getByText(/Harbour Dental \(test\)/)
      .first()
      .click();
    await expect(page).toHaveURL(/#\/invoice\//);
    await page.getByRole("button", { name: "Add a line" }).click();
    await page
      .getByLabel(/Line \d+ description/)
      .last()
      .fill("Drain pump");
    await page
      .getByLabel(/Line \d+ unit price/)
      .last()
      .fill("45");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved/).first()).toBeVisible();
    await open(page, "#/invoices");
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export \d+ to/ }).click();
    expect((await dl).suggestedFilename()).toMatch(/\.csv$/);
  });

  await step("Asset register, reminders and parts to order", async () => {
    await open(page, "#/register");
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: /CSV/ }).first().click();
    expect((await dl).suggestedFilename()).toMatch(/\.csv$/);
    await open(page, "#/reminders");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await open(page, "#/orders");
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  await step("No signal: saved records still open, and a note waits to send", async () => {
    await open(page, `#/client/${clientId}`);
    await expect(page.getByText("Surgery heat pumps").first()).toBeVisible();
    await page.context().setOffline(true);
    await open(page, `#/system/${systemId}`);
    await expect(page.getByText("Surgery heat pumps").first()).toBeVisible();
    await page.getByText("Add note or photos").click();
    await page.getByLabel("Notes", { exact: true }).fill("Written with no signal");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/saved on this phone|waiting to send/).first()).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByText(/waiting to send|saved on this phone/)).toHaveCount(0, { timeout: 60_000 });
  });

  if (!phone)
    await step("The engineer joins, sees their job and no prices", async () => {
      const ctx = await browser.newContext();
      const eng = await ctx.newPage();
      await signIn(eng, ENGINEER, `?invite=${new URL(invite).searchParams.get("invite")}`);
      await eng.getByRole("button", { name: "Join" }).click();
      await expect(eng.getByRole("navigation", { name: "Sections" })).toBeVisible();
      await expect(eng.getByRole("link", { name: /Invoices/ })).toHaveCount(0);
      await eng.evaluate(() => (window.location.hash = "#/invoices"));
      await expect(eng.getByText("Owners only")).toBeVisible();
      await eng.evaluate(() => (window.location.hash = "#/jobs?show=all"));
      await expect(eng.getByText(/Annual service/).first()).toBeVisible();
      await info.attach("Engineer's view", {
        body: await eng.screenshot({ fullPage: true }),
        contentType: "image/png",
      });

      // The engineer deletes their own account; the business stays.
      await eng.evaluate(() => (window.location.hash = "#/account"));
      await eng.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE");
      await eng.getByRole("button", { name: "Delete my account" }).click();
      await expect(eng.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
      await ctx.close();
    });

  await step("Delete the business", async () => {
    await open(page, "#/business");
    await page.getByLabel("Type the business name to delete it", { exact: true }).fill(biz);
    await page.getByRole("button", { name: "Delete business" }).click();
    await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
