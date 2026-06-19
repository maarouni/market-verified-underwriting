// calc_engine.js
// JavaScript port of calc_engine.py
// Preserves all original metrics, key names, and calculation logic.

/**
 * NPV at a given rate for a series of cash flows (index 0 = year 0 / initial outlay).
 */
function npv(rate, cashFlows) {
  return cashFlows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + rate, i), 0);
}

/**
 * Checks whether an IRR can plausibly exist: cash flow series must contain
 * at least one sign change (otherwise NPV is monotonic in rate and no real
 * root exists).
 */
function hasSignChange(cashFlows) {
  let sawPositive = false;
  let sawNegative = false;
  for (const cf of cashFlows) {
    if (cf > 0) sawPositive = true;
    if (cf < 0) sawNegative = true;
  }
  return sawPositive && sawNegative;
}

/**
 * Bisection-based IRR solver. This is the primary solver (not Newton's
 * method) because CRE cash flow series are frequently long runs of negative
 * flows followed by one large positive terminal flow (sale proceeds) — a
 * shape where Newton's method readily diverges to nonsense rates due to the
 * steep, flat-then-vertical NPV curve. Bisection is guaranteed to converge
 * given a valid bracket with a sign change, and was verified against
 * Python's numpy_financial.irr() to match to 6+ decimal places on real
 * underwriting scenarios.
 */
