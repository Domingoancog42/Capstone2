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

/**
 * Newest entry first, so the current appointment heads the list. On a shared start date the entry
 * saved later wins, which is the one still in force.
 */
export function compareServiceRecordsNewestFirst(left, right) {
  const dateComparison = String(right?.serviceFrom || "").localeCompare(String(left?.serviceFrom || ""));

  if (dateComparison !== 0) {
    return dateComparison;
  }

  return Number(right?.id || 0) - Number(left?.id || 0);
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

/** MM-DD-YY, the way the printed form writes its inclusive dates ("09-19-24"). */
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

  return `${month}-${day}-${String(parsed.getFullYear()).slice(-2)}`;
}

/**
 * The printed column is Salary/Annum: twelve times the monthly rate the record stores. No peso sign
 * — the column header already says what the figure is.
 */
function annualSalary(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }

  return (amount * 12).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* The form's Status column carries the appointment's code -- "P" for a Regular (permanent) one. */
const STATUS_CODES = {
  regular: "P",
  permanent: "P",
  temporary: "T",
  casual: "C",
  coterminous: "CT",
  contractual: "Cont.",
  "contract of service": "COS",
  "job order": "JO",
};

/** A status with no standard code prints as stored. */
function statusCode(value) {
  const status = String(value ?? "").trim();

  return STATUS_CODES[status.toLowerCase()] || status;
}

/**
 * The form's Branch column is the branch of government, National or Local, where an entry stores the
 * agency itself ("Mines and Geosciences Bureau"). A local government unit prints as Local and every
 * other agency as National.
 */
function governmentBranch(value) {
  const branch = String(value ?? "").trim();

  if (!branch) {
    return "";
  }

  return /\blocal\b|\blgu\b|\b(?:city|municipal|provincial|barangay) government\b/i.test(branch)
    ? "Local"
    : "National";
}

/** The day after a YYYY-MM-DD date, in the same form; "" for anything unreadable. */
function dayAfter(value) {
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  parsed.setUTCDate(parsed.getUTCDate() + 1);

  return parsed.toISOString().slice(0, 10);
}

/**
 * The separation half of the form's combined Separation/Remarks column.
 *
 * Entries are closed with a separation date and cause even when service simply carries on in the next
 * entry ("Salary Adjustment", "Step Increment"), and that next entry's remarks already say why. So a
 * separation prints only where service actually stopped: no entry begins the day after it.
 */
function separationNote(record, records) {
  const date = String(record?.separationDate || "").slice(0, 10);
  const cause = String(record?.separationCause || "").trim();

  if (!date && !cause) {
    return "";
  }

  const nextDay = date ? dayAfter(date) : "";

  if (nextDay && records.some((other) => String(other?.serviceFrom || "").slice(0, 10) === nextDay)) {
    return "";
  }

  return [date ? shortDate(date) : "", cause].filter(Boolean).join(" / ");
}

/* The printed table's column widths in percent: From, To, Designation, Status, Salary, Station, Branch, LWOP, Remarks. */
export const SERVICE_RECORD_COLUMN_WIDTHS = [7.5, 7.5, 16, 6, 10, 13.5, 7.5, 8, 24];

/**
 * Each entry's nine printed cells, newest entry first: the one source for both the Print view and the
 * downloaded PDF, so the two cannot disagree. The last cell is a list of lines — the remarks, which say
 * why the entry began, then the separation where service stopped there.
 */
export function serviceRecordTableRows(records = []) {
  return [...records].sort(compareServiceRecordsNewestFirst).map((record) => [
    shortDate(record.serviceFrom),
    record.separationDate ? shortDate(record.separationDate) : shortDate(record.serviceTo, "P"),
    String(record.designationTitle || "").trim(),
    statusCode(record.employmentStatus),
    annualSalary(record.monthlySalary),
    String(record.station || "").trim(),
    governmentBranch(record.branch),
    formatLwop(record.lwopDays),
    [record.remarks, separationNote(record, records)].map((line) => String(line || "").trim()).filter(Boolean),
  ]);
}

/**
 * The NAME line in the order the form captions it — Last, Given, Middle — rather than the
 * "Given Middle Last" of `fullName`. A Jr./Sr./III extension stays with the given name, as on the PDS.
 */
