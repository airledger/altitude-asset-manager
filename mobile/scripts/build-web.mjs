// Copies the web app from the repo root into mobile/www for Capacitor,
// swapping CDN scripts for local copies so the app opens with no signal.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(mobile, "..");
const www = join(mobile, "www");
const nm = join(mobile, "node_modules");

// Web files to ship: every page, script, stylesheet, icon and manifest in the repo root.
const SHIP = /\.(html|js|css|svg|png|json|webmanifest)$/i;

const VENDOR = [
  { cdn: /https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode-generator@[^"']+/g, from: "qrcode-generator/qrcode.js", to: "vendor/qrcode.js" },
  { cdn: /https:\/\/cdn\.jsdelivr\.net\/npm\/jsqr@[^"']+/g, from: "jsqr/dist/jsQR.js", to: "vendor/jsQR.js" },
  { cdn: /https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"']+/g, from: "@supabase/supabase-js/dist/umd/supabase.js", to: "vendor/supabase.js" },
];

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, "vendor"), { recursive: true });

for (const name of readdirSync(root)) {
  if (SHIP.test(name) && name !== "package.json") cpSync(join(root, name), join(www, name));
}
for (const v of VENDOR) cpSync(join(nm, v.from), join(www, v.to));
// Capacitor's runtime gives native.js registerPlugin(); the website never loads it
cpSync(join(nm, "@capacitor/core/dist/capacitor.js"), join(www, "vendor/capacitor.js"));
// supabase-js lazy-loads a chunk next to its UMD bundle
const chunkDir = join(nm, "@supabase/supabase-js/dist/umd");
for (const f of readdirSync(chunkDir)) if (/^\d+\.supabase\.js$/.test(f)) cpSync(join(chunkDir, f), join(www, "vendor", f));

for (const page of readdirSync(www).filter(f => f.endsWith(".html"))) {
  let html = readFileSync(join(www, page), "utf8");
  for (const v of VENDOR) html = html.replace(v.cdn, v.to);
  html = html.replace('<script src="native.js">', '<script src="vendor/capacitor.js"></script>\n<script src="native.js">');
  if (/cdn\.jsdelivr\.net/.test(html)) console.warn(`warning: ${page} still loads scripts from jsdelivr; add them to VENDOR`);
  writeFileSync(join(www, page), html);
}

if (!existsSync(join(www, "index.html"))) throw new Error("index.html missing from www");
console.log("Built mobile/www from", root);
