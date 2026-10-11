// Generates the freelancer-budget-tracker.xlsx artifact programmatically.
// Run: tsx artifacts/freelancer-budget-tracker/build.ts

import * as XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

const EXPENSE_CATEGORIES = [
  "Software & Tools","Hardware","Marketing","Advertising","Travel",
  "Meals & Entertainment","Professional Development","Books & Courses",
  "Home Office","Internet","Phone","Insurance","Accounting & Legal",
  "Contractors","Subscriptions","Equipment Rental","Shipping","Printing",
  "Miscellaneous","Bank Fees",
];

function buildMonthSheet(month: string): XLSX.WorkSheet {
  const data: unknown[][] = [
    [`${month} Income & Expenses`],
    [],
    ["INCOME"],
    ["Date", "Client", "Project", "Hours", "Rate ($)", "Amount ($)", "Invoice #", "Status"],
  ];

  // 50 income rows
  for (let i = 1; i <= 50; i++) {
    data.push([
      i <= 3 ? `${month} ${i * 5}, 2024` : "",
      i <= 3 ? `Client ${i}` : "",
      i <= 3 ? `Project ${String.fromCharCode(64 + i)}` : "",
      i <= 3 ? 8 * i : "",
      i <= 3 ? 150 : "",
      i <= 3 ? { f: `E${data.length + 1}*D${data.length + 1}` } : "",
      i <= 3 ? `INV-${String(i).padStart(3, "0")}` : "",
      i <= 3 ? "Paid" : "",
    ]);
  }

  data.push(
    ["", "", "", "", "TOTAL INCOME", { f: `SUM(F5:F54)` }, "", ""],
    [],
    ["EXPENSES"],
    ["Category", "Description", "Amount ($)", "Tax Deductible?", "Receipt?"],
  );

  // 20 expense category rows with sample data
  EXPENSE_CATEGORIES.forEach((cat, idx) => {
    data.push([
      cat,
      idx < 3 ? `${cat} - monthly` : "",
      idx < 3 ? 50 + idx * 25 : "",
      idx < 5 ? "Yes" : "No",
      idx < 3 ? "Yes" : "",
    ]);
  });

  const expenseStart = 57;
  const expenseEnd = expenseStart + EXPENSE_CATEGORIES.length - 1;
  data.push(
    ["", "TOTAL EXPENSES", { f: `SUM(C${expenseStart}:C${expenseEnd})` }, "", ""],
    [],
    ["NET INCOME", "", { f: `F55-C${expenseEnd + 2}` }, "", ""],
  );

  return XLSX.utils.aoa_to_sheet(data);
}

function buildInvoiceSheet(): XLSX.WorkSheet {
  const data: unknown[][] = [
    ["INVOICE"],
    [],
    ["Invoice Number:", "INV-001"],
    ["Date:", new Date().toLocaleDateString()],
    ["Due Date:", ""],
    [],
    ["FROM:"],
    ["Name:", "Your Name"],
    ["Email:", "your@email.com"],
    ["Address:", ""],
    [],
    ["TO:"],
    ["Client Name:", ""],
    ["Client Email:", ""],
    ["Client Address:", ""],
    [],
    ["SERVICES"],
    ["Description", "Hours", "Rate ($)", "Amount ($)"],
  ];

  for (let i = 0; i < 20; i++) {
    data.push([
      i === 0 ? "Web Development" : "",
      i === 0 ? 10 : "",
      i === 0 ? 150 : "",
      i === 0 ? { f: `B${data.length + 1}*C${data.length + 1}` } : "",
    ]);
  }

  const lineStart = 19;
  data.push(
    [],
    ["", "", "SUBTOTAL", { f: `SUM(D${lineStart}:D${lineStart + 19})` }],
    ["", "", "TAX (10%)", { f: `D${lineStart + 21}*0.1` }],
    ["", "", "TOTAL DUE", { f: `D${lineStart + 21}+D${lineStart + 22}` }],
  );

  return XLSX.utils.aoa_to_sheet(data);
}

function buildSettingsSheet(): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ["SETTINGS"],
    [],
    ["Default Hourly Rate ($)", 150],
    ["Tax Rate (%)", 25],
    ["Business Name", "Your Freelance Business"],
    ["Currency", "USD"],
    [],
    ["QUARTERLY TAX ESTIMATES"],
    ["Q1 (Jan-Mar)", { f: "'Jan'!C58+'Feb'!C58+'Mar'!C58" }],
    ["Q2 (Apr-Jun)", { f: "'Apr'!C58+'May'!C58+'Jun'!C58" }],
    ["Q3 (Jul-Sep)", { f: "'Jul'!C58+'Aug'!C58+'Sep'!C58" }],
    ["Q4 (Oct-Dec)", { f: "'Oct'!C58+'Nov'!C58+'Dec'!C58" }],
    [],
    ["RUNWAY CALCULATOR"],
    ["Monthly Savings", 1000],
    ["Monthly Expenses (avg)", 3000],
    ["Current Savings", 10000],
    ["Runway (months)", { f: "B18/B16" }],
  ]);
}

function buildDashboard(): XLSX.WorkSheet {
  const data: unknown[][] = [
    ["ANNUAL DASHBOARD"],
    [],
    ["Month", "Income ($)", "Expenses ($)", "Net ($)"],
  ];

  for (const m of MONTHS) {
    data.push([m, { f: `'${m}'!F55` }, { f: `'${m}'!C58` }, { f: `B${data.length + 1}-C${data.length + 1}` }]);
  }

  data.push(
    [],
    ["ANNUAL TOTAL", { f: `SUM(B4:B15)` }, { f: `SUM(C4:C15)` }, { f: `SUM(D4:D15)` }],
  );

  return XLSX.utils.aoa_to_sheet(data);
}

async function main() {
  const wb = XLSX.utils.book_new();

  // Add dashboard first
  XLSX.utils.book_append_sheet(wb, buildDashboard(), "Dashboard");
  XLSX.utils.book_append_sheet(wb, buildSettingsSheet(), "Settings");
  XLSX.utils.book_append_sheet(wb, buildInvoiceSheet(), "Invoice");

  for (const m of MONTHS) {
    XLSX.utils.book_append_sheet(wb, buildMonthSheet(m), m);
  }

  const outPath = path.join(__dirname, "freelancer-budget-tracker.xlsx");
  XLSX.writeFile(wb, outPath);
  console.log(`Written: ${outPath}`);
  console.log(`Tabs: ${wb.SheetNames.join(", ")}`);
}

main().catch(console.error);