export function serviceRecordNameParts(employee) {
  const part = (value) => String(value ?? "").trim();

  return {
    lastName: part(employee?.lastName),
    givenName: [part(employee?.firstName), part(employee?.suffix)].filter(Boolean).join(" "),
    middleName: part(employee?.middleName),
  };
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
  const nameParts = serviceRecordNameParts(employee);
  const bodyRows = serviceRecordTableRows(records)
    .map(([from, to, designation, status, salary, station, branch, lwop, remarks]) => `
        <tr>
          <td>${escapeHtml(from)}</td>
          <td>${escapeHtml(to)}</td>
          <td>${escapeHtml(designation)}</td>
          <td>${escapeHtml(status)}</td>
          <td class="right">${escapeHtml(salary)}</td>
          <td>${escapeHtml(station)}</td>
          <td>${escapeHtml(branch)}</td>
          <td>${escapeHtml(lwop)}</td>
          <td class="left">${remarks.map(escapeHtml).join("<br />")}</td>
        </tr>`)
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

          /*
           * Masthead: two logos flanking the agency block. The block keeps its own width rather than
           * stretching, so the logos sit right beside the bureau name instead of at the page edges.
           */
          .masthead { align-items: center; display: flex; gap: 16px; justify-content: center; }
          .masthead img { flex-shrink: 0; height: 95px; object-fit: contain; width: 95px; }
          .masthead .org { text-align: center; }
          .masthead .org p { margin: 1px 0; }
          .org-republic { font-size: 10px; }
          .org-department { font-size: 10px; }
          .org-bureau { font-size: 14px; font-weight: 700; }
          .org-region { font-size: 11px; font-weight: 700; }
          .org-address { font-size: 9px; }

          /*
           * The letterhead's yellow rule under the contact line, then the GSIS form number. The rule is a
           * border rather than a background so it still prints with "background graphics" switched off.
           */
          .letterhead-rule { border-top: 6px solid #efe28b; margin-top: 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .form-number { font-family: Arial, Helvetica, sans-serif; font-size: 10px; margin: 14px 0 0; }

          h1 { font-size: 22px; font-weight: 700; letter-spacing: 1px; margin: 18px 0 14px; text-align: center; }

          .fields { font-size: 12px; }
          .field { align-items: baseline; display: flex; gap: 4px; margin-top: 4px; }
          .fill { border-bottom: 1px solid #000; display: inline-block; min-width: 90px; padding: 0 6px; }
          .fill.grow { flex: 1; }
          .fill.name { font-weight: 700; text-transform: uppercase; }
          /* Each name part sits directly over its caption, so the two line up whatever the name's length. */
          .name-grid { column-gap: 12px; display: grid; flex: 1; grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .name-grid .fill { text-align: center; }
          .name-grid .caption { font-size: 10px; font-style: italic; text-align: center; }
          .note { font-size: 10px; }
          /* Caption row sits under the fills it labels, so the offsets are deliberate. */
          .captions { display: flex; font-size: 10px; font-style: italic; gap: 34px; padding-left: 62px; }

          .cert { font-size: 12px; line-height: 1.5; margin: 14px 0 10px; text-align: justify; }

          /* The appointment table follows the paper form: sans-serif, with bold upper-case headings. */
          table { border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; table-layout: fixed; width: 100%; }
          th, td { border: 1px solid #000; padding: 3px 4px; text-align: center; vertical-align: middle; word-wrap: break-word; }
          th { font-size: 9px; font-weight: 700; line-height: 1.25; padding: 3px 2px; text-transform: uppercase; }
          th .caption { text-transform: none; }
          /* An entry's cells start at the top of its row, as the PDF draws them for Import Record to read line by line. */
          td { vertical-align: top; }
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
          <div class="letterhead-rule"></div>
          <p class="form-number">GSIS D 202 (Revised 1989)</p>

          <h1>SERVICE RECORD</h1>

          <div class="fields">
            <div class="field">
              <span>NAME:</span>
              <div class="name-grid">
                <span class="fill name">${escapeHtml(nameParts.lastName) || "&nbsp;"}</span>
                <span class="fill name">${escapeHtml(nameParts.givenName) || "&nbsp;"}</span>
                <span class="fill name">${escapeHtml(nameParts.middleName) || "&nbsp;"}</span>
                <span class="caption">(Last Name)</span>
                <span class="caption">(Given Name)</span>
                <span class="caption">(Middle Name)</span>
              </div>
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
          </div>

          <p class="cert">
            This is to certify that the employee named herein above actually rendered service in this Office as
            indicated below, each line of which is supported by appointment and other papers actually issued and
            approved by the authorities concerned.
          </p>

          <table>
            <colgroup>${SERVICE_RECORD_COLUMN_WIDTHS.map((width) => `<col style="width: ${width}%;" />`).join("")}</colgroup>
            <thead>
              <tr>
                <th colspan="2">Service<br /><span class="caption">(Inclusive Date)</span></th>
                <th colspan="3">Record of Appointment</th>
                <th colspan="2">Office</th>
                <th rowspan="2">Leave of<br />Absence<br />W/O Pay</th>
                <th rowspan="2">Separation<br />Date/Cause<br />Remarks</th>
              </tr>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Designation</th>
                <th>Status</th>
                <th>Salary<br />/Annum</th>
                <th>Station/Place<br />of Assignment</th>
                <th>Branch</th>
              </tr>
            </thead>
            <tbody>${bodyRows || '<tr><td colspan="9">No service record entries.</td></tr>'}</tbody>
          </table>

          <p class="issued">
            Issued in compliance with <em>Executive Order No. 54</em> dated August 10, 1954 and in accordance with
            <em>Circular No. 58</em> dated August 10, 1954 of the system.
          </p>

          <p class="issued-date">
            Date: ${escapeHtml(formatServiceDate(new Date().toLocaleDateString("en-CA")))}
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
