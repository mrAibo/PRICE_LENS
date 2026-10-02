// ---------------------------------------------------------------------------
// Text normalization for product title matching
// ---------------------------------------------------------------------------

/**
 * Abbreviation expansions. Keys must be lowercase.
 * Order matters: longer / more specific keys should come first to avoid
 * partial matches (e.g. "r7" before "r").
 */
export const ABBREVIATION_MAP: Record<string, string> = {
  // AMD Ryzen shorthand
  r9: 'Ryzen 9',
  r7: 'Ryzen 7',
  r5: 'Ryzen 5',
  r3: 'Ryzen 3',
  // Intel Core shorthand
  i9: 'Core i9',
  i7: 'Core i7',
  i5: 'Core i5',
  i3: 'Core i3',
  // Memory / storage shorthand
  '16g': '16GB',
  '8g': '8GB',
  '32g': '32GB',
  '64g': '64GB',
  '4g': '4GB',
  '12g': '12GB',
  '24g': '24GB',
  '128g': '128GB',
  '256g': '256GB',
  '512g': '512GB',
  '1t': '1TB',
  '2t': '2TB',
  // OS shorthand
  w10: 'Windows 10',
  w11: 'Windows 11',
  win10: 'Windows 10',
  win11: 'Windows 11',
  // Display
  fhd: 'Full HD',
  uhd: 'Ultra HD',
  qhd: 'QHD',
  // Other
  bt: 'Bluetooth',
  wifi6: 'Wi-Fi 6',
  wifi6e: 'Wi-Fi 6E',
  tb: 'Thunderbolt',
  ssd: 'SSD',
  hdd: 'HDD',
  nvme: 'NVMe',
};

/**
 * Compound token patterns that should be split with a space.
 * E.g. "RTX3060" -> "RTX 3060", "DDR416GB" -> "DDR4 16GB".
 */
const COMPOUND_TOKEN_PATTERNS: Array<[RegExp, string]> = [
  // GPU: RTX3060 -> RTX 3060
  [/\b(RTX|GTX|MX|GT|RX)(\d{3,4})\b/gi, '$1 $2'],
  // DDR prefix: DDR416 -> DDR4 16
  [/\b(DDR[45])(\d+)\b/gi, '$1 $2'],
  // Core ix followed by digits: i712700H -> i7 12700H
  [/\b([iI][3579])(\d{4,5}[A-Z]{0,3})\b/g, '$1 $2'],
  // Ryzen followed by digits: Ryzen75800H -> Ryzen 7 5800H
  [/\b(Ryzen)(\d)(\d{4}[A-Z]{0,3})\b/gi, '$1 $2 $3'],
];

/**
 * Unit normalization patterns: ensure digits are glued to their unit suffix
 * and normalize common unit representations.
 */
const UNIT_PATTERNS: Array<[RegExp, string]> = [
  // "16 GB" -> "16GB", "512 GB" -> "512GB"
  [/(\d+)\s+(GB|TB|MB)\b/gi, '$1$2'],
  // "15.6 pulgadas" or "15.6p" -> "15.6\""
  [/(\d+\.?\d*)\s*pulgadas\b/gi, '$1"'],
  [/(\d+\.?\d*)\s*pulg\b/gi, '$1"'],
  [/(\d+\.?\d*)p\b/gi, '$1"'],
  // "15.6 in" -> "15.6\""
  [/(\d+\.?\d*)\s*in\b/gi, '$1"'],
  // "15.6 '' " or "15.6 '" -> normalize to double-quote
  [/(\d+\.?\d*)\s*['‘’′]{1,2}/g, '$1"'],
];

/**
 * Product stop words that add noise to matching.
 * Matched as whole words, case-insensitive.
 */
export const PRODUCT_STOP_WORDS: string[] = [
  'laptop',
  'notebook',
  'portatil',
  'computadora',
  'computador',
  'ordenador',
  'gaming',
  'gamer',
  'nuevo',
  'nueva',
  'new',
  'original',
  'sellado',
  'sealed',
  'garantia',
  'warranty',
  'oferta',
  'promo',
  'promocion',
  'envio',
  'gratis',
  'free',
  'shipping',
  'stock',
  'disponible',
  'color',
  'negro',
  'plata',
  'gris',
  'blanco',
  'azul',
  'black',
  'silver',
  'gray',
  'grey',
  'white',
  'blue',
  'reacondicionado',
  'refurbished',
  'open',
  'box',
  'caja',
  'abierta',
];

// ---------------------------------------------------------------------------
// Main normalization function
// ---------------------------------------------------------------------------

/**
 * Normalize a product title for matching purposes.
 *
 * The pipeline:
 *  1. NFKD unicode normalization + strip diacritics
 *  2. toLowerCase
 *  3. Replace separators with space
 *  4. Expand abbreviations
 *  5. Normalize compound tokens
 *  6. Normalize units
 *  7. Remove stop words
 *  8. Collapse whitespace and trim
 */
export function normalizeProductTitle(title: string): string {
  let text = title;

  // Step 1: NFKD normalization and strip diacritical marks (combining chars)
  text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');

  // Step 2: lowercase
  text = text.toLowerCase();

  // Step 3: replace separators with space
  text = text.replace(/[|/\\,;()[\]\-]+/g, ' ');

  // Step 4: expand abbreviations (whole-word match only)
  // Sort keys by length descending so longer abbreviations match first
  const sortedAbbrevs = Object.keys(ABBREVIATION_MAP).sort(
    (a, b) => b.length - a.length,
  );
  for (const abbrev of sortedAbbrevs) {
    const re = new RegExp(`\\b${escapeRegex(abbrev)}\\b`, 'gi');
    text = text.replace(re, ABBREVIATION_MAP[abbrev]);
  }

  // Step 5: normalize compound tokens (RTX3060 -> RTX 3060, etc.)
  for (const [pattern, replacement] of COMPOUND_TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }

  // Step 6: normalize units
  for (const [pattern, replacement] of UNIT_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }

  // Step 7: remove product stop words
  for (const word of PRODUCT_STOP_WORDS) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    text = text.replace(re, ' ');
  }

  // Step 8: collapse multiple spaces and trim
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}