/**
 * Utility functions for cleaning and formatting text
 */

/**
 * Remove JATS XML tags from abstract text
 * JATS (Journal Article Tag Suite) is a common XML format used by publishers
 * @param {string} text - The text potentially containing JATS XML tags
 * @returns {string} - Clean text without XML tags
 */
function stripJatsXml(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Remove all JATS XML tags (e.g., <jats:p>, <jats:title>, <jats:sub>, etc.)
  let cleanText = text.replace(/<\/?jats:[^>]+>/gi, '');

  // Remove any remaining XML tags
  cleanText = cleanText.replace(/<\/?[^>]+>/gi, '');

  // Clean up excessive whitespace
  cleanText = cleanText.replace(/\s+/g, ' ').trim();

  // Fix common encoding issues
  cleanText = cleanText.replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&amp;/g, '&')
                       .replace(/&quot;/g, '"')
                       .replace(/&apos;/g, "'");

  return cleanText;
}

/**
 * Clean abstract text from various sources
 * @param {string} abstract - The abstract text
 * @returns {string} - Cleaned abstract
 */
function cleanAbstract(abstract) {
  if (!abstract) {
    return abstract;
  }

  // Strip JATS XML
  let cleaned = stripJatsXml(abstract);

  // Remove common prefixes like "Abstract" at the start
  cleaned = cleaned.replace(/^Abstract\s*:?\s*/i, '');

  return cleaned;
}

module.exports = {
  stripJatsXml,
  cleanAbstract
};
