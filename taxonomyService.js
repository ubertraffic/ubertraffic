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

export function categoriesForDoor(taxonomy, doorKey) {
  return groupedTradesForDoor(taxonomy, doorKey).map((g) => g.category);
}
