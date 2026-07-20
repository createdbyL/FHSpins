/* ============================================================
   FESTIVAL WHEELS — app.js
   Static, client-only. Reads live loot tables from Google Sheets
   (CSV export), falls back to demo data if no sheet is configured.
   ============================================================ */

window.addEventListener("error", (e) => {
  console.error("Festival Wheels error:", e.error || e.message);
  toastSafe(`Something broke: ${e.message}. Check the browser console for details.`);
});
function toastSafe(msg) {
  // toast() is defined further down; this wrapper lets the global error
  // handler above call it even if it fires before the rest of the file runs.
  try { toast(msg); } catch { alert(msg); }
}

const RARITY_COLOR = {
  common: "var(--common)",
  rare: "var(--rare)",
  epic: "var(--epic)",
  legendary: "var(--legendary)",
};
const RARITY_ORDER = ["common", "rare", "epic", "legendary", "forza edition", "barn find", "treasure"];

const LS_KEYS = {
  credits: "fw_credits",
  inventory: "fw_inventory",
  collection: "fw_collection",
  jobs: "fw_jobs",
};

let STATE = {
  wheels: [],          // [{key,name,cost,color,tab,loot:[{id,name,rarity,value,weight,desc}]}]
  credits: 0,
  inventory: [],        // [{uid,name,rarity,value,wheelKey,wheelName,ts}]
  activeFilter: "all",
  spinning: false,
  catalog: [],           // every unique item across all wheels, built once wheels load
  collection: {},         // key -> snapshot of the item, permanent once discovered
  collectionFilter: "all",
  jobs: {},              // job key -> startedAt timestamp, or absent/null if idle
  currentView: "wheels",
};

/* ---------------- demo fallback data ---------------- */
function demoWheels() {
  return [
    { key: "bronze", name: "Bronze Wheel", cost: 100, color: "#8a93a3", loot: [
      { id: "b1", name: "Rusty Pickup", rarity: "common", value: 60, weight: 40 },
      { id: "b2", name: "Compact Hatchback", rarity: "common", value: 90, weight: 35 },
      { id: "b3", name: "Sport Coupe '98", rarity: "rare", value: 220, weight: 20 },
      { id: "b4", name: "Vintage Roadster", rarity: "epic", value: 500, weight: 5 },
    ]},
    { key: "silver", name: "Silver Wheel", cost: 250, color: "#4ea1ff", loot: [
      { id: "s1", name: "Rally Hatch", rarity: "common", value: 140, weight: 35 },
      { id: "s2", name: "Turbo Coupe", rarity: "rare", value: 380, weight: 35 },
      { id: "s3", name: "Track Special", rarity: "rare", value: 420, weight: 20 },
      { id: "s4", name: "Widebody GT", rarity: "epic", value: 950, weight: 10 },
    ]},
    { key: "gold", name: "Gold Wheel", cost: 600, color: "#ffb800", loot: [
      { id: "g1", name: "Muscle Classic", rarity: "rare", value: 500, weight: 30 },
      { id: "g2", name: "Twin-Turbo GT", rarity: "epic", value: 1400, weight: 40 },
      { id: "g3", name: "Rally Legend", rarity: "epic", value: 1650, weight: 22 },
      { id: "g4", name: "Hypercar Prototype", rarity: "legendary", value: 4200, weight: 8 },
    ]},
    { key: "platinum", name: "Platinum Wheel", cost: 1200, color: "#b24eff", loot: [
      { id: "p1", name: "Track-Tuned GT", rarity: "epic", value: 1800, weight: 40 },
      { id: "p2", name: "Works Rally Car", rarity: "epic", value: 2100, weight: 32 },
      { id: "p3", name: "Le Mans Prototype", rarity: "legendary", value: 5200, weight: 20 },
      { id: "p4", name: "Festival One-Off", rarity: "legendary", value: 7800, weight: 8 },
    ]},
    { key: "diamond", name: "Diamond Wheel", cost: 2500, color: "#17e6c9", loot: [
      { id: "d1", name: "Hypercar Prototype", rarity: "legendary", value: 6000, weight: 40 },
      { id: "d2", name: "Bespoke Grand Tourer", rarity: "legendary", value: 8200, weight: 35 },
      { id: "d3", name: "Festival Icon Edition", rarity: "legendary", value: 15000, weight: 15 },
      { id: "d4", name: "One-of-One Concept", rarity: "legendary", value: 30000, weight: 10 },
    ]},
  ];
}

/* ---------------- CSV loading ---------------- */
function csvUrl(sheetId, tab) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map(h => h.trim().toLowerCase());
  return rows.filter(r => r.some(v => v.trim() !== "")).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
    return obj;
  });
}