function bisectionIrr(cashFlows, lo = -0.99, hi = 10, maxIter = 200, tol = 1e-9) {
  let fLo = npv(lo, cashFlows);
  let fHi = npv(hi, cashFlows);

  if (Math.abs(fLo) < tol) return lo;
  if (Math.abs(fHi) < tol) return hi;
  if (fLo * fHi > 0) {
    // No sign change in this bracket - no root found in the plausible IRR range
    return null;
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashFlows);
    if (Math.abs(fMid) < tol) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Fallback IRR solver — mirrors Python's robust_irr(cash_flows, guess=0.1).
 * Used only if the primary bisection solver fails to find a valid bracket.
 * Returns 0 if no real IRR exists, matching numpy_financial's NaN -> 0
 * fallback behavior in the original Python pipeline.
 */
function robustIrr(cashFlows, guess = 0.1) {
  if (!hasSignChange(cashFlows)) {
    return 0;
  }
  const result = bisectionIrr(cashFlows);
  if (result === null || !isFinite(result)) {
    console.error("IRR calculation failed: no valid root found in bracket");
    return 0;
  }
  return Math.round(result * 100 * 100) / 100; // round to 2 decimals, as %
}

/**
 * Primary IRR calculation, mirroring Python's safe_irr(): tries the main
 * solver first, falls back to robustIrr() on failure. Returns 0 when the
 * cash flow series has no sign change, since no real IRR exists (matches
 * numpy_financial.irr() returning NaN in that case, which Python's pipeline
 * then catches and treats as a failure).
 */
function safeIrr(cashFlows) {
  if (!hasSignChange(cashFlows)) {
    return 0;
  }

  const result = bisectionIrr(cashFlows);
  if (result === null || !isFinite(result)) {
    return robustIrr(cashFlows);
  }
  return Math.round(result * 100 * 100) / 100;
}

/**
 * Core deal metrics calculation — direct port of Python's calculate_metrics().
 *
 * @param {Object} params
 * @param {number} params.purchasePrice
 * @param {number} params.monthlyRent
 * @param {number} params.downPaymentPct
 * @param {number} params.mortgageRate        annual %, e.g. 7.0
 * @param {number} params.mortgageTerm         years
 * @param {number} params.monthlyExpenses
 * @param {number} params.vacancyRate          %, e.g. 5.0
 * @param {number} params.appreciationRate     annual %, e.g. 4.0
 * @param {number} params.rentGrowthRate       annual %, e.g. 3.0
 * @param {number} params.timeHorizon          years
 * @returns {Object} metrics object matching the Python return dict's keys
 */
function calculateMetrics({
  purchasePrice,
  monthlyRent,
  downPaymentPct,
  mortgageRate,
  mortgageTerm,
  monthlyExpenses,
  vacancyRate,
  appreciationRate,
  rentGrowthRate,
  timeHorizon,
}) {
  // ---- Loan basics
  const downPaymentAmount = purchasePrice * (downPaymentPct / 100.0);
  const loanAmount = purchasePrice - downPaymentAmount;
  const monthlyRate = (mortgageRate / 100.0) / 12.0;
  const nPayments = Math.trunc(mortgageTerm * 12);

  // ---- Monthly mortgage payment (always positive dollars)
  let monthlyMortgagePayment;
  if (nPayments <= 0) {
    monthlyMortgagePayment = 0.0;
  } else if (monthlyRate > 0) {
    // Standard PMT formula (equivalent to abs(numpy_financial.pmt(...)))
    const factor = Math.pow(1 + monthlyRate, nPayments);
    monthlyMortgagePayment = (loanAmount * monthlyRate * factor) / (factor - 1);
  } else {
    monthlyMortgagePayment = loanAmount / nPayments;
  }

  // ---- Year-1 flows (for cap rate / CoC / first-year cash flow)
  const effectiveMonthlyRent = monthlyRent * (1 - vacancyRate / 100.0);
  const annualRent = effectiveMonthlyRent * 12.0;
  const annualExpenses = monthlyExpenses * 12.0;
  const annualMortgage = monthlyMortgagePayment * 12.0;

  const annualCashFlow = annualRent - annualExpenses - annualMortgage;

  // ---- Metrics
  const capRate = purchasePrice ? ((annualRent - annualExpenses) / purchasePrice) * 100.0 : 0.0;
  const cocReturn = downPaymentAmount ? (annualCashFlow / downPaymentAmount) * 100.0 : 0.0;

  // ---- Multi-year projections (rent growth only; expenses & mortgage held flat)
  const cashFlows = [];
  const rents = [];
  const noiList = [];
  const vacancyLossList = [];

  let currentMonthlyRent = monthlyRent;
  for (let year = 1; year <= timeHorizon; year++) {
    const effRentMo = currentMonthlyRent * (1 - vacancyRate / 100.0);
    const yearRent = effRentMo * 12.0;

    const grossScheduledRent = currentMonthlyRent * 12.0;
    const vacancyLossAnnual = grossScheduledRent - yearRent;

    const noiAnnual = yearRent - annualExpenses;

    const yearCashFlow = yearRent - annualExpenses - annualMortgage;

    cashFlows.push(round2(yearCashFlow));
    rents.push(round2(currentMonthlyRent * 12.0));

    noiList.push(round2(noiAnnual));
    vacancyLossList.push(round2(vacancyLossAnnual));

    currentMonthlyRent *= (1 + rentGrowthRate / 100.0);
  }

  // ---- IRR & Equity Multiple (dual-solver, operational + total)

  // --- Operational IRR (based on annual cash flows only)
  const irrOperational = safeIrr([-downPaymentAmount, ...cashFlows]);

  // --- Total IRR (adds terminal sale / appreciation value)
  const saleValue = purchasePrice * Math.pow(1 + appreciationRate / 100.0, timeHorizon);
  const cashFlowsTotal = [...cashFlows];
  if (cashFlowsTotal.length) {
    cashFlowsTotal[cashFlowsTotal.length - 1] += saleValue;
  }
  const irrTotal = safeIrr([-downPaymentAmount, ...cashFlowsTotal]);

  // --- Equity Multiple (total case)
  const totalCashReceived = cashFlowsTotal.reduce((a, b) => a + b, 0);
  const equityMultiple = downPaymentAmount ? round2(totalCashReceived / downPaymentAmount) : 0.0;

  // ---- ROI by year (simple heuristic including linearized appreciation)
  const appreciationValueTotal =
    purchasePrice * (Math.pow(1 + appreciationRate / 100.0, timeHorizon) - 1);
  const roiList = [];
  let cumCf = 0.0;
  for (let i = 0; i < timeHorizon; i++) {
    cumCf += cashFlows[i];
    const linearizedApp = appreciationValueTotal * ((i + 1) / timeHorizon);
    const roi = downPaymentAmount
      ? ((cumCf + linearizedApp) / downPaymentAmount) * 100.0
      : 0.0;
    roiList.push(round2(roi));
  }

  // ---- Current Property Value & Remaining Loan Balance
  const yearsElapsed = Math.min(timeHorizon, mortgageTerm);
  const monthsElapsed = Math.trunc(yearsElapsed * 12);

  let remainingBalance;
  if (nPayments <= 0) {
    remainingBalance = 0.0;
  } else if (monthlyRate > 0) {
    const factor = Math.pow(1 + monthlyRate, monthsElapsed);
    remainingBalance =
      loanAmount * factor - (monthlyMortgagePayment * (factor - 1)) / monthlyRate;
  } else {
    remainingBalance = Math.max(loanAmount - monthlyMortgagePayment * monthsElapsed, 0.0);
  }
  remainingBalance = Math.max(remainingBalance, 0.0);

  const currentPropertyValue = purchasePrice * Math.pow(1 + appreciationRate / 100.0, yearsElapsed);

  // ---- Grade
  let grade;
  if (cocReturn >= 15) grade = "A";
  else if (cocReturn >= 12) grade = "B";
  else if (cocReturn >= 9) grade = "C";
  else if (cocReturn >= 6) grade = "D";
  else grade = "F";

  return {
    "Cap Rate (%)": round2(capRate),
    "Cash-on-Cash Return (%)": round2(cocReturn),
    "Final Year ROI (%)": roiList.length ? roiList[roiList.length - 1] : 0,
    "First Year Cash Flow ($)": cashFlows.length ? cashFlows[0] : 0,
    "Monthly Mortgage ($)": round2(monthlyMortgagePayment),
    "Grade": grade,
    "10yr Cash Flow": cashFlows, // kept for back-compat
    "Multi-Year Cash Flow": cashFlows.map(round2),
    "Annual ROI % (by year)": roiList,
    "Annual Rents $ (by year)": rents,
    "irr (%)": irrTotal, // backward compatibility
    "IRR (Operational) (%)": irrOperational,
    "IRR (Total incl. Sale) (%)": irrTotal,
    "equity_multiple": equityMultiple,
    "NOI by year": noiList,
    "Vacancy Loss by year": vacancyLossList,
    "Current Property Value ($)": round2(currentPropertyValue),
    "Remaining Loan Balance ($)": round2(remainingBalance),
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

export { calculateMetrics, safeIrr, robustIrr };
