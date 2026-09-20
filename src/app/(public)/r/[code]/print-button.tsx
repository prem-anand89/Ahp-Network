"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="mt-4 text-sm font-semibold text-primary hover:underline print:hidden"
    >
      Print this receipt
    </button>
  );
}
