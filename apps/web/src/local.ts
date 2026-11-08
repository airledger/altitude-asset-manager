// Small per-device memory (pending invite, chosen business). Private windows can refuse storage, so never throw.
export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Nothing to do: the app still works, it just won't remember.
    }
  },
};

export const keys = { invite: "al.invite", brand: "al.brand", business: "al.business", portal: "al.portal" };

/** Picks up ?invite= and ?b= from the address, remembers them, and tidies the address bar. */
export function readLinkParams(loc: Location = window.location): void {
  // Stickers link to /u/AC-XXXXX; the app shows units at #/u/AC-XXXXX.
  const sticker = loc.pathname.match(/^\/u\/([A-Za-z0-9-]+)\/?$/)?.[1];
  if (sticker) window.history.replaceState(null, "", `/${loc.search}#/u/${sticker.toUpperCase()}`);
  const params = new URLSearchParams(loc.search);
  const invite = params.get("invite")?.trim().toUpperCase();
  const brand = params.get("b")?.trim().toLowerCase();
  const portal = params.get("portal")?.trim().toUpperCase();
  if (invite) local.set(keys.invite, invite);
  if (portal) local.set(keys.portal, portal);
  if (brand) local.set(keys.brand, brand);
  if (invite || brand || portal) {
    params.delete("invite");
    params.delete("b");
    params.delete("portal");
    const rest = params.toString();
    window.history.replaceState(null, "", loc.pathname + (rest ? `?${rest}` : "") + loc.hash);
  }
}