// Fetches any CSV URL — a local file path or a remote one — and parses it.
async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch "${url}" (${res.status})`);
  return parseCSV(await res.text());
}

async function fetchSheetTab(sheetId, tab) {
  return fetchCSV(csvUrl(sheetId, tab));
}

// Shared row -> data mapping, used by both the local-CSV and Google-Sheets loaders.
function mapLootRow(wheelKey, r, i) {
  return {
    id: `${wheelKey}_${i}`,
    name: r.name || "Unknown Item",
    rarity: (r.rarity || "common").toLowerCase(),
    value: Number(r.value) || 0,
    weight: Number(r.weight) || 1,
    desc: r.desc || "",
    image: r.image || "",
  };
}
function mapWheelDef(row, loot) {
  return {
    key: row.key,
    name: row.name || row.key,
    cost: Number(row.cost) || 0,
    color: row.color || "#ff6a33",
    mode: (row.mode || "standard").toLowerCase(), // "standard" | "super"
    loot,
  };
}

// Local CSV files — the default and fastest option. Reads config.csv (one
// row per wheel) plus a single items.csv holding every wheel's loot rows,
// each tagged with a "wheel" column matching that wheel's key. Both fetched
// in parallel with nothing else, so this loads near-instantly — and since
// every drop rate lives in one file, tuning weights/values is a single
// spreadsheet to scroll through instead of hunting across per-wheel files.
async function loadWheelsFromLocalCSV() {
  const dir = (APP_CONFIG.LOCAL_DATA_DIR || "data").replace(/\/+$/, "");
  const itemsFile = APP_CONFIG.ITEMS_FILE || "items.csv";

  const [configRows, itemRows] = await Promise.all([
    fetchCSV(`${dir}/config.csv`),
    fetchCSV(`${dir}/${itemsFile}`),
  ]);
  if (!configRows.length) throw new Error(`${dir}/config.csv is empty`);

  const validRows = configRows.filter(row => row.key);
  if (!validRows.length) throw new Error(`No wheels found in ${dir}/config.csv (every row needs a "key")`);

  const wheels = validRows.map(row => {
    // "super" wheels have no loot rows of their own — their pool is built
    // live from every car you haven't collected yet (see getSuperWheelPool)
    if (row.mode?.toLowerCase() === "super") return mapWheelDef(row, []);
    const lootRows = itemRows.filter(r => (r.wheel || "").toLowerCase() === row.key.toLowerCase());
    return mapWheelDef(row, lootRows.map((r, i) => mapLootRow(row.key, r, i)));
  });

  return wheels;
}

// Google Sheets — kept as an option if you'd rather edit loot tables from
// a spreadsheet than local files. Slower to load since it's requests to
// Google's servers, but editable from anywhere without touching the repo.
// Set DATA_SOURCE to "sheet" in config.js to use this instead. Mirrors the
// local-CSV structure: a Config tab (wheels) plus one Items tab shared by
// every wheel, joined by the same "wheel" column.
async function loadWheelsFromSheet() {
  const sheetId = APP_CONFIG.SHEET_ID?.trim();
  if (!sheetId) return null;

  const [configRows, itemRows] = await Promise.all([
    fetchSheetTab(sheetId, APP_CONFIG.CONFIG_TAB),
    fetchSheetTab(sheetId, APP_CONFIG.ITEMS_TAB || "Items"),
  ]);
  if (!configRows.length) throw new Error("Config tab is empty");

  const validRows = configRows.filter(row => row.key);
  if (!validRows.length) throw new Error('No wheels found in the Config tab (every row needs a "key")');

  const wheels = validRows.map(row => {
    if (row.mode?.toLowerCase() === "super") return mapWheelDef(row, []);
    const lootRows = itemRows.filter(r => (r.wheel || "").toLowerCase() === row.key.toLowerCase());
    return mapWheelDef(row, lootRows.map((r, i) => mapLootRow(row.key, r, i)));
  });

  return wheels;
}

/* ---------------- persistence ---------------- */
function loadState() {
  const credits = localStorage.getItem(LS_KEYS.credits);
  STATE.credits = credits !== null ? Number(credits) : APP_CONFIG.STARTING_CREDITS;
  try { STATE.inventory = JSON.parse(localStorage.getItem(LS_KEYS.inventory)) || []; }
  catch { STATE.inventory = []; }
  try { STATE.collection = JSON.parse(localStorage.getItem(LS_KEYS.collection)) || {}; }
  catch { STATE.collection = {}; }
  try { STATE.jobs = JSON.parse(localStorage.getItem(LS_KEYS.jobs)) || {}; }
  catch { STATE.jobs = {}; }
}
function saveCredits() { localStorage.setItem(LS_KEYS.credits, String(STATE.credits)); }
function saveInventory() { localStorage.setItem(LS_KEYS.inventory, JSON.stringify(STATE.inventory)); }
function saveCollection() { localStorage.setItem(LS_KEYS.collection, JSON.stringify(STATE.collection)); }
function saveJobs() { localStorage.setItem(LS_KEYS.jobs, JSON.stringify(STATE.jobs)); }

/* ---------------- UI helpers ---------------- */
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._h);
  toast._h = setTimeout(() => { t.hidden = true; }, 2200);
}

function renderCredits() {
  $("#creditsValue").textContent = STATE.credits.toLocaleString();
}

function switchView(view) {
  STATE.currentView = view;
  ["wheels", "inventory", "shop", "collection", "jobs"].forEach(v => {
    $(`#view-${v}`).classList.toggle("hidden", v !== view);
  });
  $all(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (view === "wheels") renderWheelGrid();
  if (view === "inventory") renderInventory();
  if (view === "shop") renderShop();
  if (view === "collection") renderCollection();
  if (view === "jobs") renderJobs();
}

