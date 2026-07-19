// taxonomyService.js — the ONE place the app reads the trade taxonomy.
// Categories → trades, with client-side search over name + aliases.
import { supabase } from './supabaseClient';

let _cache = null;   // { categories: [...], trades: [...] } — taxonomy is static-ish, cache it

export async function loadTaxonomy() {
  if (_cache) return _cache;
  const [{ data: categories, error: cErr }, { data: trades, error: tErr }] = await Promise.all([
    supabase.from('trade_categories').select('id, name, icon, sort').order('sort'),
    supabase.from('trades').select('id, category_id, name, kind, aliases, sort, client_visible, match_group, run_style').order('sort'),
  ]);
  if (cErr) throw cErr;
  if (tErr) throw tErr;
  _cache = { categories: categories || [], trades: trades || [] };
  return _cache;
}

// trades within one category
export function tradesInCategory(taxonomy, categoryId) {
  return (taxonomy.trades || []).filter((t) => t.category_id === categoryId);
}

// search across ALL trades by name + aliases (case-insensitive, partial)
export function searchTrades(taxonomy, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return (taxonomy.trades || []).filter((t) => {
    if (t.name.toLowerCase().includes(q)) return true;
    return (t.aliases || []).some((a) => a.toLowerCase().includes(q));
  }).slice(0, 12);
}

// look up a single trade by id (for rendering saved selections)
export function tradeById(taxonomy, id) {
  return (taxonomy.trades || []).find((t) => t.id === id) || null;
}

// ── DISPLAY NAMING ───────────────────────────────────────────────────────────
// Every trade/job title is DISPLAYED in Title Case for one consistent, professional read across the
// whole app — "Traffic Control", never "Traffic control". This is PRESENTATION ONLY: we never mutate
// the stored trade name/type, because dispatch matching and rate lookups key off the raw value.
// Naive title-casing already yields the right result for the whole taxonomy ("Dogman / rigger" →
// "Dogman / Rigger", "Bin / tip run" → "Bin / Tip Run"); we only special-case connector words and a
// few acronyms so they don't read oddly.
const TITLE_SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'on', 'to', 'for', 'with', 'or', 'at', 'in', 'by', 'per']);
const TITLE_ACRONYM = new Set(['tc', 'ppe', 'swms', 'epa', 'hr', 'lr', 'mr', 'hc', 'mc', '4wd', 'ewp', 'nsw', 'wc', 'ita']);
export function tradeTitle(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  let n = 0;
  return s.replace(/[A-Za-z0-9]+/g, (word) => {
    const low = word.toLowerCase();
    const first = n === 0;
    n += 1;
    if (TITLE_ACRONYM.has(low)) return word.toUpperCase();
    if (!first && TITLE_SMALL.has(low)) return low;
    return low.charAt(0).toUpperCase() + low.slice(1);
  });
}

// FRONT DOORS — the four human-friendly groups a Hirer picks first. Routing is by
// the trade's KIND (reliable) plus category, not fuzzy name matching.
//   Equipment = plant (machines/vehicles)
//   Tasks     = task  (community runs — anyone can help)
//   Trades    = crew in the skilled categories
//   Work      = crew in the labour/traffic categories
export const FRONT_DOORS = [
  { key: 'equipment', label: 'Equipment', sub: 'Machines, plant & vehicles', color: '#2C6E8F' },
  { key: 'trades',    label: 'Skilled Trades', sub: 'Ticketed tradespeople', color: '#4636E8' },
  { key: 'work',      label: 'Traffic & Labour', sub: 'Traffic control, labourers & site support', color: '#0E7A52' },
  { key: 'tasks',     label: 'Tasks',     sub: 'Quick community runs — anyone can help', color: '#B87514' },
];

// category names that belong to the "Work" door (labour + traffic). Everything
// else with kind='crew' is a skilled "Trade".
const WORK_CATEGORIES = ['labour', 'traffic'];

function doorForTrade(trade, categoryName) {
  const n = (categoryName || '').toLowerCase();
  if (trade.kind === 'task') return 'tasks';
  if (trade.kind === 'plant') return 'equipment';
  // crew: split between Work (labour/traffic) and Trades (skilled)
  if (WORK_CATEGORIES.some((w) => n.includes(w))) return 'work';
  return 'trades';
}

// all trades under a front door, GROUPED by their category for organised display.
// returns [{ category, trades: [...] }, ...] in taxonomy order.
export function groupedTradesForDoor(taxonomy, doorKey) {
  const catById = Object.fromEntries((taxonomy.categories || []).map((c) => [c.id, c]));
  const groups = {};  // categoryId -> { category, trades }
  (taxonomy.trades || []).forEach((t) => {
    const cat = catById[t.category_id];
    if (!cat) return;
    // client picker only: hide worker-only variants (e.g. traffic implementer/combo) so the
    // client sees ONE clean intent per concept. Worker capability picker uses tradesInCategory,
    // which is unfiltered, so workers still declare the specific trade they hold.
    if (t.client_visible === false) return;
    if (doorForTrade(t, cat.name) !== doorKey) return;
    if (!groups[cat.id]) groups[cat.id] = { category: cat, trades: [] };
    groups[cat.id].trades.push(t);
  });
  // order by category sort
  return Object.values(groups).sort((a, b) => (a.category.sort || 0) - (b.category.sort || 0));
}

