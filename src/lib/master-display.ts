export function formatCustomerDisplay(customerNumber?: number | null, name?: string | null): string {
  const numberText = customerNumber == null ? "" : String(customerNumber).trim();
  const nameText = name?.trim() ?? "";

  if (numberText && nameText) {
    return `${numberText}：${nameText}`;
  }

  return numberText || nameText;
}

export function formatWorkNumberDisplay(workNumber?: string | null, workNumberName?: string | null): string {
  const numberText = workNumber?.trim() ?? "";
  const nameText = workNumberName?.trim() ?? "";

  if (numberText && nameText) {
    return `${numberText}：${nameText}`;
  }

  return numberText || nameText;
}
