/**
 * Tier-based authorization utilities for bot access control
 */

import { User } from '../types/api';
import { logInfo } from './logger';

/**
 * Tiers that have bot access (stored in lowercase for case-insensitive comparison)
 */
export const AUTHORIZED_TIERS = ['alpha', 'wizard_backer', 'admin'] as const;

export type AuthorizedTier = typeof AUTHORIZED_TIERS[number];

/**
 * Commands that are exempt from tier checking
 * These commands can be used by anyone, even unlinked users
 */
export const TIER_EXEMPT_COMMANDS = ['link', 'ping', 'diagnostics', 'help'] as const;

export type TierExemptCommand = typeof TIER_EXEMPT_COMMANDS[number];

/**
 * Check if a user has an authorized tier for bot access
 * Grants access if user has:
 * - An accessTier (alpha, wizard_backer, admin), OR
 * - Any active subscription tier (free, apprentice, wizard)
 *
 * All tier comparisons are case-insensitive.
 */
export function hasAuthorizedTier(user: User | null | undefined): boolean {
  if (!user) {
    logInfo('User is null or undefined', { userId: user?.id });
    return false;
  }

  // Check accessTier (alpha, wizard_backer, admin) - case insensitive
  const normalizedTier = user.tier?.toLowerCase().trim();
  const hasAccessTier = normalizedTier && AUTHORIZED_TIERS.includes(normalizedTier as AuthorizedTier);

  // Check if user has any subscription tier at all - case insensitive
  const normalizedSubscriptionTier = user.subscriptionTier?.toLowerCase().trim();
  const hasSubscription = normalizedSubscriptionTier && normalizedSubscriptionTier !== '';

  const hasAccess = hasAccessTier || hasSubscription;

  logInfo('Tier authorization check', {
    userId: user.id,
    accessTier: user.tier,
    normalizedTier,
    subscriptionTier: user.subscriptionTier,
    normalizedSubscriptionTier,
    hasAccessTier,
    hasSubscription,
    authorizedTiers: AUTHORIZED_TIERS,
    hasAccess
  });

  return hasAccess;
}

/**
 * Check if a command is exempt from tier checking
 */
export function isCommandTierExempt(commandName: string): boolean {
  return TIER_EXEMPT_COMMANDS.includes(commandName as TierExemptCommand);
}

/**
 * Get the error message for unauthorized access
 */
export function getUnauthorizedAccessMessage(): string {
  return 'Your account does not have bot access. Bot access is available to Alpha testers, Kickstarter backers, and active subscribers.';
}

/**
 * Get the error message for unlinked accounts
 */
export function getUnlinkedAccountMessage(): string {
  return 'Please use `/link` to connect your Discord account first.';
}