/* ---------------- wheel selection cards ---------------- */
function renderWheelSkeletons(n = 5) {
  const grid = $("#wheelGrid");
  grid.innerHTML = Array.from({ length: n })
    .map(() => `<div class="wheel-card skeleton"></div>`)
    .join("");
}

function renderWheelGrid() {
  const grid = $("#wheelGrid");
  grid.innerHTML = "";
  STATE.wheels.forEach(w => {
    const card = document.createElement("div");
    card.className = "wheel-card";
    card.style.setProperty("--tier-color", w.color);

    if (w.mode === "super") {
      const poolSize = getSuperWheelPool().length;
      const affordable = STATE.credits >= w.cost && poolSize > 0;
      const label = poolSize === 0 ? "Collection Complete!" : (affordable ? "Spin" : "Not enough credits");
      card.innerHTML = `
        <span class="tier-eyebrow">${Math.min(SUPER_WHEEL_PULLS, poolSize)} of ${SUPER_WHEEL_PULLS} slots</span>
        <h3>${escapeHtml(w.name)}</h3>
        <p class="wheel-desc">Guaranteed 5 cars not in your collection.</p>
        <div class="wheel-cost">
          <span class="cost-num">${w.cost.toLocaleString()}</span>
          <span class="cost-tag">CREDITS</span>
        </div>
        <button class="spin-btn" ${affordable ? "" : "disabled"}>${label}</button>
      `;
      card.querySelector(".spin-btn").addEventListener("click", () => openSuperSpin(w));
    } else {
      const affordable = STATE.credits >= w.cost;
      card.innerHTML = `
        <span class="tier-eyebrow">${w.loot.length} rewards</span>
        <h3>${escapeHtml(w.name)}</h3>
        <p class="wheel-desc">Rewards worth ${valueRange(w.loot)} credits.</p>
        <div class="wheel-cost">
          <span class="cost-num">${w.cost.toLocaleString()}</span>
          <span class="cost-tag">CREDITS</span>
        </div>
        <button class="spin-btn" ${affordable ? "" : "disabled"}>${affordable ? "Spin" : "Not enough credits"}</button>
      `;
      card.querySelector(".spin-btn").addEventListener("click", () => openSpin(w));
    }
    grid.appendChild(card);
  });
}

function topRarity(loot) {
  const rarities = new Set(loot.map(l => l.rarity));
  for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
    if (rarities.has(RARITY_ORDER[i])) return RARITY_ORDER[i];
  }
  return "common";
}

