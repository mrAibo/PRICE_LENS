import type {Money} from "@price-lens/contracts";

const FREE_SHIPPING_RE = /\b(kostenlos(?:er|e|en|es)?|gratis|free\s+(?:shipping|delivery))\b/i;

export function parseSchemaAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return roundMoney(value);
  }
  if (typeof value !== "string") return undefined;
  return parseLocalizedAmount(value);
}

export function parseLocalizedAmount(text: string): number | undefined {
  const tokens = text
    .match(/\d[\d.,]*/g)
    ?.map(normalizeNumericToken)
    .filter((value): value is number => value !== undefined);

  if (!tokens || tokens.length === 0) return undefined;

  const distinct = [...new Set(tokens.map((value) => roundMoney(value)))];
  if (distinct.length !== 1) return undefined;

  return distinct[0];
}

export function detectCurrency(text: string): string | undefined {
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bUSD\b|\bUS\s*\$/.test(text)) return "USD";
  if (/\bGBP\b|£/.test(text)) return "GBP";
  if (/\bCHF\b/.test(text)) return "CHF";
  return undefined;
}

export function parseMoneyText(
  text: string,
  options: {
    fallbackCurrency?: string;
    allowFreeText?: boolean;
  } = {}
): Money | undefined {
  const currency = detectCurrency(text) ?? options.fallbackCurrency?.toUpperCase();

  if (options.allowFreeText && FREE_SHIPPING_RE.test(text)) {
    return currency ? {amount: 0, currency} : undefined;
  }

  const amount = parseLocalizedAmount(text);
  if (amount === undefined || !currency) return undefined;

  return {amount, currency};
}

function normalizeNumericToken(raw: string): number | undefined {
  let token = raw.replace(/[^\d.,]/g, "");
  if (!token) return undefined;

  const lastComma = token.lastIndexOf(",");
  const lastDot = token.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalIsComma = lastComma > lastDot;
    const decimalIndex = decimalIsComma ? lastComma : lastDot;
    const decimalDigits = token.length - decimalIndex - 1;

    if (decimalDigits <= 2) {
      const decimalSeparator = decimalIsComma ? "," : ".";
      const thousandsSeparator = decimalIsComma ? "." : ",";
      token = token.split(thousandsSeparator).join("");
      token = token.replace(decimalSeparator, ".");
    } else {
      token = token.replace(/[.,]/g, "");
    }
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const lastIndex = token.lastIndexOf(separator);
    const decimalDigits = token.length - lastIndex - 1;
    const occurrences = token.split(separator).length - 1;

    if (decimalDigits <= 2 && occurrences === 1) {
      token = token.replace(separator, ".");
    } else if (decimalDigits <= 2 && occurrences > 1) {
      const parts = token.split(separator);
      const decimal = parts.pop();
      token = `${parts.join("")}.${decimal}`;
    } else {
      token = token.split(separator).join("");
    }
  }

  const value = Number.parseFloat(token);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return roundMoney(value);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
