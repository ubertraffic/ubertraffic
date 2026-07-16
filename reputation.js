// reputation.js — shared vocabulary for the reputation layer.
// "Good unit" tags: the specific, scannable behaviours a client (and later a peer)
// can tap after a job. Kept as one source of truth so the rating prompt, the peer
// vouch, and the profile badges all speak the same language. Pure constants — safe
// to import anywhere (no supabase), including on Snack.

export const GOOD_UNIT_TAGS = [
  'On time',
  'Hard worker',
  'Safe on site',
  'Knows their gear',
  'Good communicator',
  'Tidy',
  'Good attitude',
  'Reliable',
];
