// One-off generator for the "what should I screenshot?" example image shown
// in the screenshot auto-fill modal. Mimics a TradingView-style order ticket
// (bid/ask bar, order-type tabs, Price/Shares fields, Take Profit/Stop Loss
// toggles) since that's the layout users actually screenshot from. Re-run
// after editing:
//   node scripts/generate-example-screenshot.mjs
import sharp from "sharp";

const WIDTH = 320;
const BG = "#131722";
const PANEL = "#1c2030";
const BORDER = "#2a2e39";
const FG = "#e8eaed";
const MUTED = "#787f8c";
const PRIMARY = "#4d8ef7";
const PROFIT = "#10b981";
const LOSS = "#f87171";
const HIGHLIGHT = "rgba(77, 142, 247, 0.14)";

const PAD = 16;
const W = WIDTH - PAD * 2;

let y = 0;
const chunks = [];
function add(svg) {
  chunks.push(svg);
}

// --- Header: ticker + window chrome -----------------------------------
y += 34;
add(`<text x="${PAD}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${FG}">AAPL</text>`);
add(`<text x="${WIDTH - 44}" y="${y - 2}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="${MUTED}">&#8942;</text>`);
add(`<text x="${WIDTH - 20}" y="${y - 2}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="${MUTED}">&#10005;</text>`);
y += 22;

// --- Order / DOM tabs ----------------------------------------------------
add(`<rect x="${PAD}" y="${y}" width="${W}" height="30" rx="7" fill="${PANEL}"/>`);
add(`<rect x="${PAD + 2}" y="${y + 2}" width="${W / 2 - 2}" height="26" rx="6" fill="${BORDER}"/>`);
add(`<text x="${PAD + W / 4}" y="${y + 19}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="600" fill="${FG}" text-anchor="middle">Order</text>`);
add(`<text x="${PAD + (W * 3) / 4}" y="${y + 19}" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="${MUTED}" text-anchor="middle">DOM</text>`);
y += 42;

// --- Bid / ask bar ---------------------------------------------------------
const half = W / 2 - 3;
add(`<rect x="${PAD}" y="${y}" width="${half}" height="46" rx="8" fill="${PANEL}"/>`);
add(`<text x="${PAD + 12}" y="${y + 18}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${LOSS}">Sell</text>`);
add(`<text x="${PAD + 12}" y="${y + 36}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="${FG}">192.30</text>`);
add(`<rect x="${PAD + half + 6}" y="${y}" width="${half}" height="46" rx="8" fill="rgba(77,142,247,0.22)"/>`);
add(`<text x="${WIDTH - PAD - 12}" y="${y + 18}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${PRIMARY}" text-anchor="end">Buy</text>`);
add(`<text x="${WIDTH - PAD - 12}" y="${y + 36}" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="${PRIMARY}" text-anchor="end">192.35</text>`);
y += 60;

// --- Order type tabs ---------------------------------------------------
const orderTypes = ["Market", "Limit", "Stop", "Stop Limit"];
const otWidth = W / orderTypes.length;
orderTypes.forEach((t, i) => {
  const active = t === "Limit";
  const cx = PAD + otWidth * i + otWidth / 2;
  add(
    `<text x="${cx}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="${active ? 700 : 400}" fill="${active ? FG : MUTED}" text-anchor="middle">${t}</text>`,
  );
  if (active) add(`<rect x="${cx - 20}" y="${y + 6}" width="40" height="2" fill="${PRIMARY}"/>`);
});
y += 24;
add(`<line x1="${PAD}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}" stroke="${BORDER}" stroke-width="1"/>`);
y += 20;

// --- A highlighted field: label + chevron, value box below ----------------
function field(label, value, valueColor, secondary) {
  add(`<text x="${PAD + 2}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${MUTED}">${label} &#8964;</text>`);
  y += 10;
  const boxH = 44;
  add(`<rect x="${PAD}" y="${y}" width="${W}" height="${boxH}" rx="10" fill="${HIGHLIGHT}" stroke="${PRIMARY}" stroke-width="1.5" stroke-opacity="0.55"/>`);
  add(`<rect x="${PAD}" y="${y}" width="4" height="${boxH}" rx="2" fill="${PRIMARY}"/>`);
  add(
    `<text x="${PAD + 18}" y="${y + 28}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${valueColor}">${value}</text>`,
  );
  if (secondary) {
    add(
      `<text x="${WIDTH - PAD - 12}" y="${y + 28}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${MUTED}" text-anchor="end">${secondary}</text>`,
    );
  }
  y += boxH + 18;
}

field("Price", "192.30", FG, "Ask");
field("Shares", "10", FG, "1,923.00 USD");

// --- Exits section header -------------------------------------------------
add(`<text x="${PAD}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="600" fill="${FG}">Exits</text>`);
add(
  `<text x="${WIDTH - PAD}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${MUTED}" text-anchor="end">Risk / Reward 8.42</text>`,
);
y += 18;

// --- Take profit / Stop loss: label + toggle, value box below -----------
function toggleField(label, value, valueColor, secondary, on) {
  add(`<text x="${PAD + 2}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${MUTED}">${label}</text>`);
  const toggleW = 30;
  const toggleColor = on ? PROFIT : BORDER;
  add(`<rect x="${WIDTH - PAD - toggleW}" y="${y - 11}" width="${toggleW}" height="15" rx="7.5" fill="${toggleColor}"/>`);
  add(`<circle cx="${WIDTH - PAD - (on ? 7 : toggleW - 7)}" cy="${y - 3.5}" r="6" fill="#ffffff"/>`);
  y += 10;
  const boxH = 44;
  add(`<rect x="${PAD}" y="${y}" width="${W}" height="${boxH}" rx="10" fill="${HIGHLIGHT}" stroke="${PRIMARY}" stroke-width="1.5" stroke-opacity="0.55"/>`);
  add(`<rect x="${PAD}" y="${y}" width="4" height="${boxH}" rx="2" fill="${PRIMARY}"/>`);
  add(
    `<text x="${PAD + 18}" y="${y + 28}" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${valueColor}">${value}</text>`,
  );
  if (secondary) {
    add(
      `<text x="${WIDTH - PAD - 12}" y="${y + 28}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="${MUTED}" text-anchor="end">${secondary}</text>`,
    );
  }
  y += boxH + 18;
}

toggleField("Take profit, price", "201.50", PROFIT, "1,845 ticks", true);
toggleField("Stop loss, price", "188.00", LOSS, "612 ticks", true);

// --- Execute button --------------------------------------------------------
const btnH = 46;
add(`<rect x="${PAD}" y="${y}" width="${W}" height="${btnH}" rx="10" fill="${PRIMARY}"/>`);
add(
  `<text x="${WIDTH / 2}" y="${y + 28}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle">Buy 10 AAPL @ 192.30 LMT</text>`,
);
y += btnH + PAD;

const HEIGHT = y;
const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="18" fill="${BG}"/>
  ${chunks.join("\n")}
</svg>
`;

await sharp(Buffer.from(svg)).png().toFile("public/example-trade-screenshot.png");
console.log(`wrote public/example-trade-screenshot.png (${WIDTH}x${HEIGHT})`);
