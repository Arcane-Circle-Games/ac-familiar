import { logDebug, logError } from './logger';

/**
 * Filter wiki HTML content based on user role and revealed blocks
 * Fail-closed: if parsing fails, suppress trailing content
 */
export function filterWikiContent(
  html: string,
  platformUserId: string,
  isGM: boolean
): string {
  if (!html) return '';

  // GMs see everything - no filtering needed
  if (isGM) {
    return html;
  }

  try {
    // Simple state-based parser for secret and reveal blocks
    // This is a lightweight alternative to htmlparser2 - we don't need full SAX parsing
    let filtered = '';
    let pos = 0;
    let insideSecretBlock = false;
    let insideUnrevealedBlock = false;
    let blockDepth = 0;

    while (pos < html.length) {
      // Look for opening tags
      const nextOpenTag = html.indexOf('<div', pos);
      if (nextOpenTag === -1) {
        // No more div tags - append remaining content if not inside filtered block
        if (!insideSecretBlock && !insideUnrevealedBlock) {
          filtered += html.substring(pos);
        }
        break;
      }

      // Append content before this tag if not inside filtered block
      if (!insideSecretBlock && !insideUnrevealedBlock && nextOpenTag > pos) {
        filtered += html.substring(pos, nextOpenTag);
      }

      // Extract the full opening tag
      const tagEnd = html.indexOf('>', nextOpenTag);
      if (tagEnd === -1) {
        // Malformed HTML - fail closed
        logError('Malformed wiki HTML: unclosed opening tag', new Error('Unclosed tag'), { position: nextOpenTag });
        break;
      }

      const tag = html.substring(nextOpenTag, tagEnd + 1);
      pos = tagEnd + 1;

      // Check if this is a secret-block
      if (tag.includes('data-type="secret-block"')) {
        insideSecretBlock = true;
        blockDepth = 1;
        logDebug('Entering secret block', { position: nextOpenTag });

        // Skip to the closing tag
        pos = skipToClosingDiv(html, pos, blockDepth);
        insideSecretBlock = false;
        continue;
      }

      // Check if this is a reveal-block
      if (tag.includes('data-type="reveal-block"')) {
        const revealMatch = tag.match(/data-reveal-players="([^"]*)"/);
        const revealedTo = revealMatch && revealMatch[1] ? revealMatch[1].split(',').map(id => id.trim()) : [];

        if (!revealedTo.includes(platformUserId)) {
          // User not in reveal list - hide this block
          insideUnrevealedBlock = true;
          blockDepth = 1;
          logDebug('Entering unrevealed block', { position: nextOpenTag, revealedTo, platformUserId });

          // Skip to the closing tag
          pos = skipToClosingDiv(html, pos, blockDepth);
          insideUnrevealedBlock = false;
          continue;
        }
        // User is in reveal list - include this block
        filtered += tag;
        continue;
      }

      // Not a filtered block - include the tag
      if (!insideSecretBlock && !insideUnrevealedBlock) {
        filtered += tag;
      }
    }

    return filtered;

  } catch (error) {
    logError('Error filtering wiki content - failing closed', error as Error);
    return ''; // Fail closed on error
  }
}

/**
 * Skip to the closing div tag, handling nested divs
 */
function skipToClosingDiv(html: string, startPos: number, initialDepth: number): number {
  let pos = startPos;
  let depth = initialDepth;

  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);

    if (nextClose === -1) {
      // No closing tag found - fail closed
      logError('Malformed wiki HTML: unclosed div block', new Error('Unclosed block'), { startPos });
      return html.length; // Skip to end
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Found nested opening div
      depth++;
      pos = html.indexOf('>', nextOpen) + 1;
    } else {
      // Found closing div
      depth--;
      pos = nextClose + 6; // Skip past '</div>'
    }
  }

  return pos;
}

/**
 * Strip all HTML tags to plain text for Discord embeds
 */
export function stripHtmlToPlain(html: string): string {
  if (!html) return '';

  try {
    // Strip <img> tags with alt text preservation
    let text = html.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[Image: $1]');
    text = text.replace(/<img[^>]*>/gi, '[Image]');

    // Strip all other HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Collapse multiple whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  } catch (error) {
    logError('Error stripping HTML', error as Error);
    return html; // Return original if stripping fails
  }
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }

  // Truncate at word boundary if possible
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    // Found a space near the end - truncate there
    return truncated.substring(0, lastSpace) + '...';
  }

  // No good word boundary - hard truncate
  return truncated + '...';
}
