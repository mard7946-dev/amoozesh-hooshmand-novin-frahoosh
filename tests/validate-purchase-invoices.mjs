import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const finance = readFileSync(new URL("../finance.html", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261117120000_school_purchase_invoices.sql", import.meta.url), "utf8");

for (const id of ["purchases","purchaseInvoiceNumber","purchaseSupplier","purchaseCategory","purchaseSubtotal","purchaseDiscount","purchaseTax","purchaseTotal","purchasePaymentAmount","purchaseRows"]) {
  assert.ok(finance.includes('id="'+id+'"'), "Purchase management UI must include "+id);
}
assert.ok(finance.includes("finance_purchase_invoices"), "Purchase invoices must persist in their tenant-scoped table.");
assert.ok(finance.includes("finance_purchase_payments"), "Supplier payments must persist independently from parent/student balances.");
assert.ok(finance.includes("finance_purchase_attachments"), "Invoice attachment metadata must be persisted.");
assert.ok(finance.includes("finance-documents/"), "Purchase invoices must use the existing private finance document bucket.");
assert.ok(finance.includes("renderPurchases()"), "Purchase invoice list and supplier balances must render.");
assert.ok(finance.includes("exportPurchaseCsv"), "Purchase report must provide an Excel-compatible export.");
assert.ok(migration.includes("enable row level security") && migration.includes("frahoosh_current_school_id"), "Purchase tables must enforce tenant isolation with RLS.");
assert.ok(migration.includes("finance_purchase_docs_insert") && migration.includes("finance_purchase_docs_select"), "Invoice attachments must remain private and tenant-scoped.");
assert.ok(migration.includes("finance_purchase_invoice_total_check"), "Invoice total must be validated in the database.");
assert.ok(workflow.includes("node tests/validate-purchase-invoices.mjs"), "Purchase invoice checks must run in CI.");

const scripts = [...finance.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\btype\s*=\s*["']module["']/i.test(match[1] || ""))
  .map(match => match[2])
  .filter(source => source.trim());
for (const source of scripts) assert.doesNotThrow(() => new Function(source), "Finance page must contain valid JavaScript.");
console.log("Purchase invoice checks passed: supplier invoices, payment history, private attachments, tenant scope, and JavaScript syntax.");
