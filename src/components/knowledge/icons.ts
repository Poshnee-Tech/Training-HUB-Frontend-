/**
 * Icon names the knowledge screens can use.
 *
 * A block stores its icon as a NAME, because a database cannot store a React
 * component. This registry is what turns the name back into one.
 *
 * It is an explicit list rather than a wildcard re-export of lucide-react for
 * two reasons: the wildcard would pull every icon in the library into the
 * bundle, and an admin picking from a closed list cannot save a name that
 * renders nothing. The admin form offers exactly these.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Accessibility, Activity, Ambulance, Baby, BadgeCheck, BadgePercent, Ban, Banknote,
  BarChart3, BedDouble, BookMarked, Brain, Briefcase, Building2, CalendarClock, Car,
  Check, CircleX, ClipboardCheck, CreditCard, Dumbbell, Ear, Eye, FileText, Gift,
  Globe, HeartHandshake, HeartPulse, Info, Landmark, Layers, MapPin, Microscope,
  NotebookPen, PhoneCall, Pill, Puzzle, Quote, ScrollText, ShieldCheck, ShieldPlus,
  Smile, Sparkles, Stethoscope, Store, Syringe, User, UserCheck, Users, Wallet,
} from 'lucide-react';

export const KNOWLEDGE_ICONS: Record<string, LucideIcon> = {
  Accessibility, Activity, Ambulance, Baby, BadgeCheck, BadgePercent, Ban, Banknote,
  BarChart3, BedDouble, BookMarked, Brain, Briefcase, Building2, CalendarClock, Car,
  Check, CircleX, ClipboardCheck, CreditCard, Dumbbell, Ear, Eye, FileText, Gift,
  Globe, HeartHandshake, HeartPulse, Info, Landmark, Layers, MapPin, Microscope,
  NotebookPen, PhoneCall, Pill, Puzzle, Quote, ScrollText, ShieldCheck, ShieldPlus,
  Smile, Sparkles, Stethoscope, Store, Syringe, User, UserCheck, Users, Wallet,
};

export const KNOWLEDGE_ICON_NAMES = Object.keys(KNOWLEDGE_ICONS).sort();

/**
 * Resolve an icon name, falling back to a neutral mark.
 *
 * Never throws and never renders nothing: an unrecognised name (a typo, or a
 * name from a newer admin build) shows the fallback so the row around it still
 * reads, rather than blanking the screen it sits on.
 */
export function iconFor(name: string | null | undefined): LucideIcon {
  if (!name) return Info;
  return KNOWLEDGE_ICONS[name] ?? Info;
}
