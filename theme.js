// theme.js — the single source of design truth.
// Fintech "precision instrument": light canvas, electric indigo, mono as a SPICE
// (numbers/rates/IDs/status only), clean Inter-style system font for everything
// people actually read. One place to change the look of the whole app.
import { Platform } from 'react-native';

export const C = {
  canvas:   '#F7F6F3',   // warm paper, a touch deeper so cards lift off it
  panel:    '#FFFFFF',
  panel2:   '#F1F0EC',
  ink:      '#111114',   // near-black, deep and confident
  ink2:     '#42424A',
  line:     '#EAEAE6',   // fainter — we lean on shadow, not borders
  line2:    '#F1F1ED',
  mute:     '#78787F',
  mute2:    '#A6A6AC',
  indigo:   '#4636E8',   // slightly deeper, richer than electric — reads premium
  indigoSoft:'rgba(70,54,232,0.09)',
  indigoWash:'rgba(70,54,232,0.055)',
  green:    '#0E7A52',   // deeper, more sophisticated green
  greenSoft:'rgba(14,122,82,0.10)',
  amber:    '#B87514',
  amberSoft:'rgba(184,117,20,0.12)',
  // hi-vis signal amber — the ONE "live / now" accent. Site/traffic identity. Used sparingly:
  // live indicators, "happening now" pulses, urgent moments. Never as a general-purpose colour.
  hiviz:    '#FFB020',
  hivizSoft:'rgba(255,176,32,0.15)',
  hivizGlow:'rgba(255,176,32,0.55)',
  red:      '#B23A2E',
  redSoft:  'rgba(178,58,46,0.09)',
  scrim:    'rgba(10,10,14,0.45)',
};

// mono ONLY for data. Everything else uses the system UI font (SF on iOS = premium).
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// spacing scale — consistent rhythm
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 };

// radius scale
export const R = { sm: 8, md: 11, lg: 14, xl: 18, xxl: 24, pill: 999 };

// TYPE SYSTEM — refined sans throughout (premium fintech). Mono is retired from
// the UI; hierarchy comes from weight + size + tracking, not from a terminal font.
export const T = {
  display:{ fontSize: 34, fontWeight: '800', letterSpacing: -0.9, color: C.ink },
  title:  { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: C.ink },
  heading:{ fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: C.ink },
  subhead:{ fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: C.ink },
  body:   { fontSize: 15, fontWeight: '400', color: C.ink2, lineHeight: 21 },
  bodyStrong:{ fontSize: 15, fontWeight: '600', color: C.ink, letterSpacing: -0.1 },
  small:  { fontSize: 13, fontWeight: '400', color: C.mute, lineHeight: 18 },
  tiny:   { fontSize: 11.5, fontWeight: '500', color: C.mute, lineHeight: 15 },
  // section kickers — refined sans caps, softly tracked (not mono, not shouting)
  eyebrow:{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: C.mute2, textTransform: 'uppercase' },
  label:  { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, color: C.mute },
  // data = tabular-feeling sans, still crisp for numbers but not a terminal
  data:   { fontSize: 13, fontWeight: '600', color: C.ink, letterSpacing: -0.1 },
  dataBig:{ fontSize: 24, fontWeight: '800', color: C.ink, letterSpacing: -0.6 },
  money:  { fontSize: 18, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  prompt: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5, color: C.ink },
};

// ELEVATION — soft, diffuse, warm-toned. Premium = float on shadow, not borders.
export const E = {
  sm: { shadowColor: '#1A1208', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  md: { shadowColor: '#1A1208', shadowOpacity: 0.07, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  lg: { shadowColor: '#1A1208', shadowOpacity: 0.14, shadowRadius: 34, shadowOffset: { width: 0, height: 14 }, elevation: 16 },
  // coloured lift — for the ONE primary moment (needs-you card)
  indigo: { shadowColor: '#4636E8', shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
};

// MOTION — one place for durations/spring so animation feels consistent.
export const M = {
  fast: 180, base: 220, slow: 300,
  spring: { damping: 22, stiffness: 220, mass: 0.9 },   // the sheet-rise feel
  // Uber-style springs: quick, a touch of bounce, settle fast.
  springSnappy: { damping: 18, stiffness: 260, mass: 0.8 },   // cards arriving / reordering
  springSoft:   { damping: 26, stiffness: 180, mass: 1 },     // bars, counts, gentle settles
  pressScale: 0.97,   // tactile press feedback
};

// COMPONENT TOKENS — semantic sizing so buttons/targets/cards are uniform.
export const Z = {
  touch: 44,          // min touch target (accessibility floor)
  btnH: 52,           // standard primary button height
  btnHsm: 42,         // compact button / stepper
  cardPad: 16,        // standard card interior padding
  fieldH: 50,         // input field height
  hairline: 1,        // border width
};

// soft shadow used on cards (subtle, premium) — kept for back-compat; prefer E.*
export const shadow = E.md;
export const shadowSm = E.sm;