function valueRange(loot) {
  if (!loot.length) return "0";

  const values = loot.map(item => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return `${min.toLocaleString()} - ${max.toLocaleString()}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- spin overlay ---------------- */
let currentWheel = null;

function openSpin(wheel, autoSpin = true) {
  currentWheel = wheel;
  $("#spinWheelTitle").textContent = wheel.name;
  $("#spinResult").hidden = true;
  $("#superSummary").hidden = true;
  $("#slotFrameSingle").hidden = false;
  $("#superReels").hidden = true;
  $("#spinOverlay").hidden = false;
  buildReelStrip($("#slotStrip"), wheel.loot, wheel.loot[0]); // idle preview before the real spin kicks off
  if (autoSpin) {
    // let the reel paint at rest for a beat before it whips into motion
    requestAnimationFrame(() => setTimeout(() => {
      try { doSpin(); } catch (err) { console.error(err); toast(`Spin failed: ${err.message}`); }
    }, 250));
  }
}

function closeSpinOverlay() {
  $("#spinOverlay").hidden = true;
  renderWheelGrid();
}

$("#closeSpin").addEventListener("click", closeSpinOverlay);
$("#doneSpinBtn").addEventListener("click", () => { closeSpinOverlay(); switchView("inventory"); });
$("#spinAgainBtn").addEventListener("click", () => openSpin(currentWheel, true));

const ITEM_H = 92;        // must match --item-h in style.css
const STRIP_FILLER = 28;  // rows of random filler above the winner, for spin length/feel

function buildSlotRow(item) {
  const row = document.createElement("div");
  row.className = "slot-item";
  row.style.setProperty("--rarity-color", rarityColorHex(item.rarity));
  row.innerHTML = `
    <img src="${imageFor(item)}" alt="" loading="lazy">
    <div class="slot-item-text">
      <span class="slot-item-rarity">${item.rarity}</span>
      <span class="slot-item-name">${escapeHtml(item.name)}</span>
      <span class="slot-item-value">${item.value.toLocaleString()} cr</span>
    </div>
  `;
  return row;
}

// Builds a vertical reel strip inside the given element: a run of random
// filler rows, then the winner, then one trailing filler row so the
// viewport has something to show below the winner once it's centered.
// Returns the winner's index within the strip.
function buildReelStrip(stripEl, loot, winner) {
  stripEl.style.transition = "none";
  stripEl.style.transform = "translateY(0px)";
  stripEl.innerHTML = "";

  const items = [];
  for (let i = 0; i < STRIP_FILLER; i++) {
    items.push(loot[Math.floor(Math.random() * loot.length)]);
  }
  const winnerIndex = items.length;
  items.push(winner);
  items.push(loot[Math.floor(Math.random() * loot.length)]);

  items.forEach(item => stripEl.appendChild(buildSlotRow(item)));
  stripEl.offsetHeight; // reflow so the transition-reset above actually applies
  return winnerIndex;
}

function rarityColorHex(rarity) {
  const map = { common: "#8a93a3", rare: "#4ea1ff", epic: "#b24eff", legendary: "#FF7B1C", "forza edition": "#fc355a", "barn find": "#02b30d", treasure: "#ffed1c" }; 
  return map[String(rarity).trim().toLowerCase()] || map.common;
}

// Inline SVG car-silhouette placeholder, tinted per rarity, used whenever
// a loot item has no "image" URL set in the sheet.
const _fallbackCache = {};
function fallbackImage(rarity) {
  const color = rarityColorHex(rarity);
  if (_fallbackCache[color]) return _fallbackCache[color];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
      <rect width="200" height="120" fill="#11161f"/>
      <ellipse cx="100" cy="95" rx="80" ry="8" fill="#000" opacity=".35"/>
      <path d="M25 82 Q20 55 45 50 L60 32 Q70 24 85 24 L120 24 Q135 24 145 34 L158 50 Q182 54 178 82 Z"
            fill="${color}" opacity=".9"/>
      <rect x="70" y="34" width="55" height="20" rx="4" fill="#11161f" opacity=".55"/>
      <circle cx="58" cy="84" r="14" fill="#0b0e14"/>
      <circle cx="58" cy="84" r="6" fill="${color}"/>
      <circle cx="145" cy="84" r="14" fill="#0b0e14"/>
      <circle cx="145" cy="84" r="6" fill="${color}"/>
    </svg>`;
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  _fallbackCache[color] = uri;
  return uri;
}

function imageFor(item) {
  return item.image && item.image.trim() ? item.image.trim() : fallbackImage(item.rarity);
}

function weightedPick(loot) {
  const total = loot.reduce((s, l) => s + l.weight, 0);
  let r = Math.random() * total;
  for (const item of loot) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return loot[loot.length - 1];
}

function doSpin() {
  if (STATE.spinning || !currentWheel) return;
  if (STATE.credits < currentWheel.cost) { toast("Not enough credits for this wheel."); return; }

  STATE.spinning = true;
  STATE.credits -= currentWheel.cost;
  saveCredits(); renderCredits();
  $("#spinResult").hidden = true;

  const wheel = currentWheel;
  const winner = weightedPick(wheel.loot);
  const winnerIndex = buildReelStrip($("#slotStrip"), wheel.loot, winner);

  const strip = $("#slotStrip");
  requestAnimationFrame(() => {
    strip.style.transition = "transform 4s cubic-bezier(.08,.82,.17,1)";
    const targetY = -(winnerIndex - 1) * ITEM_H; // lands the winner in the center row
    strip.style.transform = `translateY(${targetY}px)`;
  });

  setTimeout(() => {
    finishSpin(wheel, winner);
  }, 4300);
}

function finishSpin(wheel, item) {
  STATE.spinning = false;

  const uid = `inv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  STATE.inventory.unshift({
    uid, name: item.name, rarity: item.rarity, value: item.value, image: item.image || "",
    wheelKey: wheel.key, wheelName: wheel.name, ts: Date.now(),
  });
  saveInventory();
  updateInvCount();

  const isNewDiscovery = recordDiscovery(item, wheel);

  const card = $("#resultCard");
  card.style.setProperty("--rarity-color", rarityColorHex(item.rarity));
  card.innerHTML = `
    ${isNewDiscovery ? `<span class="new-badge">NEW · Added to Collection Book</span>` : ""}
    <div class="r-image-wrap"><img src="${imageFor(item)}" alt="${escapeHtml(item.name)}"></div>
    <span class="r-rarity">${item.rarity}</span>
    <div class="r-name">${escapeHtml(item.name)}</div>
    <div class="r-value">Worth ${item.value.toLocaleString()} credits · from ${escapeHtml(wheel.name)}</div>
  `;
  $("#spinResult").hidden = false;
}

/* ---------------- super wheel (5 reels at once, undiscovered cars only) ---------------- */

// Every catalog entry you haven't discovered yet, with uniform odds — every
// undiscovered car is equally likely to come up.
function getSuperWheelPool() {
  return STATE.catalog
    .filter(entry => !STATE.collection[entry.key])
    .map(entry => ({
      name: entry.name, rarity: entry.rarity, value: entry.value,
      weight: 1, image: entry.image, wheelName: entry.wheelName, wheelKey: entry.wheelKey,
    }));
}

// Weighted sampling WITHOUT replacement — used so the 5 simultaneous reels
// can't land on the same car twice, since (unlike a sequential spin) none
// of the wins are committed to the collection until all 5 reels have
// stopped, so we can't rely on STATE.collection to rule out repeats.
function weightedSampleWithoutReplacement(pool, count) {
  const remaining = [...pool];
  const picks = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const winner = weightedPick(remaining);
    picks.push(winner);
    remaining.splice(remaining.indexOf(winner), 1);
  }
  return picks;
}

const SUPER_WHEEL_PULLS = 5;

// Builds the 5-column reel row inside #superReels and returns the 5 strip
// elements in left-to-right order.
function buildSuperReelsFrame() {
  const container = $("#superReels");
  container.innerHTML = `
    <div class="super-reels-row">
      ${Array.from({ length: SUPER_WHEEL_PULLS }).map((_, i) => `
        <div class="slot-viewport mini"><div class="slot-strip" id="slotStrip${i}"></div></div>
      `).join("")}
    </div>
    <div class="slot-fade-top"></div>
    <div class="slot-fade-bottom"></div>
    <div class="slot-center-line"></div>
    <div class="slot-pointer-left"></div>
    <div class="slot-pointer-right"></div>
  `;
  return Array.from({ length: SUPER_WHEEL_PULLS }).map((_, i) => $(`#slotStrip${i}`));
}

function openSuperSpin(wheel) {
  if (STATE.spinning) return;
  if (STATE.credits < wheel.cost) { toast("Not enough credits for the Super Wheel."); return; }
  const pool = getSuperWheelPool();
  if (!pool.length) { toast("You've already collected every car — nothing left for the Super Wheel!"); return; }

  currentWheel = wheel;
  $("#spinWheelTitle").textContent = wheel.name;
  $("#spinResult").hidden = true;
  $("#superSummary").hidden = true;
  $("#slotFrameSingle").hidden = true;
  $("#superReels").hidden = false;
  $("#spinOverlay").hidden = false;

  const strips = buildSuperReelsFrame();
  strips.forEach(stripEl => buildReelStrip(stripEl, pool, pool[Math.floor(Math.random() * pool.length)])); // idle preview

  requestAnimationFrame(() => setTimeout(() => {
    doSuperSpin(wheel, strips).catch(err => {
      console.error(err);
      toast(`Spin failed: ${err.message}`);
      STATE.spinning = false;
    });
  }, 250));
}

async function doSuperSpin(wheel, strips) {
  STATE.spinning = true;
  STATE.credits -= wheel.cost;
  saveCredits(); renderCredits();

  const pool = getSuperWheelPool();
  const winners = weightedSampleWithoutReplacement(pool, SUPER_WHEEL_PULLS);

  $("#spinRoundIndicator").hidden = false;
  $("#spinRoundIndicator").textContent = winners.length < SUPER_WHEEL_PULLS
    ? `Only ${winners.length} car${winners.length === 1 ? "" : "s"} left to find!`
    : "Spinning all 5 reels…";

  // build every strip with its own winner (columns beyond the number of
  // available winners just stay on their idle preview and dim out)
  const winnerIndexes = strips.map((stripEl, i) => {
    if (i >= winners.length) {
      stripEl.closest(".slot-viewport").style.opacity = "0.25";
      return null;
    }
    return buildReelStrip(stripEl, pool, winners[i]);
  });

  // animate all 5 at once, but stagger the stop time left-to-right so
  // they lock in one after another like a real slot machine
  const animations = strips.map((stripEl, i) => {
    if (winnerIndexes[i] == null) return Promise.resolve();
    const duration = 3.2 + i * 0.35; // seconds
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        stripEl.style.transition = `transform ${duration}s cubic-bezier(.1,.8,.2,1)`;
        stripEl.style.transform = `translateY(${-(winnerIndexes[i] - 1) * ITEM_H}px)`;
      });
      setTimeout(resolve, duration * 1000 + 150);
    });
  });
  await Promise.all(animations);

  // commit every win together, only once every reel has landed
  winners.forEach(winner => {
    const uid = `inv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    STATE.inventory.unshift({
      uid, name: winner.name, rarity: winner.rarity, value: winner.value, image: winner.image || "",
      wheelKey: wheel.key, wheelName: wheel.name, ts: Date.now(),
    });
    recordDiscovery(winner, wheel);
  });
  saveInventory(); updateInvCount();

  STATE.spinning = false;
  $("#spinRoundIndicator").hidden = true;
  showSuperSummary(winners);
}

function showSuperSummary(wins) {
  $("#superSummaryCount").textContent = wins.length;
  const grid = $("#superSummaryGrid");
  grid.innerHTML = "";
  wins.forEach(w => grid.appendChild(buildItemCard(w, false)));

  $("#superSummary").hidden = false;
  const remaining = getSuperWheelPool().length;
  const againBtn = $("#superAgainBtn");
  againBtn.disabled = remaining === 0;
  againBtn.textContent = remaining === 0 ? "Collection Complete!" : "Spin Again";
}

$("#superAgainBtn").addEventListener("click", () => {
  if ($("#superAgainBtn").disabled) return;
  openSuperSpin(currentWheel);
});
$("#superDoneBtn").addEventListener("click", () => { closeSpinOverlay(); switchView("inventory"); });

/* ---------------- inventory ---------------- */
function updateInvCount() {
  $("#invCount").textContent = STATE.inventory.length;
}

function renderRarityFilters() {
  const wrap = $("#rarityFilters");
  wrap.innerHTML = `<button class="chip active" data-rarity="all">All</button>` +
    RARITY_ORDER.map(r => `<button class="chip" data-rarity="${r}">${r}</button>`).join("");
  wrap.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.activeFilter = btn.dataset.rarity;
      wrap.querySelectorAll(".chip").forEach(b => b.classList.toggle("active", b === btn));
      renderShop();
    });
  });
}

function quickSellValue(item) {
  const afterLoss = item.value * (1 - APP_CONFIG.QUICK_SELL_LOSS_PCT / 100);
  return Math.max(1, Math.round(afterLoss));
}

function pickAuctionOutcome() {
  const tiers = APP_CONFIG.AUCTION_OUTCOMES;
  const total = tiers.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of tiers) {
    if (r < t.weight) return { label: t.label, multiplier: t.min + Math.random() * (t.max - t.min) };
    r -= t.weight;
  }
  const t = tiers[tiers.length - 1];
  return { label: t.label, multiplier: t.min };
}

function renderInventory() {
  const grid = $("#inventoryGrid");
  $("#invEmpty").hidden = STATE.inventory.length > 0;
  grid.innerHTML = "";
  STATE.inventory.forEach(item => grid.appendChild(buildItemCard(item, false)));
}

function buildItemCard(item, sellable) {
  const el = document.createElement("div");
  el.className = "item-card";
  el.style.setProperty("--rarity-color", rarityColorHex(item.rarity));
  const actionsHtml = sellable ? `
    <div class="i-actions">
      <button class="quick-sell-btn">Quick Sell </span> <span class="btn-sub">${quickSellValue(item).toLocaleString()} cr</span></button>
      <button class="auction-btn">Auction<span class="btn-sub"></span></button>
    </div>` : "";
  el.innerHTML = `
    <div class="i-image"><img src="${imageFor(item)}" alt="" loading="lazy"></div>
    <span class="i-rarity">${item.rarity}</span>
    <div class="i-name">${escapeHtml(item.name)}</div>
    <div class="i-source">from ${escapeHtml(item.wheelName)}</div>
    <div class="i-base">Base value ${item.value.toLocaleString()}</div>
    ${actionsHtml}
  `;
  if (sellable) {
    el.querySelector(".quick-sell-btn").addEventListener("click", () => quickSellItem(item.uid));
    el.querySelector(".auction-btn").addEventListener("click", () => openAuction(item.uid));
  }
  return el;
}

function quickSellItem(uid) {
  const idx = STATE.inventory.findIndex(i => i.uid === uid);
  if (idx === -1) return;
  const item = STATE.inventory[idx];
  const gained = quickSellValue(item);
  STATE.credits += gained;
  STATE.inventory.splice(idx, 1);
  saveCredits(); saveInventory();
  renderCredits(); updateInvCount(); renderInventory(); renderShop(); renderWheelGrid();
  toast(`Quick sold ${item.name} for ${gained.toLocaleString()} credits`);
}

/* ---------------- auction flow ---------------- */
function openAuction(uid) {
  const idx = STATE.inventory.findIndex(i => i.uid === uid);
  if (idx === -1) return;
  const item = STATE.inventory[idx];

  // committed the moment the gavel starts — pull it from inventory now so
  // it can't be sold twice while the auction is "in progress"
  STATE.inventory.splice(idx, 1);
  saveInventory(); updateInvCount(); renderInventory(); renderShop(); renderWheelGrid();

  $("#auctionOverlay").hidden = false;
  $("#auctionResultWrap").hidden = true;
  $("#auctionPreview").innerHTML = `<img src="${imageFor(item)}" alt="${escapeHtml(item.name)}">`;

  const statusEl = $("#auctionStatus");
  const lines = ["Opening the floor…", "Going once…", "Going twice…"];
  let step = 0;
  statusEl.textContent = lines[0];
  const stepInterval = setInterval(() => {
    step++;
    if (step < lines.length) statusEl.textContent = lines[step];
  }, 650);

  setTimeout(() => {
    clearInterval(stepInterval);
    resolveAuction(item);
  }, 2300);
}

function resolveAuction(item) {
  const outcome = pickAuctionOutcome();
  const payout = Math.max(1, Math.round(item.value * outcome.multiplier));

  STATE.credits += payout;
  saveCredits(); renderCredits();

  $("#auctionStatus").textContent = "SOLD!";
  const gainPct = Math.round((outcome.multiplier - 1) * 100);
  const card = $("#auctionResultCard");
  card.style.setProperty("--rarity-color", rarityColorHex(item.rarity));
  card.innerHTML = `
    <span class="r-rarity">${outcome.label}</span>
    <div class="r-name">${escapeHtml(item.name)}</div>
    <div class="r-value">Sold for ${payout.toLocaleString()} credits (${gainPct >= 0 ? "+" : ""}${gainPct}% vs base ${item.value.toLocaleString()})</div>
  `;
  $("#auctionResultWrap").hidden = false;
  toast(`Auctioned ${item.name} for ${payout.toLocaleString()} credits`);
}

$("#closeAuction").addEventListener("click", () => { $("#auctionOverlay").hidden = true; });
$("#auctionDoneBtn").addEventListener("click", () => { $("#auctionOverlay").hidden = true; });

$("#sellAllBtn").addEventListener("click", () => {
  if (!STATE.inventory.length) { toast("Nothing to sell."); return; }
  const items = STATE.activeFilter === "all" ? [...STATE.inventory] : STATE.inventory.filter(i => i.rarity === STATE.activeFilter);
  if (!items.length) { toast("Nothing to sell in this filter."); return; }
  let total = 0;
  items.forEach(i => total += quickSellValue(i));
  const uids = new Set(items.map(i => i.uid));
  STATE.inventory = STATE.inventory.filter(i => !uids.has(i.uid));
  STATE.credits += total;
  saveCredits(); saveInventory();
  renderCredits(); updateInvCount(); renderInventory(); renderShop(); renderWheelGrid();
  toast(`Quick sold ${items.length} items for ${total.toLocaleString()} credits`);
});

/* ---------------- jobs ---------------- */
function startJob(key) {
  if (STATE.jobs[key]) return; // already running
  STATE.jobs[key] = Date.now();
  saveJobs();
  renderJobs();
  updateJobsBadge();
}

// Runs every tick (and once at boot). Awards credits for any job whose
// timer has elapsed — including one that finished while the tab was
// closed, since we compare against the stored start timestamp rather
// than counting down locally. Returns true if anything completed.
function checkJobCompletions() {
  let changed = false;
  APP_CONFIG.JOBS.forEach(job => {
    const startedAt = STATE.jobs[job.key];
    if (!startedAt) return;
    if (Date.now() - startedAt >= job.duration * 1000) {
      STATE.jobs[job.key] = null;
      STATE.credits += job.payout;
      changed = true;
      toast(`${job.name} complete — +${job.payout.toLocaleString()} credits`);
    }
  });
  if (changed) { saveCredits(); saveJobs(); renderCredits(); }
  return changed;
}

function updateJobsBadge() {
  const activeCount = APP_CONFIG.JOBS.filter(j => STATE.jobs[j.key]).length;
  const badge = $("#jobsActiveCount");
  badge.textContent = activeCount;
  badge.hidden = activeCount === 0;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function buildJobCard(job) {
  const el = document.createElement("div");
  const startedAt = STATE.jobs[job.key];

  if (startedAt) {
    el.className = "job-card running";
    const elapsedMs = Date.now() - startedAt;
    const totalMs = job.duration * 1000;
    const pct = Math.min(100, (elapsedMs / totalMs) * 100);
    el.innerHTML = `
      <h3>${escapeHtml(job.name)}</h3>
      <p class="job-desc">${escapeHtml(job.desc)}</p>
      <div class="job-payout">+${job.payout.toLocaleString()} credits</div>
      <div class="job-progress">
        <div class="job-progress-track"><div class="job-progress-fill" style="width:${pct}%"></div></div>
        <span class="job-timer">${formatDuration(totalMs - elapsedMs)} remaining</span>
      </div>
    `;
  } else {
    el.className = "job-card";
    el.innerHTML = `
      <h3>${escapeHtml(job.name)}</h3>
      <p class="job-desc">${escapeHtml(job.desc)}</p>
      <div class="job-payout">+${job.payout.toLocaleString()} credits</div>
      <div class="job-meta">Takes ${formatDuration(job.duration * 1000)}</div>
      <button class="job-start-btn">Start Job</button>
    `;
    el.querySelector(".job-start-btn").addEventListener("click", () => startJob(job.key));
  }
  return el;
}

function renderJobs() {
  const grid = $("#jobsGrid");
  grid.innerHTML = "";
  APP_CONFIG.JOBS.forEach(job => grid.appendChild(buildJobCard(job)));
}

function tickJobs() {
  checkJobCompletions();
  updateJobsBadge();
  if (STATE.currentView === "jobs") renderJobs();
}

/* ---------------- collection book ---------------- */

// Items are matched into a single collection entry by name (trimmed,
// case-insensitive) — so the same car appearing in two different wheels
// counts as one collectible, not two.
function collectionKey(name) {
  return name.trim().toLowerCase();
}

// Builds the full catalog of every unique item across every wheel. Called
// once wheels are loaded/reloaded; drives the "locked" placeholders.
function buildCatalog() {
  const seen = new Map();
  STATE.wheels.forEach(wheel => {
    wheel.loot.forEach(item => {
      const key = collectionKey(item.name);
      if (!seen.has(key)) {
        seen.set(key, {
          key, name: item.name, rarity: item.rarity, value: item.value,
          image: item.image || "", wheelName: wheel.name, wheelKey: wheel.key,
        });
      }
    });
  });
  STATE.catalog = Array.from(seen.values());
}

// Records a permanent discovery the first time an item is won. Returns
// true if this was a brand-new entry (so the spin reveal can show a badge).
function recordDiscovery(item, wheel) {
  const key = collectionKey(item.name);
  if (STATE.collection[key]) return false;
  STATE.collection[key] = {
    name: item.name, rarity: item.rarity, value: item.value,
    image: item.image || "", wheelName: wheel.name, wheelKey: wheel.key,
    ts: Date.now(),
  };
  saveCollection();
  updateCollectionCount();
  return true;
}

function updateCollectionCount() {
  const owned = STATE.catalog.filter(c => STATE.collection[c.key]).length;
  $("#collectionCount").textContent = `${owned}/${STATE.catalog.length}`;
}

function renderCollectionFilters() {
  const wrap = $("#collectionFilters");
  const chips = [`<button class="chip active" data-wheel="all">All</button>`]
    .concat(STATE.wheels.map(w => `<button class="chip" data-wheel="${w.key}">${escapeHtml(w.name)}</button>`));
  wrap.innerHTML = chips.join("");
  wrap.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.collectionFilter = btn.dataset.wheel;
      wrap.querySelectorAll(".chip").forEach(b => b.classList.toggle("active", b === btn));
      renderCollection();
    });
  });
}

function buildCollectionCard(entry) {
  const owned = STATE.collection[entry.key];
  const el = document.createElement("div");
  el.className = "collection-card" + (owned ? "" : " locked");

  if (owned) {
    el.style.setProperty("--rarity-color", rarityColorHex(owned.rarity));
    el.innerHTML = `
      <div class="c-image"><img src="${imageFor(owned)}" alt="" loading="lazy"></div>
      <span class="c-rarity">${owned.rarity}</span>
      <div class="c-name">${escapeHtml(owned.name)}</div>
      <div class="c-source">from ${escapeHtml(owned.wheelName)}</div>
    `;
  } else {
    el.innerHTML = `
      <div class="c-image"><span>?</span></div>
      <span class="c-rarity">???</span>
      <div class="c-name">Undiscovered</div>
      <div class="c-source">from ${escapeHtml(entry.wheelName)}</div>
    `;
  }
  return el;
}

function renderCollection() {
  updateCollectionCount();
  const grid = $("#collectionGrid");
  const entries = STATE.collectionFilter === "all"
    ? STATE.catalog
    : STATE.catalog.filter(c => c.wheelKey === STATE.collectionFilter);

  grid.innerHTML = "";
  entries.forEach(entry => grid.appendChild(buildCollectionCard(entry)));

  const total = STATE.catalog.length;
  const owned = STATE.catalog.filter(c => STATE.collection[c.key]).length;
  $("#collectionProgressLabel").textContent = `${owned} / ${total} discovered`;
  $("#collectionProgressFill").style.width = total ? `${(owned / total) * 100}%` : "0%";
}

/* ---------------- auction house ---------------- */
function renderShop() {
  const grid = $("#shopGrid");
  const items = STATE.activeFilter === "all"
    ? STATE.inventory
    : STATE.inventory.filter(i => i.rarity === STATE.activeFilter);

  $("#shopEmpty").hidden = STATE.inventory.length > 0;
  grid.innerHTML = "";
  items.forEach(item => grid.appendChild(buildItemCard(item, true)));
}

/* ---------------- tabs ---------------- */
$all(".tab-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

/* ---------------- boot ---------------- */
async function boot() {
  loadState();
  renderCredits();
  renderRarityFilters();
  updateInvCount();

  const status = $("#dataStatus");
  status.hidden = false;
  status.classList.add("loading");
  status.innerHTML = `<span class="spinner"></span> Loading loot tables…`;
  renderWheelSkeletons();

  try {
    let loadedWheels = null;
    if (APP_CONFIG.DATA_SOURCE === "local") {
      loadedWheels = await loadWheelsFromLocalCSV();
    } else if (APP_CONFIG.DATA_SOURCE === "sheet") {
      loadedWheels = await loadWheelsFromSheet();
    }
    if (loadedWheels) {
      STATE.wheels = loadedWheels;
      status.hidden = true;
    } else {
      STATE.wheels = demoWheels();
      status.hidden = false;
      status.textContent = "Running on demo loot tables — set DATA_SOURCE and the matching data in config.js to go live.";
    }
  } catch (err) {
    console.error(err);
    STATE.wheels = demoWheels();
    status.hidden = false;
    const sourceLabel = APP_CONFIG.DATA_SOURCE === "sheet" ? "your Google Sheet" : "your local CSV files";
    status.textContent = `Couldn't load ${sourceLabel} (${err.message}). Showing demo loot tables instead.`;
  }
  status.classList.remove("loading");

  buildCatalog();
  renderCollectionFilters();
  updateCollectionCount();

  checkJobCompletions(); // catch up on anything that finished while the tab was closed
  updateJobsBadge();
  setInterval(tickJobs, 1000);

  renderWheelGrid();

}

boot();
