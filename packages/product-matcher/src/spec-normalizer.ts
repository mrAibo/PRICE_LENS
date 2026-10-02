/**
 * Spec Normalizer — Converts CPU, GPU, and other spec strings to canonical forms
 * so that "Intel Core i7-13700H", "i7 13700H", "i7-13700h" all produce the same key.
 *
 * This dramatically improves spec overlap matching by eliminating surface-level
 * string differences that represent the same hardware.
 */

// ---------------------------------------------------------------------------
// CPU Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an Intel CPU string to canonical form.
 *
 * Examples:
 *   "Intel Core i7-13700H"  → "intel-i7-13700h"
 *   "i7 13700H"             → "intel-i7-13700h"
 *   "Intel Core i5-1235U"   → "intel-i5-1235u"
 *   "Core i9-14900HX"       → "intel-i9-14900hx"
 *   "Intel Core Ultra 7 155H" → "intel-ultra7-155h"
 *   "Intel N100"             → "intel-n100"
 */
const INTEL_CANONICAL_RE =
  /(?:intel\s*)?(?:core\s*)?(?:ultra\s*)?([iI][3579]|ultra\s*[579]|[nN]\d{3,4})\s*[-\s]?(\d{3,5}[A-Z]{0,3})?/i;

/**
 * Normalize an AMD CPU string to canonical form.
 *
 * Examples:
 *   "AMD Ryzen 7 7730U"     → "amd-ryzen7-7730u"
 *   "Ryzen 5 5600H"         → "amd-ryzen5-5600h"
 *   "AMD Ryzen 9 7945HX"    → "amd-ryzen9-7945hx"
 *   "AMD Athlon Silver 3050U" → "amd-athlon-3050u"
 */
const AMD_RYZEN_RE =
  /(?:amd\s*)?(?:ryzen\s*)?([3579])\s*[-\s]?(\d{4}[A-Z]{0,3})/i;

const AMD_ATHLON_RE =
  /(?:amd\s*)?athlon\s*(?:silver|gold)?\s*(\d{4}[A-Z]{0,2})/i;

/**
 * Normalize an Apple CPU string to canonical form.
 *
 * Examples:
 *   "Apple M2"           → "apple-m2"
 *   "M3 Pro"             → "apple-m3-pro"
 *   "Apple M4 Max"       → "apple-m4-max"
 */
const APPLE_M_RE =
  /(?:apple\s*)?(m[1-4])\s*(pro|max|ultra)?/i;

/**
 * Qualcomm/MediaTek for smartphones
 *
 * Examples:
 *   "Qualcomm Snapdragon 8 Gen 3"  → "snapdragon-8gen3"
 *   "Snapdragon 778G"              → "snapdragon-778g"
 *   "MediaTek Dimensity 9200"      → "dimensity-9200"
 *   "MediaTek Helio G99"           → "helio-g99"
 */
const SNAPDRAGON_RE =
  /(?:qualcomm\s*)?snapdragon\s*(\d+)\s*(?:gen\s*(\d))?(\+|[gG])?/i;

const DIMENSITY_RE =
  /(?:mediatek\s*)?dimensity\s*(\d{3,4})(\+)?/i;

const HELIO_RE =
  /(?:mediatek\s*)?helio\s*([gGpP]\d{2,3})/i;

/**
 * Normalize a CPU string to a canonical form for comparison.
 * Returns null if the string cannot be parsed.
 */
