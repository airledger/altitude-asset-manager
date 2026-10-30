import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { readEnv } from "./env";

describe("App", () => {
  it("says so when no database is configured", () => {
    render(<App client={null} />);
    expect(screen.getByRole("heading", { name: "Not connected" })).toBeTruthy();
    expect(screen.getByText(/Nothing here changes the live app/)).toBeTruthy();
  });
});

describe("readEnv", () => {
  it("needs both the URL and the key", () => {
    expect(readEnv({ VITE_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(readEnv({ VITE_SUPABASE_URL: " https://x.supabase.co ", VITE_SUPABASE_ANON_KEY: "k" })).toEqual({
      supabaseUrl: "https://x.supabase.co",
      supabaseAnonKey: "k",
    });
  });
});
