import { CommandInteraction, ChatInputCommandInteraction } from 'discord.js';

/**
 * Check if a command interaction is in a guild context.
 * If not, replies with an error message to the user.
 *
 * @param interaction - The command interaction to check
 * @param customMessage - Optional custom error message
 * @returns true if in guild context, false otherwise
 *
 * @example
 * ```typescript
 * if (!requiresGuild(interaction)) return;
 * // Continue with guild-specific logic
 * ```
 */
export async function requiresGuild(
  interaction: CommandInteraction | ChatInputCommandInteraction,
  customMessage?: string
): Promise<boolean> {
  if (!interaction.guild) {
    const message = customMessage || '❌ This command can only be used in a server.';

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({
        content: message,
        ephemeral: true
      });
    }

    return false;
  }

  return true;
}

/**
 * Check if a command interaction is in a DM context.
 *
 * @param interaction - The command interaction to check
 * @returns true if in DM context, false otherwise
 */
export function isDM(interaction: CommandInteraction | ChatInputCommandInteraction): boolean {
  return !interaction.guild;
}

/**
 * Get context type for logging purposes
 *
 * @param interaction - The command interaction
 * @returns 'guild' or 'dm'
 */
export function getContextType(interaction: CommandInteraction | ChatInputCommandInteraction): 'guild' | 'dm' {
  return interaction.guild ? 'guild' : 'dm';
}
