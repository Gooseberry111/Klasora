import type { Component } from 'vue';
import { LayoutDashboard, ShieldCheck, UserRound } from 'lucide-vue-next';
import type { PermissionKey } from '@klasora/shared';

export interface NavItem {
  label: string;
  routeName: string;
  icon: Component;
  /** The user needs at least one of these permissions to see the item. Omit for everyone. */
  anyOf?: PermissionKey[];
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

/**
 * Sidebar definition. Only modules that actually exist are listed — new
 * sections (School management, Academics, Communication, Finance) are added
 * here as each phase ships, so there are never links to unfinished screens.
 */
export const NAVIGATION: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ label: 'Dashboard', routeName: 'dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'System',
    items: [
      { label: 'User roles', routeName: 'roles', icon: ShieldCheck, anyOf: ['roles.view'] },
      { label: 'My account', routeName: 'account', icon: UserRound },
    ],
  },
];

/** Filters the navigation to what the current user may open; drops empty sections. */
export function visibleNavigation(can: (permission: PermissionKey) => boolean, sections = NAVIGATION): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.anyOf || item.anyOf.some((p) => can(p))),
    }))
    .filter((section) => section.items.length > 0);
}