// flat list (kept for any callers that just want the trades)
export function tradesForDoor(taxonomy, doorKey) {
  return groupedTradesForDoor(taxonomy, doorKey).flatMap((g) => g.trades);
}

// CLIENT POST PICKER — one clean list used by EVERY client posting surface so they
// never drift. Every client-visible trade grouped by its category ONCE (no per-door
// duplicate headers), with the community task/errand categories FIRST under a
// "Tasks & runs" banner (anyone with a vehicle), then the ticketed "Skilled trades &
// plant". Returns a flat array mixing banner rows { section, color } and category
// groups { category, trades, doorColor }. Pass your theme's task/skilled accent colours.
export function clientPickerGroups(taxonomy, { task = '#B87514', skilled = '#4636E8' } = {}) {
  if (!taxonomy) return [];
  const catById = Object.fromEntries((taxonomy.categories || []).map((c) => [c.id, c]));
  const byCat = {};
  (taxonomy.trades || []).forEach((t) => {
    if (t.client_visible === false) return;
    const cat = catById[t.category_id];
    if (!cat) return;
    if (!byCat[cat.id]) byCat[cat.id] = { category: cat, trades: [], allTask: true };
    byCat[cat.id].trades.push(t);
    if (t.kind !== 'task') byCat[cat.id].allTask = false;
  });
  const groups = Object.values(byCat);
  const bySort = (a, b) => (a.category.sort || 0) - (b.category.sort || 0);
  const taskCats = groups.filter((g) => g.allTask).sort(bySort);
  const skilledCats = groups.filter((g) => !g.allTask).sort(bySort);
  const out = [];
  if (taskCats.length) out.push({ section: 'Tasks & runs · anyone with a vehicle', color: task });
  taskCats.forEach((g) => out.push({ ...g, doorColor: task }));
  if (skilledCats.length) out.push({ section: 'Skilled trades & plant', color: skilled });
  skilledCats.forEach((g) => out.push({ ...g, doorColor: skilled }));
  return out;
}

export function categoriesForDoor(taxonomy, doorKey) {
  return groupedTradesForDoor(taxonomy, doorKey).map((g) => g.category);
}

// ── PICKER v2 (researched IA) ────────────────────────────────────────────────
// Problem the old clientPickerGroups had: it emitted EVERY task category as its own
// accordion (all open by default), so a hirer scrolled past 5-6 expanded task folders
// before skilled trades even appeared. Research (NN/G accordions-on-mobile, LogRocket,
// Airtasker's "top categories" shortcuts) says: lead with the popular few, then a SMALL
// set of folders COLLAPSED by default. So:
//   1) featuredTrades() — the handful people pick most, shown up top as one tap.
//   2) pickerFolders()  — exactly FOUR folders, all collapsed: the whole driver-licence
//      "Tasks & runs" tier merged into ONE (not many), then Traffic & labour, Skilled
//      trades, Equipment & plant.

// The most-requested jobs, curated by name/alias match so it survives taxonomy edits.
// Order = priority; first match per slot wins, deduped, capped.
const FEATURED_PATTERNS = [
  ['traffic control', 'traffic controller', 'tc'],
  ['general labour', 'labourer', 'labour'],
  ['rubbish', 'skip', 'removal', 'waste'],
  ['delivery', 'materials run', 'pickup run', 'bunnings', 'parts run', 'courier'],
  ['clean', 'site clean'],
  ['handyman', 'handy'],
];
export function featuredTrades(taxonomy, limit = 6) {
  if (!taxonomy) return [];
  const visible = (taxonomy.trades || []).filter((t) => t.client_visible !== false);
  const hit = (t, p) => t.name.toLowerCase().includes(p) || (t.aliases || []).some((a) => a.toLowerCase().includes(p));
  const out = [];
  const seen = new Set();
  for (const pats of FEATURED_PATTERNS) {
    const match = visible.find((t) => !seen.has(t.id) && pats.some((p) => hit(t, p)));
    if (match) { out.push(match); seen.add(match.id); }
    if (out.length >= limit) break;
  }
  return out;
}

// The four collapsed folders. colors: { task, work, skilled, equipment }.
const FOLDER_DEFS = [
  { key: 'tasks',     label: 'Tasks & runs',      sub: 'Anyone with a driver licence', colorKey: 'task' },
  { key: 'work',      label: 'Traffic & labour',  sub: 'Traffic control, labourers & site support', colorKey: 'work' },
  { key: 'trades',    label: 'Skilled trades',    sub: 'Ticketed tradespeople', colorKey: 'skilled' },
  { key: 'equipment', label: 'Equipment & plant', sub: 'Machines, plant & vehicles', colorKey: 'equipment' },
];
export function pickerFolders(taxonomy, colors = {}) {
  if (!taxonomy) return [];
  const catById = Object.fromEntries((taxonomy.categories || []).map((c) => [c.id, c]));
  const byDoor = { tasks: [], work: [], trades: [], equipment: [] };
  (taxonomy.trades || []).forEach((t) => {
    if (t.client_visible === false) return;
    const cat = catById[t.category_id];
    if (!cat) return;
    const door = doorForTrade(t, cat.name);   // task→tasks, plant→equipment, crew→work|trades
    if (byDoor[door]) byDoor[door].push(t);
  });
  return FOLDER_DEFS
    .map((f) => ({ key: f.key, label: f.label, sub: f.sub, color: colors[f.colorKey], trades: byDoor[f.key] || [] }))
    .filter((f) => f.trades.length > 0);
}
