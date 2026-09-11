// Marketing screenshots for the landing page, regenerated from the seeded
// demo account.
//
// Run:  node scripts/capture-marketing-shots.mjs   (dev server on :3000)
//
// These are pictures of a UI that keeps changing, which the hand-drawn panels
// in landing/illustrations.tsx never were. Committing the capture script means
// a stale screenshot is one command to fix rather than an afternoon of
// guessing crops.
//
// Screenshots of the features competitors cannot show.
//
// Clips to [data-shot] elements rather than pixel offsets, and captures at 3x
// so a retina browser asking for a 3840-wide candidate has real pixels to
// serve. Auth is a service-role magic link because Turnstile guards the
// password grant (same path as e2e/fixtures/test-user.ts).
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";

// Story columns render at ~560 CSS px. Capturing at roughly that width means
// the screenshot is displayed near 1:1 and the app's own 13px text stays
// readable, instead of being scaled down to 5px.
const WIDE = 1500;
const NARROW = 700;
process.loadEnvFile(".env.local");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// Each entry: where to go, which element to clip to, and how much breathing
// room to leave around it.
const SHOTS = [
  { route: "/insights",  shot: "edge",           file: "edge",      pad: 14, vw: WIDE },
  { route: "/insights",  shot: "mistakes",       file: "mistakes",  pad: 14, rows: 3 },
  { route: "/analytics", shot: "excursion",      file: "excursion", pad: 14, hide: "button", rows: 2 },
  { route: "TRADE",      shot: "plan-adherence", file: "plan",      pad: 0  },
];

mkdirSync("public/screenshots", { recursive: true });
const b = await chromium.launch();

// Find a closed trade that is tagged with a strategy, so the plan-adherence
// panel has rules to show rather than its empty state.
async function newPage(vw = NARROW) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "demo@tradinglens.app" });
  if (error) throw new Error(error.message);
  const ctx = await b.newContext({ viewport: { width: vw, height: 1100 }, deviceScaleFactor: 3 });
  await ctx.addInitScript(() => { try {
    localStorage.removeItem("tl-design"); localStorage.setItem("theme","light"); localStorage.setItem("tl-tour-seen","1");
  } catch {} });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/dashboard`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  return { ctx, p };
}

let tradeHref = null;
{
  const { ctx, p } = await newPage(WIDE);
  await p.goto("http://localhost:3000/trades", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(2500);
  const candidates = await p.evaluate(() => [...document.querySelectorAll("tbody tr")]
    .filter(r => /closed/i.test(r.children[1]?.textContent ?? "")
      && (r.children[3]?.textContent ?? "").trim().length > 2)
    .map(r => r.querySelector("a[href^='/trades/']")?.getAttribute("href"))
    .filter(Boolean).slice(0, 14));
  for (const href of candidates) {
    await p.goto("http://localhost:3000" + href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => {
      const el = document.querySelector('[data-shot="plan-adherence"]');
      if (!el) return null;
      const t = el.textContent ?? "";
      const m = t.match(/Plan adherence:\s*(\d+)\s*\/\s*(\d+)/);
      return m ? { passed: +m[1], total: +m[2], len: t.length } : null;
    });
    // At least one rule broken, and short enough not to wrap into a wall.
    if (info && info.total >= 2 && info.passed < info.total && info.len < 620) { tradeHref = href; break; }
  }
  console.log("trade for plan-adherence:", tradeHref);
  await ctx.close();
}

for (const s of SHOTS) {
  const route = s.route === "TRADE" ? tradeHref : s.route;
  if (!route) { console.log(s.file, "SKIPPED (no trade found)"); continue; }
  const { ctx, p } = await newPage(s.vw ?? NARROW);
  await p.goto("http://localhost:3000" + route, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("load").catch(()=>{});
  await p.waitForTimeout(3000);
  // Hide interactive controls for the capture only. A "Recalculate" button is
  // meaningful in the app and meaningless in a still, where it just eats
  // vertical space and invites a click that cannot happen.
  if (s.hide) await p.addStyleTag({ content: `[data-shot="${s.shot}"] ${s.hide} { display: none !important; }` });
  const el = await p.$(`[data-shot="${s.shot}"]`);
  if (!el) { console.log(s.file, "NOT FOUND on", route); await ctx.close(); continue; }
  // scrollIntoViewIfNeeded parks the panel underneath the sticky nav bar, so
  // the nav ends up baked into the crop. Scroll by document position with the
  // nav height subtracted instead.
  await p.evaluate(({ sel, pad }) => {
    const node = document.querySelector(`[data-shot="${sel}"]`);
    const nav = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
    const top = node.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - nav - pad - 8));
  }, { sel: s.shot, pad: s.pad });
  await p.waitForTimeout(900);
  const box = await el.boundingBox();
  let h = box.height + s.pad * 2;
  if (s.rows) {
    // Cut after a whole number of rows, so the crop never ends halfway
    // through one.
    const cut = await p.evaluate(({ sel, rows }) => {
      const node = document.querySelector(`[data-shot="${sel}"]`);
      const card = node.querySelector('[class*="rounded"]') ?? node;
      const kids = [...card.children].filter(k => k.getBoundingClientRect().height > 20);
      const target = kids[Math.min(rows, kids.length) - 1];
      return target ? target.getBoundingClientRect().bottom : null;
    }, { sel: s.shot, rows: s.rows });
    if (cut) h = cut - (box.y - s.pad) + s.pad;
  }
  await p.screenshot({ path: `public/screenshots/${s.file}.png`, clip: {
    x: Math.max(0, box.x - s.pad), y: Math.max(0, box.y - s.pad),
    width: box.width + s.pad * 2, height: h } });
  console.log(s.file.padEnd(10), `${Math.round(box.width)}x${Math.round(box.height)} css  ->  ${Math.round((box.width+s.pad*2)*3)}px wide @3x`);
  await ctx.close();
}
await b.close();
