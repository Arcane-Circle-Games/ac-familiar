/**
 * Tier-based authorization utilities for bot access control
 */

import { User } from '../types/api';
import { logDebug } from './logger';

/**
 * Tiers that have bot access
 */
export const AUTHORIZED_TIERS = ['Alpha', 'Wizard_Backer', 'admin'] as const;

export type AuthorizedTier = typeof AUTHORIZED_TIERS[number];

/**
 * Commands that are exempt from tier checking
 * These commands can be used by anyone, even unlinked users
 */
export const TIER_EXEMPT_COMMANDS = ['link', 'ping'] as const;

export type TierExemptCommand = typeof TIER_EXEMPT_COMMANDS[number];

/**
 * Check if a user has an authorized tier for bot access
 */
export function hasAuthorizedTier(user: User | null | undefined): boolean {
  if (!user || !user.tier) {
    logDebug('User has no tier assigned', { userId: user?.id });
    return false;
  }

  const hasAccess = AUTHORIZED_TIERS.includes(user.tier as AuthorizedTier);

  logDebug('Tier authorization check', {
    userId: user.id,
    userTier: user.tier,
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
  return 'Your account does not have bot access. At this time bot access is restricted to Alpha testers and Kickstarter backers.';
}

/**
 * Get the error message for unlinked accounts
 */
export function getUnlinkedAccountMessage(): string {
  return 'Please use `/link` to connect your Discord account first.';
}
