/** Shared formatting and the printable CSC Form No. 1 output. */

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatServiceDate(value, fallback = "—") {
  const text = String(value ?? "").trim();

  if (!text) {
    return fallback;
  }

  const parsed = new Date(`${text}T00:00:00`);

  return Number.isNaN(parsed.getTime()) ? text : dateFormatter.format(parsed);
}

/** An open period reads as "Present" rather than a blank cell. */
export function formatServiceTo(record) {
  if (record?.separationDate) {
    return formatServiceDate(record.separationDate);
  }

  return record?.serviceTo ? formatServiceDate(record.serviceTo) : "Present";
}

export function formatServiceSalary(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return "—";
  }

  return amount.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
}

export function formatLwop(days) {
  const value = Number(days);

  if (!Number.isFinite(value) || value <= 0) {
    return "None";
  }

  return `${value} day${value === 1 ? "" : "s"}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** MM/DD/YYYY. Eleven columns in portrait leave no room for "January", so the form goes numeric. */
function shortDate(value, fallback = "") {
  const text = String(value ?? "").trim();

  if (!text) {
    return fallback;
  }

  const parsed = new Date(`${text.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return text;
  }

  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");

  return `${month}/${day}/${parsed.getFullYear()}`;
}

/** The salary column on the printed form carries no peso sign — the column header already says so. */
function plainSalary(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  return amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "T-III/Step 2" — the printed column is Designation/Step, so the two are joined for it. */
function designationWithStep(record) {
  const designation = String(record?.designationTitle || "").trim();
  const step = String(record?.stepIncrement || "").trim();

  if (!designation) {
    return "";
  }

  return step ? `${designation}/Step ${step}` : designation;
}

/**
 * Opens the printable service record.
 *
 * Mirrors `printDtr` in the attendance workspace, including the `print-color-adjust: exact` rule —
 * without it browsers drop the certifying signature under their default "no background graphics"
 * print setting, and the document goes out unsigned.
 */
export function printServiceRecord({ employee, records = [], certifiedBy = null, signatureDataUrl = "" }) {
  const printWindow = window.open("", "_blank", "width=1000,height=900");

  if (!printWindow) {
    return false;
  }

  const employeeName = employee?.fullName || "Employee";
  const bodyRows = records
    .map(
      (record) => `
        <tr>
          <td>${escapeHtml(shortDate(record.serviceFrom))}</td>
          <td>${escapeHtml(record.separationDate ? shortDate(record.separationDate) : shortDate(record.serviceTo, "To present"))}</td>
          <td class="left">${escapeHtml(designationWithStep(record))}</td>
          <td>${escapeHtml(record.employmentStatus || "")}</td>
          <td class="right">${escapeHtml(plainSalary(record.monthlySalary))}</td>
          <td class="left">${escapeHtml(record.station || "")}</td>
          <td>${escapeHtml(record.branch || "")}</td>
          <td>${escapeHtml(formatLwop(record.lwopDays))}</td>
          <td>${escapeHtml(record.separationDate ? shortDate(record.separationDate) : "None")}</td>
          <td>${escapeHtml(record.separationCause || "None")}</td>
          <td class="left">${escapeHtml(record.remarks || "")}</td>
        </tr>`
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Service Record - ${escapeHtml(employeeName)}</title>
        <style>
          @page { size: legal portrait; margin: 10mm; }
          body { background: #f8fafc; margin: 0; padding: 24px; }
          .sr { background: #fff; color: #000; font-family: "Times New Roman", Times, serif; margin: 0 auto; padding: 26px 30px; width: 794px; }

          /* Masthead: two logos flanking the agency block, as on every other printed form here. */
          .masthead { align-items: center; display: flex; gap: 12px; justify-content: center; }
          .masthead img { height: 62px; object-fit: contain; width: 62px; }
          .masthead .org { flex: 1; text-align: center; }
          .masthead .org p { margin: 1px 0; }
          .org-republic { font-size: 10px; }
          .org-department { font-size: 10px; }
          .org-bureau { font-size: 14px; font-weight: 700; }
          .org-region { font-size: 11px; font-weight: 700; }
          .org-address { font-size: 9px; }

          h1 { font-size: 22px; font-weight: 700; letter-spacing: 1px; margin: 18px 0 14px; text-align: center; }

          .fields { font-size: 12px; }
          .field { align-items: baseline; display: flex; gap: 4px; margin-top: 4px; }
          .fill { border-bottom: 1px solid #000; display: inline-block; min-width: 90px; padding: 0 6px; }
          .fill.grow { flex: 1; }
          .fill.name { font-weight: 700; text-transform: uppercase; }
          .note { font-size: 10px; }
          /* Caption row sits under the fills it labels, so the offsets are deliberate. */
          .captions { display: flex; font-size: 10px; font-style: italic; gap: 34px; padding-left: 62px; }

          .cert { font-size: 12px; line-height: 1.5; margin: 14px 0 10px; text-align: justify; }

          table { border-collapse: collapse; font-size: 8.5px; table-layout: fixed; width: 100%; }
          th, td { border: 1px solid #000; padding: 2px 3px; text-align: center; vertical-align: middle; word-wrap: break-word; }
          th { font-weight: 700; }
          th.group { font-size: 9px; text-transform: uppercase; }
          th.num { font-size: 8px; font-weight: 400; }
          td.left { text-align: left; }
          td.right { text-align: right; }

          .issued { font-size: 11px; line-height: 1.5; margin-top: 12px; }
          .issued em { font-style: italic; text-decoration: underline; }
          .issued-date { font-size: 12px; font-weight: 700; margin-top: 14px; }

          .sign-block { margin-left: auto; margin-top: 26px; width: 300px; }
          .certified { font-size: 11px; font-style: italic; text-align: center; }
          .sig-ink { align-items: flex-end; display: flex; justify-content: center; min-height: 44px; }
          .sig-ink img { display: block; max-height: 44px; max-width: 240px; object-fit: contain; }
          .sig-line { border-bottom: 1px solid #000; width: 100%; }
          .sig-caption { font-size: 11px; text-align: center; }
          .sig-caption .title { font-style: italic; }

          @media print {
            body { background: #fff; padding: 0; }
            .sr { padding: 0; width: auto; }
            thead { display: table-header-group; }
            tr { break-inside: avoid; }
            /* Without this the signature is dropped by the browser's "no background graphics" default. */
            .sig-ink img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <main class="sr">
          <div class="masthead">
            <img src="/mgb.png" alt="MGB Logo" />
            <div class="org">
              <p class="org-republic">Republic of the Philippines</p>
              <p class="org-department">Department of Environment and Natural Resources</p>
              <p class="org-bureau">MINES AND GEOSCIENCES BUREAU</p>
              <p class="org-region">Regional Office No. X</p>
              <p class="org-address">DENR-X Compound, Puntod, Cagayan de Oro City</p>
              <p class="org-address">Telefax Nos. (088) 856-2110; (088) 856-1331 | region10@mgb.gov.ph</p>
            </div>
            <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" />
          </div>

          <h1>SERVICE RECORD</h1>

          <div class="fields">
            <div class="field">
              <span>NAME:</span>
              <span class="fill name grow">${escapeHtml(employeeName)}</span>
            </div>
            <div class="captions">
              <span>(Last Name)</span>
              <span>(Given Name)</span>
              <span>(Middle Name)</span>
            </div>

            <div class="field">
              <span>BIRTH:</span>
              <span class="fill">${escapeHtml(formatServiceDate(employee?.dateOfBirth, ""))}</span>
              <span class="fill grow">${escapeHtml(employee?.placeOfBirth || "")}</span>
              <span class="note">(Date herein should be checked from</span>
            </div>
            <div class="captions">
              <span>(Date)</span>
              <span>(Place)</span>
              <span style="font-style: normal;">birth certificates or other reliable records)</span>
            </div>

            <div class="field">
              <span>EMPLOYEE NUMBER:</span>
              <span class="fill">${escapeHtml(employee?.employeeCode || "")}</span>
              <span>OFFICE:</span>
              <span class="fill grow">Mines and Geosciences Bureau, Regional Office No. X</span>
            </div>
          </div>

          <p class="cert">
            This is to certify that the employee named herein above actually rendered service in this Office as
            indicated below, each line of which is supported by appointment and other papers actually issued and
            approved by the authorities concerned.
          </p>

          <table>
            <colgroup>
              <col style="width: 7%;" /><col style="width: 7%;" />
              <col style="width: 13%;" /><col style="width: 10%;" /><col style="width: 10%;" />
              <col style="width: 12%;" /><col style="width: 7%;" />
              <col style="width: 8%;" />
              <col style="width: 6%;" /><col style="width: 6%;" />
              <col style="width: 14%;" />
            </colgroup>
            <thead>
              <tr>
                <th class="group" colspan="2">Service</th>
                <th class="group" colspan="5">Record of Appointment</th>
                <th rowspan="2">LV. / AB.<br />w/o Pay</th>
                <th class="group" colspan="2" rowspan="2">Separation</th>
                <th class="group" rowspan="3">Remarks</th>
              </tr>
              <tr>
                <th colspan="2">Inclusive Dates</th>
                <th>Designation/<br />Step</th>
                <th>Status</th>
                <th>Salary</th>
                <th>Station/Place</th>
                <th>Branch</th>
              </tr>
              <tr>
                <th>From</th>
                <th>To</th>
                <th class="num">1</th>
                <th class="num">2</th>
                <th class="num">3</th>
                <th class="num">4</th>
                <th class="num">5</th>
                <th class="num">6</th>
                <th>Date</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>${bodyRows || '<tr><td colspan="11">No service record entries.</td></tr>'}</tbody>
          </table>

          <p class="issued">
            Issued in compliance with <em>Executive Order No. 54</em> dated August 10, 1954 and in accordance with
            <em>Circular No. 58</em> dated August 10, 1954 of the system.
          </p>

          <p class="issued-date">
            Date: ${escapeHtml(formatServiceDate(new Date().toISOString().slice(0, 10)))}
          </p>

          <div class="sign-block">
            <p class="certified">Certified Correct</p>
            <div class="sig-ink">${
              signatureDataUrl
                ? `<img src="${escapeHtml(signatureDataUrl)}" alt="Signature of ${escapeHtml(certifiedBy || "certifying officer")}" />`
                : ""
            }</div>
            <div class="sig-line"></div>
            <div class="sig-caption">
              <strong>${escapeHtml(certifiedBy || "")}</strong>
              <div class="title">Human Resource Management Officer</div>
            </div>
          </div>
        </main>
        <script>window.onload = () => { window.print(); };</script>
      </body>
    </html>
  `);
  printWindow.document.close();

  return true;
}
