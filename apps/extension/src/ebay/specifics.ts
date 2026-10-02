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

  const variant = {...identity.variant};

  const storageGb = parseCapacityGb(findValue(specifics, [
    "speicherkapazität",
    "storage capacity",
    "festplattenkapazität",
    "ssd-speicherkapazität",
    "ssd capacity"
  ]));
  if (variant.storageGb === undefined && storageGb !== undefined) {
    variant.storageGb = storageGb;
    addedFields.push("variant.storageGb");
  }

  const ramGb = parseCapacityGb(findValue(specifics, [
    "arbeitsspeicher",
    "arbeitsspeichergröße",
    "ram",
    "ram größe",
    "ram size"
  ]));
  if (variant.ramGb === undefined && ramGb !== undefined) {
    variant.ramGb = ramGb;
    addedFields.push("variant.ramGb");
  }

  const screenSizeInches = parseScreenSizeInches(findValue(specifics, [
    "bildschirmgröße",
    "displaygröße",
    "screen size",
    "display size"
  ]));
  if (variant.screenSizeInches === undefined && screenSizeInches !== undefined) {
    variant.screenSizeInches = screenSizeInches;
    addedFields.push("variant.screenSizeInches");
  }

  const packCount = parsePackCount(findValue(specifics, [
    "anzahl pro packung",
    "packungsinhalt",
    "number in pack",
    "pack count"
  ]));
  if (variant.packCount === undefined && packCount !== undefined) {
    variant.packCount = packCount;
    addedFields.push("variant.packCount");
  }

  const edition = cleanVariantText(findValue(specifics, [
    "edition",
    "ausgabe",
    "sonderedition",
    "product edition"
  ]));
  if (variant.edition === undefined && edition) {
    variant.edition = edition;
    addedFields.push("variant.edition");
  }

  const modelQualifier = cleanVariantText(findValue(specifics, [
    "modellnummer",
    "model number",
    "modellvariante",
    "model variant",
    "modellcode",
    "model code"
  ]));
  if (variant.modelQualifier === undefined && modelQualifier) {
    variant.modelQualifier = modelQualifier;
    addedFields.push("variant.modelQualifier");
  }

  const bundleFlag = parseExplicitBoolean(findValue(specifics, [
    "benutzerdefiniertes bundle",
    "custom bundle",
    "bundle",
    "bundle enthalten",
    "bundle included"
  ]));
  const bundleDescription = findValue(specifics, [
    "bundle-beschreibung",
    "bundle description"
  ]);
  const bundleIncluded =
    bundleFlag ?? (bundleDescription ? true : undefined);
  if (variant.bundleIncluded === undefined && bundleIncluded !== undefined) {
    variant.bundleIncluded = bundleIncluded;
    addedFields.push("variant.bundleIncluded");
  }

  if (Object.keys(variant).length > 0) {
    identity.variant = variant;
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

function parseCapacityGb(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const matches = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\b/gi)]
    .map((match) => {
      const amount = Number.parseFloat(match[1]!.replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) return undefined;

      const unit = match[2]!.toLowerCase();
      const gb = unit === "tb" ? amount * 1000 : unit === "mb" ? amount / 1000 : amount;
      return Math.round((gb + Number.EPSILON) * 1000) / 1000;
    })
    .filter((amount): amount is number => amount !== undefined);

  const distinct = [...new Set(matches)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function parseScreenSizeInches(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const matches = [...value.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:"|″|zoll|inch(?:es)?)/gi)]
    .map((match) => Number.parseFloat(match[1]!.replace(",", ".")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);

  const rounded = matches.map((amount) =>
    Math.round((amount + Number.EPSILON) * 100) / 100
  );
  const distinct = [...new Set(rounded)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function parsePackCount(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d{1,3})(?:\s*(?:stück|stuck|pcs?|pieces?|x))?$/i);
  if (!match) return undefined;

  const count = Number.parseInt(match[1]!, 10);
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

function cleanVariantText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function parseExplicitBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (/^(?:ja|yes|true|1|enthalten|included)$/.test(normalized)) return true;
  if (/^(?:nein|no|false|0|nicht enthalten|not included)$/.test(normalized)) {
    return false;
  }
  return undefined;
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
