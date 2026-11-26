import type { SubscriptionPlan } from '@klasora/shared';

/** "Up to 300 students", "Unlimited campuses", "1 campus". */
export function describeLimit(limit: number | null, singular: string, plural = `${singular}s`): string {
  if (limit === null) return `Unlimited ${plural}`;
  if (limit === 1) return `1 ${singular}`;
  return `Up to ${limit.toLocaleString('en-NG')} ${plural}`;
}

export function describeStorage(megabytes: number | null): string {
  if (megabytes === null) return 'Custom storage';
  return megabytes >= 1024 ? `${Math.round(megabytes / 1024)} GB storage` : `${megabytes} MB storage`;
}

const SUPPORT_LABELS: Record<string, string> = {
  standard: 'Email support',
  priority: 'Priority support',
  dedicated: 'Dedicated success manager',
};

/** Human-readable highlights derived from a plan's stored limits and features. */
export function planHighlights(plan: SubscriptionPlan): string[] {
  const features = plan.feature_limits ?? {};
  const list = [describeStorage(plan.storage_limit_mb)];
  if (features.parent_portal) list.push('Parent and student portals');
  if (features.mobile_app) list.push('Android and iOS apps');
  if (features.advanced_reports) list.push('Advanced reports and analytics');
  if (features.api_access) list.push('API access');
  list.push(SUPPORT_LABELS[plan.support_level] ?? 'Email support');
  return list;
}
