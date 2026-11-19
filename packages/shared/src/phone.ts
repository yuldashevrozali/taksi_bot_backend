// Uzbekistan phone helpers. Canonical form: +998XXXXXXXXX (12 digits after "+").

export function normalizeUzPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;
  return null;
}

// For logs and for roles that must not see the full number: +99890*****67
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "-";
  if (phone.length <= 8) return "*".repeat(phone.length);
  return `${phone.slice(0, 6)}${"*".repeat(phone.length - 8)}${phone.slice(-2)}`;
}
