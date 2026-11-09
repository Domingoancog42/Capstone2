/** A form contains all KPI rows for one accountable person/unit and one rating period. */
export function performanceFormKey(record, kind) {
  if (kind === "ipcr") {
    return JSON.stringify([String(record.employeeRecordId || `record:${record.ipcrId || record.id}`), record.periodFrom || "", record.periodTo || ""]);
  }
  const owner = record.employeeRecordId
    ? `individual:${record.employeeRecordId}`
    : `division:${String(record.division || record.accountableName || `record:${record.assignmentId || record.id}`).trim().toLowerCase()}`;
  return JSON.stringify([owner, record.period || "", record.semester || ""]);
}

function mean(values) {
  const scores = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2)) : null;
}

function score(record) {
  return mean([record.a4Rating || record.finalRating]) || mean([record.q1Rating, record.e2Rating, record.t3Rating]);
}

/*
 * An IPCR form's status from where its KPIs stand in validation (ipcr.php): every KPI validated
 * (stored as "rated"), some of them, any sent back to the employee, any waiting on the rater, or
 * none submitted yet. Attaching a MOV alone does not submit a KPI.
 */
function ipcrFormStatus(kpis) {
  const stages = kpis.map((record) => String(record.status || "").toLowerCase());
  const validated = stages.filter((stage) => stage === "rated").length;
  if (validated === kpis.length) return "Validated";
  if (validated > 0) return "Partially validated";
  if (stages.includes("needs_revision")) return "Returned";
  if (stages.includes("submitted")) return "Submitted";
  return "Draft";
}

/*
 * An OPCR form's status, the same way, from opcr.php's workflow: the division chief submits each
 * KPI's accomplishment and MOVs, and the Regional Director validates it (stored as "Rated") or
 * returns it to the chief.
 */
function opcrFormStatus(kpis) {
  const stages = kpis.map((record) => String(record.status || "").toLowerCase());
  const validated = stages.filter((stage) => stage === "rated").length;
  if (validated === kpis.length) return "Validated";
  if (validated > 0) return "Partially validated";
  if (stages.includes("returned")) return "Returned";
  if (stages.includes("submitted")) return "Submitted";
  return "Assigned";
}

export function groupPerformanceForms(records, kind) {
  const groups = new Map();
  records.forEach((record) => {
    const key = performanceFormKey(record, kind);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return Array.from(groups, ([formKey, kpis]) => {
    return {
      ...kpis[0],
      formKey,
      kpis,
      kpiCount: kpis.length,
      kpiTitle: kpis.length === 1 ? kpis[0].kpiTitle || kpis[0].output : `${kpis.length} KPIs`,
      budget: kpis.reduce((sum, record) => sum + (Number(record.budget) || 0), 0),
      verificationFiles: kpis.flatMap((record) => record.verificationFiles || []),
      modeOfVerificationName: kpis.filter((record) => record.modeOfVerificationPath).length
        ? `${kpis.filter((record) => record.modeOfVerificationPath).length} file(s)` : "",
      q1Rating: mean(kpis.map((record) => record.q1Rating)),
      e2Rating: mean(kpis.map((record) => record.e2Rating)),
      t3Rating: mean(kpis.map((record) => record.t3Rating)),
      a4Rating: mean(kpis.map(score)),
      finalRating: mean(kpis.map(score)),
      status: kind === "ipcr" ? ipcrFormStatus(kpis) : opcrFormStatus(kpis),
      remarks: kpis.map((record) => record.remarks).filter(Boolean).join("; "),
    };
  });
}

export function filterPerformanceForms(forms, query, division) {
  const needle = query.trim().toLowerCase();
  return forms.filter((form) => (!division || String(form.division || "").trim() === division)
    && (!needle || form.kpis.some((record) => [
      record.employeeCode, record.employeeName, record.accountableName, record.division, record.position,
      record.opcrNo, record.period, record.semester, record.periodFrom, record.periodTo,
      record.kpiTitle, record.output, record.successIndicator, record.category, record.status,
    ].some((value) => String(value || "").toLowerCase().includes(needle)))));
}

/*
 * On the printed forms an output (IPCR) or OO/PAP (OPCR) is one cell spanning a row per success
 * indicator, so adjacent rows under the same band with the same output share that cell.
 */
export function sameOutputCell(left, right) {
  if (!left || !right) return false;
  const band = (record) => (String(record.category || record.kpiCategory || "").trim() || "Program").toUpperCase();
  /* The OPCR sub-heading under the band; the same output under two sub-headings is two cells. */
  const subBand = (record) => String(record.subCategory || record.sub_category || "").trim().toLowerCase();
  /* The IPCR program band above the category; the same output under two programs is two cells. */
  const programBand = (record) => String(record.program || "").trim().toLowerCase();
  const output = (record) => String(record.output || record.kpiTitle || "").trim().toLowerCase();
  return programBand(left) === programBand(right) && band(left) === band(right)
    && subBand(left) === subBand(right) && output(left) === output(right);
}

/** How many rows from `start` onward, `start` included, share that row's output cell. */
export function outputRunLength(rows, start) {
  let length = 1;
  while (start + length < rows.length && sameOutputCell(rows[start], rows[start + length])) length += 1;
  return length;
}

/*
 * An IPCR form's KPI rows in printed order: by program, then category, so each band prints once,
 * then in entry order. The form preview, the rating dialog and My IPCR all list them this way.
 */
export function orderIpcrFormRows(rows) {
  const entryOrder = (record) => {
    const id = Number(record.ipcrId || record.id);
    return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
  };

  return [...rows].sort((left, right) => {
    const programSort = String(left.program || "").localeCompare(String(right.program || ""));
    if (programSort !== 0) return programSort;
    const categorySort = String(left.category || "").localeCompare(String(right.category || ""));
    if (categorySort !== 0) return categorySort;
    return entryOrder(left) - entryOrder(right)
      || String(left.ipcrId || left.id || "").localeCompare(String(right.ipcrId || right.id || ""));
  });
}
