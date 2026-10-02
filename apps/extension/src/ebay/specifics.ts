import type {ProductIdentity} from "@price-lens/contracts";

const INVALID_VALUE_RE =
  /^(?:n\/?a|none|unknown|nicht\s+zutreffend|keine\s+angabe|nicht\s+angegeben|does\s+not\s+apply|not\s+applicable)$/i;

export function extractItemSpecifics(document: Document): Map<string, string> {
  const result = new Map<string, string>();

  for (const row of document.querySelectorAll(".ux-labels-values")) {
    const label =
      textOf(row.querySelector(".ux-labels-values__labels-content")) ??
      textOf(row.querySelector(".ux-labels-values__labels"));
    const value =
      textOf(row.querySelector(".ux-labels-values__values-content")) ??
      textOf(row.querySelector(".ux-labels-values__values"));

    if (!label || !value) continue;
    result.set(normalizeLabel(label), value.trim());
  }

  for (const term of document.querySelectorAll("dt")) {
    const valueElement = term.nextElementSibling;
    if (!valueElement || valueElement.tagName.toLowerCase() !== "dd") continue;
    const label = textOf(term);
    const value = textOf(valueElement);
    if (!label || !value) continue;

    const normalized = normalizeLabel(label);
    if (!result.has(normalized)) {
      result.set(normalized, value.trim());
    }
  }

  return result;
}

export function enrichIdentityFromSpecifics(
  base: ProductIdentity,
  specifics: Map<string, string>
): {identity: ProductIdentity; addedFields: string[]} {
  const identity: ProductIdentity = {...base};
  const addedFields: string[] = [];

  const brand = findValue(specifics, ["marke", "brand"]);
  if (!identity.brand && brand) {
    identity.brand = brand;
    addedFields.push("brand");
  }

  const model = findValue(specifics, ["modell", "model"]);
  if (!identity.model && model) {
    identity.model = model;
    addedFields.push("model");
  }

  const mpn = findValue(specifics, [
    "herstellernummer",
    "herstellerteilenummer",
    "manufacturer part number",
    "mpn"
  ]);
  if (!identity.mpn && mpn) {
    identity.mpn = mpn;
    addedFields.push("mpn");
  }

  const gtin = cleanTradeIdentifier(findValue(specifics, ["gtin"]));
  if (!identity.gtin && gtin) {
    identity.gtin = gtin;
    addedFields.push("gtin");
  }

  const ean = cleanTradeIdentifier(findValue(specifics, ["ean"]));
  if (!identity.ean && ean) {
    identity.ean = ean;
    addedFields.push("ean");
  }

  const upc = cleanTradeIdentifier(findValue(specifics, ["upc"]));
  if (!identity.upc && upc) {
    identity.upc = upc;
    addedFields.push("upc");
  }

  return {identity, addedFields};
}

function findValue(
  specifics: Map<string, string>,
  aliases: string[]
): string | undefined {
  for (const alias of aliases) {
    const value = specifics.get(normalizeLabel(alias));
    if (!value) continue;
    const cleaned = value.trim();
    if (!cleaned || INVALID_VALUE_RE.test(cleaned)) continue;
    return cleaned;
  }
  return undefined;
}

function cleanTradeIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : undefined;
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/:+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(element: Element | null): string | undefined {
  return element?.textContent?.trim() || undefined;
}
