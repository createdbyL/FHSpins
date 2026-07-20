
const APP_CONFIG = {
  DATA_SOURCE: "local", // "local" | "sheet"

  // Used when DATA_SOURCE is "local": folder path (relative to index.html),
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

  // Auction: a weighted table of possible outcomes.
  // payout = base value × a random multiplier between min/max
  // tier gets picked (weight = relative odds  
  AUCTION_OUTCOMES: [
    { label: "STOLEN (1 credit was left at the scene)", min: 0.0, max: 0.0, weight: 1},
    { label: "Lowball bid", min: 0.6, max: 0.7, weight: 14 },
    { label: "Fair market price", min: 0.9, max: 1.1, weight: 50 },
    { label: "Strong bidding", min: 1.2, max: 1.4, weight: 20 },
    { label: "Bidding war!", min: 1.5, max: 1.6, weight: 14 },
    { label: "Jackpot buyer!", min: 2.0, max: 3.0, weight: 1 },
  ],
  // Jobs: a free way to earn credits over time if you run out
  JOBS: [
    { key: "wash", name: "Car Wash", desc: "Detail cars in the paddock.", duration: 30, payout: 15000 },
    { key: "tow", name: "Tow Truck Run", desc: "Recover stranded racers.", duration: 60, payout: 30000 },
    { key: "pit", name: "Pit Crew Shift", desc: "Work a full shift on the pit wall.", duration: 180, payout: 60000 },
    { key: "vip", name: "VIP Chauffeur", desc: "Drive festival VIPs between events.", duration: 300, payout: 120000 },
  ],
};
