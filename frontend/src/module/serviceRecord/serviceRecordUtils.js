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
          <td>${escapeHtml(formatServiceDate(record.serviceFrom))}</td>
          <td>${escapeHtml(formatServiceTo(record))}</td>
          <td class="left">${escapeHtml(record.designationTitle || "—")}</td>
          <td>${escapeHtml(record.employmentStatus || "—")}</td>
          <td class="right">${escapeHtml(formatServiceSalary(record.monthlySalary))}</td>
          <td class="left">${escapeHtml(record.station || "—")}</td>
          <td class="left">${escapeHtml(record.branch || "—")}</td>
          <td>${escapeHtml(formatLwop(record.lwopDays))}</td>
          <td>${escapeHtml(record.separationDate ? formatServiceDate(record.separationDate) : "—")}</td>
          <td class="left">${escapeHtml(record.separationCause || "—")}</td>
          <td class="left">${escapeHtml(record.remarks || "—")}</td>
        </tr>`
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Service Record - ${escapeHtml(employeeName)}</title>
        <style>
          @page { size: legal landscape; margin: 12mm; }
          body { background: #f8fafc; margin: 0; padding: 24px; }
          .sr { background: #fff; color: #000; font-family: "Times New Roman", Times, serif; margin: 0 auto; padding: 28px; width: 1040px; }
          .form-no { font-size: 10px; font-style: italic; }
          .header { position: relative; text-align: center; }
          .logo { height: 56px; left: 0; object-fit: contain; position: absolute; top: 0; width: 56px; }
          h1 { font-size: 15px; letter-spacing: 1px; margin: 0; text-transform: uppercase; }
          h2 { font-size: 13px; margin: 4px 0 0; }
          .subtitle { font-size: 11px; font-style: italic; margin-top: 2px; }
          .person { font-size: 12px; margin-top: 18px; }
          .person .line { border-bottom: 1px solid #000; display: inline-block; font-weight: 700; min-width: 260px; padding: 0 6px; text-transform: uppercase; }
          .person .meta { display: flex; gap: 28px; justify-content: center; margin-top: 6px; }
          .person .meta span { border-bottom: 1px solid #000; min-width: 150px; padding: 0 6px; }
          .caption-sm { font-size: 9px; }
          table { border-collapse: collapse; font-size: 10px; margin-top: 16px; width: 100%; }
          th, td { border: 1px solid #000; padding: 3px 4px; text-align: center; vertical-align: top; }
          th { font-size: 9px; text-transform: uppercase; }
          td.left { text-align: left; }
          td.right { text-align: right; }
          .cert { font-size: 11px; line-height: 1.6; margin-top: 22px; text-align: justify; }
          .sign-block { margin-top: 40px; text-align: right; }
          .sig-ink { align-items: flex-end; display: flex; justify-content: center; margin-left: auto; min-height: 46px; width: 280px; }
          .sig-ink img { display: block; max-height: 46px; max-width: 240px; object-fit: contain; }
          .sig-line { border-bottom: 1px solid #000; margin-left: auto; width: 280px; }
          .sig-caption { font-size: 10px; margin-left: auto; text-align: center; width: 280px; }
          .footnote { font-size: 9px; font-style: italic; margin-top: 26px; }
          @media print {
            body { background: #fff; padding: 0; }
            .sr { padding: 0; width: auto; }
            /* Without this the signature is dropped by the browser's "no background graphics" default. */
            .sig-ink img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <main class="sr">
          <div class="form-no">CS Form No. 1<br />Revised 2018</div>
          <div class="header">
            <img class="logo" src="/mgb.png" alt="MGB Logo" />
            <h1>Service Record</h1>
            <h2>Mines and Geosciences Bureau</h2>
            <div class="subtitle">(To be accomplished by the Human Resource Management Officer)</div>
          </div>

          <div class="person">
            <div>
              NAME: <span class="line">${escapeHtml(employeeName)}</span>
            </div>
            <div class="meta">
              <span>${escapeHtml(formatServiceDate(employee?.dateOfBirth, "—"))}</span>
              <span>${escapeHtml(employee?.placeOfBirth || "—")}</span>
            </div>
            <div class="meta caption-sm">
              <span style="border:none;">(Date of Birth)</span>
              <span style="border:none;">(Place of Birth)</span>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th colspan="2">Service</th>
                <th colspan="3">Record of Appointment</th>
                <th rowspan="2">Station /<br />Place of Assignment</th>
                <th rowspan="2">Branch</th>
                <th rowspan="2">Leave Without Pay</th>
                <th colspan="2">Separation</th>
                <th rowspan="2">Remarks</th>
              </tr>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Designation</th>
                <th>Status</th>
                <th>Salary</th>
                <th>Date</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>${bodyRows || '<tr><td colspan="11">No service record entries.</td></tr>'}</tbody>
          </table>

          <p class="cert">
            This is to certify that the information stated above is a true record of the service of
            <strong>${escapeHtml(employeeName)}</strong> in this Bureau, taken from the official records on file
            in this Office.
          </p>

          <div class="sign-block">
            <div class="sig-ink">${
              signatureDataUrl
                ? `<img src="${escapeHtml(signatureDataUrl)}" alt="Signature of ${escapeHtml(certifiedBy || "certifying officer")}" />`
                : ""
            }</div>
            <div class="sig-line"></div>
            <div class="sig-caption">
              <strong>${escapeHtml(certifiedBy || "")}</strong><br />
              Human Resource Management Officer
            </div>
          </div>

          <p class="footnote">
            Issued on ${escapeHtml(formatServiceDate(new Date().toISOString().slice(0, 10)))}.
            Any erasure or alteration made on this record renders it void.
          </p>
        </main>
        <script>window.onload = () => { window.print(); };</script>
      </body>
    </html>
  `);
  printWindow.document.close();

  return true;
}
