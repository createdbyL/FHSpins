/*
  ================================
  FESTIVAL WHEELS — CONFIGURATION
  ================================

  Loot table data comes from one of two places, controlled by DATA_SOURCE
  below:

  "local" (default, fastest) — plain CSV files sitting next to wheel.html
  in a folder (LOCAL_DATA_DIR, default "data/"). No network fetch to any
  third party, so it loads almost instantly and works offline once the
  page itself is cached. This is what ships in the starter files.

    data/config.csv   — one row per wheel:
       key,name,cost,color,mode
       bronze,Bronze Wheel,100,#8a93a3,standard
       super,Super Wheel Spin,5000,#ff2e63,super

    - key: unique short id for the wheel, used to link its rows in items.csv
    - mode: "standard" (has its own loot rows) or "super" (special —
      pulls only from cars you haven't collected yet, no items.csv rows
      needed for it). Leave blank for "standard".

    data/items.csv    — every wheel's loot rows in ONE file, tagged by a
                         "wheel" column matching the wheel's key above:
       wheel,name,rarity,value,weight,image,desc
       bronze,Rusty Pickup,common,800,40,,
       bronze,Vintage Roadster,epic,42000,5,,
       silver,Turbo Coupe,rare,15000,35,,

    - wheel: which wheel this row belongs to (must match a "key" in config.csv)
    - rarity: common / rare / epic / legendary (controls color)
    - value: credits earned when this item is sold
    - weight: relative odds of landing this segment (bigger = more common)
    - image: optional direct image URL — leave blank for a placeholder
    - desc: optional, currently unused in the UI

    Since every wheel's rows live in the same file, tuning weights and
    values is one spreadsheet to scroll/sort through instead of hunting
    across several per-wheel files.

    Editing these is just editing text files — commit the change and
    redeploy (or refresh, if you're serving locally). No sharing settings,
    no waiting on Google's servers.

    Note: fetching local files with `fetch()` requires the page to be
    served over http(s) — a real server (GitHub Pages counts) or a local
    dev server like `python3 -m http.server`. Double-clicking wheel.html
    to open it as a file:// URL will NOT work, the fetches get blocked.

  "sheet" — reads live from a Google Sheet instead, useful if you want to
  edit loot tables from anywhere without touching the repo. Slower to load
  since it's requests to Google's servers. Set:
       DATA_SOURCE: "sheet"
       SHEET_ID: "the long ID from your sheet's URL"
  and share the sheet as "Anyone with the link" → Viewer. Mirrors the local
  structure: a Config tab (wheels) plus one Items tab shared by every wheel,
  same "wheel" column linking rows to a wheel's key.

  Leaving DATA_SOURCE unset/invalid, or leaving SHEET_ID blank while set
  to "sheet", falls back to small built-in demo data so the site still
  works out of the box.
*/

const APP_CONFIG = {
  DATA_SOURCE: "local", // "local" | "sheet"

  // Used when DATA_SOURCE is "local": folder path (relative to wheel.html),
  // and the filename of the shared items file within it
  LOCAL_DATA_DIR: "data",
  ITEMS_FILE: "items.csv",

  // Used when DATA_SOURCE is "sheet"
  SHEET_ID: "",
  CONFIG_TAB: "Config",
  ITEMS_TAB: "Items",

  // Starting credits for first-time visitors
  STARTING_CREDITS: 100000,

  // Quick Sell: instant, guaranteed, but always at a loss off base value
  QUICK_SELL_LOSS_PCT: 50,

  // Auction: a weighted table of possible outcomes. Each item's final
  // payout = base value × a random multiplier between min/max of whichever
  // tier gets picked (weight = relative odds, same idea as loot weights).
  // Tune freely — add/remove tiers, adjust ranges, whatever you like.
  AUCTION_OUTCOMES: [
    { label: "STOLEN (1 credit was left at the scene)", min: 0.0, max: 0.0, weight: 1},
    { label: "Lowball bid", min: 0.4, max: 0.5, weight: 14 },
    { label: "Fair market price", min: 0.9, max: 1.1, weight: 50 },
    { label: "Strong bidding", min: 1.2, max: 1.5, weight: 20 },
    { label: "Bidding war!", min: 1.6, max: 1.8, weight: 14 },
    { label: "Jackpot buyer!", min: 2.0, max: 3.0, weight: 1 },
  ],
  // Jobs: a free way to earn credits over time if you run out. Each job
  // runs independently on its own timer — start it, wait, it pays out
  // automatically (even if you closed the tab while it was running).
  // duration is in seconds. Add, remove, or retune freely.
  JOBS: [
    { key: "wash", name: "Car Wash", desc: "Detail cars in the paddock.", duration: 30, payout: 15000 },
    { key: "tow", name: "Tow Truck Run", desc: "Recover stranded racers.", duration: 60, payout: 30000 },
    { key: "pit", name: "Pit Crew Shift", desc: "Work a full shift on the pit wall.", duration: 180, payout: 60000 },
    { key: "vip", name: "VIP Chauffeur", desc: "Drive festival VIPs between events.", duration: 300, payout: 120000 },
  ],
};
