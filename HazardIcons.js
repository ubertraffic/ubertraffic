// HazardIcons.js — simple, universally-legible safety pictograms for the arrival prestart.
// Emoji render differently on every device and read as decoration; these are crisp vector
// diagrams that mean the same thing to every worker at a glance (incl. low-literacy / ESL),
// drawn with react-native-svg so they're pixel-sharp at any size and themable by one colour.
//
// One shape language: bold, filled silhouettes with a single accent colour, no fine detail.
// Each maps to a prestart trigger key.

import React from 'react';
import Svg, { Path, Rect, Circle, Line, Polygon } from 'react-native-svg';

// Traffic cone — "working on/next to a road or live traffic".
function ConeIcon({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="12,3.5 17.6,18 6.4,18" fill={color} />
      <Rect x="4" y="18" width="16" height="2.8" rx="1.4" fill={color} />
      <Path d="M10.2 10.5 h3.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M8.9 14 h6.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

// Excavator — "around moving powered plant (excavators, cranes, loaders)".
function PlantIcon({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* tracks */}
      <Rect x="2.5" y="15.5" width="12.5" height="4.5" rx="2.25" fill={color} />
      {/* cab */}
      <Rect x="4.5" y="9.5" width="6" height="6" rx="1.3" fill={color} />
      {/* boom + arm */}
      <Path d="M10.5 11 L16.5 8 L21 11.5" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* bucket */}
      <Path d="M21 11.5 l1 3 l-3.4 0.4 z" fill={color} />
    </Svg>
  );
}

// Fall from height — "risk of falling more than 2 metres". The universal pictogram: a figure
// tumbling off a raised edge. Reads instantly, no words needed.
function FallIcon({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* the raised edge you fall from */}
      <Path d="M13.5 12 H21" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M13.5 12 V20" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {/* the falling figure */}
      <Circle cx="8.4" cy="6.4" r="2.1" fill={color} />
      <Path d="M8.4 8.6 L10.6 13" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M8.4 9.4 L5.2 7.6 M9.6 11 L12 9.3" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M10.6 13 L7.9 16.6 M10.6 13 L12.4 17.2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

// Asbestos / demolition / structural — the universal danger triangle.
function WarningIcon({ size, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.8 L21 19 a1 1 0 0 1 -0.87 1.5 H3.87 A1 1 0 0 1 3 19 Z"
        stroke={color} strokeWidth="2" strokeLinejoin="round" fill="none" />
      <Line x1="12" y1="9.5" x2="12" y2="14" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Circle cx="12" cy="16.8" r="1.15" fill={color} />
    </Svg>
  );
}

const MAP = { road_traffic: ConeIcon, mobile_plant: PlantIcon, fall_over_2m: FallIcon, asbestos_demo: WarningIcon };

export default function HazardIcon({ name, size = 26, color = '#111114' }) {
  const Cmp = MAP[name] || WarningIcon;
  return <Cmp size={size} color={color} />;
}
