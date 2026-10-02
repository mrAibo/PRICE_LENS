import type { CanonicalProduct } from './types';

/**
 * Identifier keys that can be matched between a listing and a canonical product.
 * These correspond to the fields in {@link ProductIdentifiers} (upc, ean, asin, mpn).
 */
const IDENTIFIER_KEYS = ['upc', 'ean', 'asin', 'mpn'] as const;

/**
 * Attempt to match a listing to a canonical product by exact identifier match.
 *
 * Checks UPC, EAN, ASIN, and MPN values against each product's `identifiers`.
 * Returns the first product with an exact (case-insensitive, trimmed) match on
 * any identifier, or `null` if none match. An identifier match is the strongest
 * possible signal — when it fires, you can skip fuzzy scoring entirely.
 *
 * @param identifiers - Key/value pairs parsed from the listing (e.g. `{ upc: '012345678901' }`)
 * @param products    - Candidate canonical products to compare against
 * @returns The first matching product, or `null`
 */
export function matchByIdentifier<T extends CanonicalProduct>(
  identifiers: Record<string, string>,
  products: T[],
): T | null {
  if (!identifiers || Object.keys(identifiers).length === 0) {
    return null;
  }

  for (const product of products) {
    const productIds = product.identifiers as Record<string, string | undefined> | null | undefined;
    if (!productIds || typeof productIds !== 'object') {
      continue;
    }

    for (const key of IDENTIFIER_KEYS) {
      const listingValue = identifiers[key];
      const productValue = productIds[key];

      if (
        listingValue &&
        productValue &&
        typeof listingValue === 'string' &&
        typeof productValue === 'string' &&
        listingValue.trim().toLowerCase() === productValue.trim().toLowerCase()
      ) {
        return product;
      }
    }
  }

  return null;
}