export function normalizeCpu(raw: string | null): string | null {
  if (!raw) return null;

  const text = raw.trim();

  // Apple M-series
  const appleMatch = APPLE_M_RE.exec(text);
  if (appleMatch) {
    const chip = appleMatch[1].toLowerCase();
    const variant = appleMatch[2]?.toLowerCase() ?? '';
    return variant ? `apple-${chip}-${variant}` : `apple-${chip}`;
  }

  // Snapdragon
  const snapMatch = SNAPDRAGON_RE.exec(text);
  if (snapMatch) {
    const series = snapMatch[1];
    const gen = snapMatch[2] ? `gen${snapMatch[2]}` : '';
    const suffix = snapMatch[3]?.toLowerCase() ?? '';
    return `snapdragon-${series}${gen}${suffix}`.replace(/-$/, '');
  }

  // Dimensity
  const dimMatch = DIMENSITY_RE.exec(text);
  if (dimMatch) {
    const model = dimMatch[1];
    const plus = dimMatch[2] ?? '';
    return `dimensity-${model}${plus}`;
  }

  // Helio
  const helioMatch = HELIO_RE.exec(text);
  if (helioMatch) {
    return `helio-${helioMatch[1].toLowerCase()}`;
  }

  // Intel — handle "Ultra" series separately
  const ultraMatch = /(?:intel\s*)?(?:core\s*)?ultra\s*([579])\s*[-\s]?(\d{3}[A-Z]{0,2})/i.exec(text);
  if (ultraMatch) {
    const tier = ultraMatch[1];
    const model = ultraMatch[2].toLowerCase();
    return `intel-ultra${tier}-${model}`;
  }

  // Intel N-series (Celeron/Pentium replacement)
  const intelNMatch = /(?:intel\s*)?([nN]\d{3,4})/i.exec(text);
  if (intelNMatch) {
    return `intel-${intelNMatch[1].toLowerCase()}`;
  }

  // Intel Core iX
  const intelMatch = INTEL_CANONICAL_RE.exec(text);
  if (intelMatch) {
    const tier = intelMatch[1].toLowerCase();
    const model = intelMatch[2]?.toLowerCase() ?? '';
    if (tier.startsWith('i') && model) {
      return `intel-${tier}-${model}`;
    }
  }

  // AMD Ryzen
  const amdMatch = AMD_RYZEN_RE.exec(text);
  if (amdMatch) {
    const tier = amdMatch[1];
    const model = amdMatch[2].toLowerCase();
    return `amd-ryzen${tier}-${model}`;
  }

  // AMD Athlon
  const athlonMatch = AMD_ATHLON_RE.exec(text);
  if (athlonMatch) {
    return `amd-athlon-${athlonMatch[1].toLowerCase()}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// GPU Normalization
// ---------------------------------------------------------------------------

/**
 * NVIDIA GPU patterns
 *
 * Examples:
 *   "NVIDIA GeForce RTX 4060"        → "nvidia-rtx4060"
 *   "RTX 4060 Ti"                    → "nvidia-rtx4060ti"
 *   "GeForce GTX 1650"               → "nvidia-gtx1650"
 *   "RTX 3050 Laptop GPU"            → "nvidia-rtx3050"
 *   "MX 550"                         → "nvidia-mx550"
 */
const NVIDIA_RE =
  /(?:nvidia\s*)?(?:geforce\s*)?(rtx|gtx|gt|mx)\s*(\d{3,4})\s*(ti|super|xt)?/i;

/**
 * AMD Radeon GPU patterns
 *
 * Examples:
 *   "AMD Radeon RX 7600"             → "amd-rx7600"
 *   "Radeon RX 6700 XT"              → "amd-rx6700xt"
 *   "AMD Radeon 780M"                → "amd-radeon780m"
 *   "Radeon Vega 8"                  → "amd-vega8"
 */
const AMD_RX_RE =
  /(?:amd\s*)?(?:radeon\s*)?(rx)\s*(\d{3,4})\s*(xt|xtx)?/i;

const AMD_RADEON_RE =
  /(?:amd\s*)?radeon\s*(\d{3}[mM]?)/i;

const AMD_VEGA_RE =
  /(?:amd\s*)?(?:radeon\s*)?vega\s*(\d{1,2})/i;

/**
 * Intel Arc GPU patterns
 *
 * Examples:
 *   "Intel Arc A770"                 → "intel-arc-a770"
 *   "Arc A380"                       → "intel-arc-a380"
 */
const INTEL_ARC_RE =
  /(?:intel\s*)?arc\s*(a\d{3,4})/i;

/**
 * Normalize a GPU string to a canonical form for comparison.
 * Returns null if the string cannot be parsed.
 */
export function normalizeGpu(raw: string | null): string | null {
  if (!raw) return null;

  const text = raw.trim();

  // NVIDIA
  const nvidiaMatch = NVIDIA_RE.exec(text);
  if (nvidiaMatch) {
    const family = nvidiaMatch[1].toLowerCase();
    const number = nvidiaMatch[2];
    const suffix = nvidiaMatch[3]?.toLowerCase() ?? '';
    return `nvidia-${family}${number}${suffix}`;
  }

  // AMD RX
  const rxMatch = AMD_RX_RE.exec(text);
  if (rxMatch) {
    const number = rxMatch[2];
    const suffix = rxMatch[3]?.toLowerCase() ?? '';
    return `amd-rx${number}${suffix}`;
  }

  // AMD Radeon (integrated)
  const radeonMatch = AMD_RADEON_RE.exec(text);
  if (radeonMatch) {
    return `amd-radeon${radeonMatch[1].toLowerCase()}`;
  }

  // AMD Vega
  const vegaMatch = AMD_VEGA_RE.exec(text);
  if (vegaMatch) {
    return `amd-vega${vegaMatch[1]}`;
  }

  // Intel Arc
  const arcMatch = INTEL_ARC_RE.exec(text);
  if (arcMatch) {
    return `intel-arc-${arcMatch[1].toLowerCase()}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Screen / Resolution Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize screen resolution to canonical form.
 *
 * Examples:
 *   "1920x1080"           → "1920x1080"
 *   "1920 x 1080"         → "1920x1080"
 *   "Full HD (1920x1080)" → "1920x1080"
 *   "FHD"                 → "1920x1080"
 *   "4K UHD"              → "3840x2160"
 *   "QHD"                 → "2560x1440"
 *   "HD"                  → "1366x768"
 */
const RESOLUTION_ALIASES: Record<string, string> = {
  fhd: '1920x1080',
  'full hd': '1920x1080',
  'full-hd': '1920x1080',
  '4k': '3840x2160',
  '4k uhd': '3840x2160',
  uhd: '3840x2160',
  qhd: '2560x1440',
  wqhd: '2560x1440',
  '2k': '2560x1440',
  hd: '1366x768',
  wxga: '1366x768',
  'hd+': '1600x900',
  wuxga: '1920x1200',
  wqxga: '2560x1600',
};

const RESOLUTION_NUMERIC_RE = /(\d{3,4})\s*[xX×]\s*(\d{3,4})/;

export function normalizeResolution(raw: string | null): string | null {
  if (!raw) return null;

  const text = raw.trim().toLowerCase();

  // Try numeric first
  const numMatch = RESOLUTION_NUMERIC_RE.exec(text);
  if (numMatch) {
    return `${numMatch[1]}x${numMatch[2]}`;
  }

  // Try aliases
  for (const [alias, canonical] of Object.entries(RESOLUTION_ALIASES)) {
    if (text.includes(alias)) {
      return canonical;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Composite normalizer for spec comparison
// ---------------------------------------------------------------------------

/**
 * Normalize a spec value to a canonical string for comparison.
 * Handles CPU, GPU, and resolution fields.
 *
 * For numeric fields (ramGb, storageGb, screenSize), no normalization needed
 * since they're already numbers.
 */
export function normalizeSpecForComparison(
  field: string,
  value: string | number | null,
): string | null {
  if (value == null) return null;

  if (typeof value === 'number') {
    return String(value);
  }

  switch (field) {
    case 'cpu':
      return normalizeCpu(value) ?? value.trim().toLowerCase();
    case 'gpu':
      return normalizeGpu(value) ?? value.trim().toLowerCase();
    case 'resolution':
      return normalizeResolution(value) ?? value.trim().toLowerCase();
    case 'storageType':
      return value.trim().toUpperCase();
    case 'os':
      return normalizeOs(value);
    default:
      return value.trim().toLowerCase();
  }
}

/**
 * Normalize OS string.
 *
 * Examples:
 *   "Windows 11 Home"          → "windows-11"
 *   "Windows 11 Pro"           → "windows-11"
 *   "Windows 11 Home Single Language" → "windows-11"
 *   "Chrome OS"                → "chromeos"
 *   "macOS Sonoma"             → "macos"
 *   "FreeDOS"                  → "freedos"
 *   "Sin sistema operativo"    → "none"
 */
function normalizeOs(raw: string): string {
  const text = raw.trim().toLowerCase();

  if (/windows\s*11/i.test(text)) return 'windows-11';
  if (/windows\s*10/i.test(text)) return 'windows-10';
  if (/chrome\s*os/i.test(text)) return 'chromeos';
  if (/macos|mac\s*os/i.test(text)) return 'macos';
  if (/freedos|free\s*dos/i.test(text)) return 'freedos';
  if (/sin\s*sistema|no\s*os|none/i.test(text)) return 'none';
  if (/android/i.test(text)) return 'android';
  if (/ios/i.test(text)) return 'ios';
  if (/linux|ubuntu/i.test(text)) return 'linux';

  return text;
}