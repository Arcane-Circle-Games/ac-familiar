/**
 * Tier-based authorization utilities for bot access control
 */

import { User } from '../types/api';
import { logInfo } from './logger';

/**
 * Tiers that have bot access
 */
export const AUTHORIZED_TIERS = ['Alpha', 'Wizard_Backer', 'admin'] as const;

export type AuthorizedTier = typeof AUTHORIZED_TIERS[number];

/**
 * Commands that are exempt from tier checking
 * These commands can be used by anyone, even unlinked users
 */
export const TIER_EXEMPT_COMMANDS = ['link', 'ping', 'diagnostics', 'help'] as const;

export type TierExemptCommand = typeof TIER_EXEMPT_COMMANDS[number];

/**
 * Check if a user has an authorized tier for bot access
 * Checks both tier and subscriptionTier fields (inclusive OR)
 */
export function hasAuthorizedTier(user: User | null | undefined): boolean {
  if (!user) {
    logInfo('User is null or undefined');
    return false;
  }

  // Check if either tier OR subscriptionTier has an authorized value
  const tierAuthorized = Boolean(user.tier && AUTHORIZED_TIERS.includes(user.tier as AuthorizedTier));
  const subscriptionTierAuthorized = Boolean(user.subscriptionTier && AUTHORIZED_TIERS.includes(user.subscriptionTier as AuthorizedTier));

  const hasAccess = tierAuthorized || subscriptionTierAuthorized;

  logInfo('Tier authorization check', {
    userId: user.id,
    userTier: user.tier,
    userSubscriptionTier: user.subscriptionTier,
    tierAuthorized,
    subscriptionTierAuthorized,
    authorizedTiers: AUTHORIZED_TIERS,
    hasAccess
  });

  return hasAccess;
}

/**
 * Get the effective tier that grants access (whichever is authorized)
 * Returns tier or subscriptionTier, prioritizing subscriptionTier if both are valid
 */
export function getEffectiveTier(user: User | null | undefined): string | null {
  if (!user) {
    return null;
  }

  // Prioritize subscriptionTier if it's authorized
  if (user.subscriptionTier && AUTHORIZED_TIERS.includes(user.subscriptionTier as AuthorizedTier)) {
    return user.subscriptionTier;
  }

  // Fall back to tier if it's authorized
  if (user.tier && AUTHORIZED_TIERS.includes(user.tier as AuthorizedTier)) {
    return user.tier;
  }

  return null;
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
  return 'Your account does not have bot access. At this time bot access is restricted to Alpha testers and Kickstarter backers.';
}

/**
 * Get the error message for unlinked accounts
 */
export function getUnlinkedAccountMessage(): string {
  return 'Please use `/link` to connect your Discord account first.';
}
