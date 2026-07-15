// Icon.js — one icon system for the whole app.
// Semantic names -> Lucide vector icons. Never use emoji in UI again;
// use <Icon name="crew" size={20} color={C.ink} />.
import React from 'react';
import {
  Home, ClipboardList, Clock, User, Wrench, Wallet,
  HardHat, Truck, Construction, ShoppingCart, Package, Car,
  MapPin, Navigation, Radio, Check, ChevronRight, ChevronLeft,
  ChevronDown, ChevronUp, Plus, Minus, X, Circle, CircleDot,
  Zap, Calendar, Search, Settings, LogOut, Building2, CreditCard,
  BadgeCheck, ShieldCheck, TrendingUp, Bell, Star, Users, Signal,
} from 'lucide-react-native';
import { C } from './theme';

const MAP = {
  // nav
  home: Home,
  requests: ClipboardList,
  activity: Clock,
  account: User,
  jobs: Wrench,
  earnings: Wallet,
  // request kinds
  gear: Construction,
  crew: HardHat,
  task: Car,
  // specific types (fallback to kind if not listed)
  excavator: Construction,
  tipper: Truck,
  'line pump': Construction,
  labourer: HardHat,
  'traffic controller': HardHat,
  'bunnings pickup': ShoppingCart,
  'parts run': Wrench,
  'materials drop': Package,
  // status / ui
  pin: MapPin,
  navigate: Navigation,
  live: Radio,
  check: Check,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  plus: Plus,
  minus: Minus,
  close: X,
  circle: Circle,
  dot: CircleDot,
  urgent: Zap,
  calendar: Calendar,
  search: Search,
  settings: Settings,
  signout: LogOut,
  company: Building2,
  payment: CreditCard,
  verified: BadgeCheck,
  insurance: ShieldCheck,
  trending: TrendingUp,
  bell: Bell,
  star: Star,
  users: Users,
  signal: Signal,
};

export default function Icon({ name, size = 20, color = C.ink, strokeWidth = 2, fill = 'none' }) {
  const key = (name || '').toLowerCase();
  const Cmp = MAP[key] || Circle;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} fill={fill} />;
}

// helper: pick an icon name for a request item type
export function iconForType(type = '', kind = '') {
  const t = type.toLowerCase();
  if (MAP[t]) return t;
  return kind || 'gear';
}
