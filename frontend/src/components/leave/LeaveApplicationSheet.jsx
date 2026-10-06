import React from "react";
import FormQrCode from "../UI/FormQrCode";
import { downloadFormSheetPdf } from "../../utils/formSheetPdf";
import { fitSheetToPrintArea, PRINT_AREA_WIDTH_MM, PRINT_PAGE_MARGIN_MM } from "../../utils/printSheetFit";

/*
 * The CSC Form No. 6 (Application for Leave) sheet, shared by the leave request form and the leave
 * monetization form so the two print, download and read alike. Each form brings its own data as
 * `formData` and its own signatories; the layout, the print styles and the print window are here.
 */

const styles = {
  wrap: {
    fontFamily: "Arial, sans-serif",
    fontSize: "11px",
    width: "100%",
    maxWidth: "860px",
    margin: 0,
    background: "#fff",
    boxShadow: "0 25px 60px rgba(15, 23, 42, 0.25)",
  },
  // The logo header sits outside the ruled box; only the numbered sections are framed.
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "20px",
    padding: "12px",
    textAlign: "center",
  },
  body: {
    border: "2px solid #000",
  },
  logoImage: {
    width: "130px",
    height: "130px",
    objectFit: "contain",
    flexShrink: 0,
  },
  formTitle: {
    marginTop: "8px",
    fontSize: "17px",
    fontWeight: "bold",
    textDecoration: "underline",
  },
  row: {
    display: "flex",
    width: "100%",
    borderBottom: "1px solid #000",
  },
  cell: {
    padding: "6px 8px",
    borderRight: "1px solid #000",
    boxSizing: "border-box",
  },
  label: {
    fontWeight: "bold",
    display: "block",
    marginBottom: "4px",
    fontSize: "9px",
    textTransform: "uppercase",
  },
  sectionTitle: {
    background: "#f2f2f2",
    textAlign: "center",
    fontWeight: "bold",
    padding: "5px",
    borderBottom: "1px solid #000",
  },
  input: {
    border: "none",
    borderBottom: "1px solid #aaa",
    outline: "none",
    fontSize: "11px",
    fontWeight: "bold",
    textTransform: "uppercase",
    width: "100%",
    background: "transparent",
    color: "#111827",
  },
  checklistItem: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    marginBottom: "4px",
    fontSize: "11px",
  },
  subLabel: {
    fontStyle: "italic",
    margin: "8px 0 4px",
    fontWeight: "bold",
    fontSize: "10px",
  },
  creditsTable: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "5px",
  },
  sigLine: {
    borderTop: "1px solid #000",
    width: "85%",
    margin: "5px auto 0",
    fontWeight: "bold",
    fontSize: "10px",
    textAlign: "center",
    paddingTop: "2px",
  },
  signaturePreview: {
    minHeight: "40px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    marginBottom: "0",
  },
  signatureImage: {
    maxWidth: "170px",
    maxHeight: "44px",
    objectFit: "contain",
    display: "block",
  },
  signatureTimestamp: {
    color: "#111827",
    fontSize: "9px",
    fontStyle: "italic",
    fontWeight: "bold",
    lineHeight: 1.2,
    textAlign: "center",
  },
  signatureCaption: {
    textAlign: "center",
    fontSize: "10px",
    marginTop: "2px",
  },
  signatureName: {
    width: "85%",
    margin: "0 auto",
    fontWeight: "bold",
    fontSize: "10px",
    textAlign: "center",
    minHeight: "12px",
  },
  signatureUnderline: {
    width: "85%",
    margin: "1px auto 0",
    borderTop: "1px solid #000",
  },
  // (empty) | Regional Director signature | QR. The equal side columns keep the signature centred.
  qrFooter: {
    display: "grid",
    gridTemplateColumns: "1fr 2fr 1fr",
    alignItems: "end",
    gap: "10px",
    padding: "6px 8px",
  },
  qrColumn: {
    gridColumn: 3,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "3px",
  },
  qrFooterNote: {
    fontSize: "8px",
    lineHeight: 1.4,
    color: "#111827",
    textAlign: "right",
  },
};

const tdStyle = {
  border: "1px solid #000",
  padding: "4px",
  textAlign: "center",
  fontSize: "10px",
};

const inputWithoutUnderlineStyle = {
  ...styles.input,
  borderBottom: "none",
};

/*
 * Print-only tightening for the cloned sheet. The on-screen form sizes itself with inline styles,
 * so these rules need `!important` to take over; the class names are hooks that only this print
 * window styles. The CSC Form No. 6 keeps its layout — only spacing, logos, type and QR shrink.
 */
export const LEAVE_FORM_PRINT_CSS = `
  @page {
    size: auto;
    margin: ${PRINT_PAGE_MARGIN_MM}mm;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
  }

  body {
    font-family: Arial, sans-serif;
    color: #000000;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-shell {
    width: ${PRINT_AREA_WIDTH_MM}mm;
    margin: 0 auto;
    overflow: hidden;
  }

  .print-shell > .leave-form-paper {
    width: ${PRINT_AREA_WIDTH_MM}mm !important;
    max-width: none !important;
    margin: 0 !important;
    box-shadow: none !important;
    font-size: 9.5px !important;
  }

  .leave-print-header { gap: 14px !important; padding: 0 4px 5px !important; }
  .leave-print-header img { width: 62px !important; height: 62px !important; }
  .leave-print-header p { margin: 0 !important; font-size: 9px !important; }
  .leave-print-header h3 { margin: 2px 0 !important; font-size: 11px !important; }
  .leave-print-title { margin-top: 3px !important; font-size: 14px !important; }

  .leave-print-section { padding: 2px !important; font-size: 10px !important; }
  .leave-print-row > div { padding: 3px 6px !important; }
  .leave-print-row p { margin-top: 2px !important; margin-bottom: 2px !important; }
  .leave-print-row .leave-print-sublabel { margin: 3px 0 1px !important; font-size: 8.5px !important; }
  .leave-print-check { gap: 4px !important; margin-bottom: 1px !important; font-size: 9px !important; }
  .leave-form-paper label { margin-bottom: 2px !important; font-size: 8px !important; }
  .leave-form-paper input:not([type="checkbox"]) { padding: 0 1px !important; font-size: 9.5px !important; }
  .leave-form-paper input[type="checkbox"] { width: 10px !important; height: 10px !important; }
  .leave-form-paper th,
  .leave-form-paper td { padding: 1px 3px !important; font-size: 9px !important; }

  .leave-print-sign { margin-top: 6px !important; }
  .leave-print-signature { min-height: 30px !important; }
  .leave-print-sign img { max-height: 32px !important; }

  /* About 23 mm across: still roughly 0.4 mm a module for the payload's QR version, which a phone reads. */
  .leave-print-qr { padding: 3px 6px !important; }
  .leave-print-qr svg { width: 88px !important; height: 88px !important; }
`;

function ReadOnlyInput(props) {
  return <input {...props} readOnly />;
}

function SelectionIndicator({ checked = false }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      aria-hidden="true"
      tabIndex={-1}
      style={{
        width: "13px",
        height: "13px",
        margin: 0,
        flexShrink: 0,
        accentColor: "#111827",
        pointerEvents: "none",
      }}
    />
  );
}

function SignatureBlock({
  signatureDataUrl = "",
  fallbackText = "",
  name = "",
  caption = "",
}) {
  return (
    <div className="leave-print-sign" style={{ marginTop: "20px", textAlign: "center" }}>
      <div className="leave-print-signature" style={styles.signaturePreview}>
        {signatureDataUrl ? (
          <>
            <img
              src={signatureDataUrl}
              alt={`${name || "Authorized"} signature`}
              style={styles.signatureImage}
            />
            {fallbackText ? (
              <div style={styles.signatureTimestamp}>{fallbackText}</div>
            ) : null}
          </>
        ) : fallbackText ? (
          <div style={styles.signatureTimestamp}>{fallbackText}</div>
        ) : null}
      </div>
      <div style={styles.signatureName}>{name}</div>
      <div style={styles.signatureUnderline} />
      <div style={styles.signatureCaption}>{caption}</div>
    </div>
  );
}

/* A signatory's block once they have signed; before that, the blank line with its caption. */
function SignatoryLine({ signatory = {} }) {
  if (signatory.signed) {
    return (
      <SignatureBlock
        signatureDataUrl={signatory.signatureDataUrl}
        fallbackText={signatory.fallbackText}
        name={signatory.name}
        caption={signatory.caption}
      />
    );
  }

  return (
    <div className="leave-print-sign" style={{ marginTop: "20px", textAlign: "center" }}>
      <div style={styles.sigLine}>{signatory.caption}</div>
    </div>
  );
}

/* Opens the print dialog on a copy of the sheet, styled and fitted to one page as above. */
export function printLeaveApplicationSheet(sheet, { title = "Application for Leave" } = {}) {
  if (!sheet) {
    return;
  }

  const formClone = sheet.cloneNode(true);
  const sourceFields = sheet.querySelectorAll("input, textarea, select");
  const clonedFields = formClone.querySelectorAll("input, textarea, select");

  sourceFields.forEach((field, index) => {
    const clonedField = clonedFields[index];
    if (!clonedField) {
      return;
    }

    if (field instanceof HTMLInputElement && clonedField instanceof HTMLInputElement) {
      if (field.type === "checkbox" || field.type === "radio") {
        clonedField.checked = field.checked;
      } else {
        clonedField.value = field.value;
        clonedField.setAttribute("value", field.value);
      }
      return;
    }

    if (field instanceof HTMLTextAreaElement && clonedField instanceof HTMLTextAreaElement) {
      clonedField.value = field.value;
      clonedField.textContent = field.value;
      return;
    }

    if (field instanceof HTMLSelectElement && clonedField instanceof HTMLSelectElement) {
      clonedField.value = field.value;
    }
  });

  const printWindow = window.open("", "_blank", "width=960,height=1200");
  if (!printWindow) {
    return;
  }

  printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title}</title>
          <style>${LEAVE_FORM_PRINT_CSS}</style>
        </head>
        <body>
          <div class="print-shell">${formClone.outerHTML}</div>
        </body>
      </html>
    `);
  printWindow.document.close();

  /* Fitted once the images are in, since a signature's height is only known after it loads. */
  const finishPrint = () => {
    fitSheetToPrintArea(printWindow.document);
    printWindow.focus();
    printWindow.print();
    printWindow.addEventListener("afterprint", () => printWindow.close(), { once: true });
  };

  /* The QR logo is an SVG <image>, which document.images leaves out, so it loads through a stand-in. */
  const svgImageStandIns = Array.from(printWindow.document.querySelectorAll("svg image"))
    .map((node) => node.getAttribute("href"))
    .filter(Boolean)
    .map((href) => {
      const standIn = printWindow.document.createElement("img");
      standIn.src = href;
      return standIn;
    });
  const images = [...Array.from(printWindow.document.images || []), ...svgImageStandIns];
  if (images.length === 0) {
    window.setTimeout(finishPrint, 150);
    return;
  }

  Promise.all(
    images.map((image) => (
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        })
    ))
  ).then(() => {
    window.setTimeout(finishPrint, 150);
  });
}

/* The Download PDF action: the sheet Print would send to the printer, saved as a file instead. */
export function downloadLeaveApplicationPdf(sheet, fileName) {
  return downloadFormSheetPdf(sheet, { fileName, printCss: LEAVE_FORM_PRINT_CSS });
}

/*
 * `applicant` is { signatureDataUrl, fallbackText }; `hrmo` (7.A), `chief` (7.B) and
 * `regionalDirector` are { signed, signatureDataUrl, fallbackText, name, caption }.
 */
export default function LeaveApplicationSheet({
  sheetRef,
  formData,
  leaveTypes = [],
  applicant = {},
  hrmo = {},
  chief = {},
  regionalDirector = {},
  qrPayload = "",
}) {
  return (
    <div ref={sheetRef} className="leave-form-paper" style={styles.wrap}>
      <div className="leave-print-header" style={styles.header}>
        <img src="/mgb.png" alt="MGB Logo" style={styles.logoImage} />
        <div>
          <p style={{ margin: "1px 0", fontSize: "10px" }}>Republic of the Philippines</p>
          <p style={{ margin: "1px 0", fontSize: "10px" }}>Department of Environment and Natural Resources</p>
          <h3 style={{ margin: "4px 0", fontSize: "12px", fontWeight: "bold" }}>
            MINES AND GEOSCIENCES BUREAU REGIONAL OFFICE NO. X
          </h3>
          <p style={{ margin: "1px 0", fontSize: "10px" }}>DENR-X Compound, Puntod, Cagayan de Oro City</p>
          <div className="leave-print-title" style={styles.formTitle}>APPLICATION FOR LEAVE</div>
        </div>
        <img src="/bagongpilipinas.png" alt="Bagong Pilipinas" style={styles.logoImage} />
      </div>

      <div style={styles.body}>
        <div className="leave-print-row" style={styles.row}>
          <div style={{ ...styles.cell, width: "33.33%" }}>
            <label style={styles.label}>1. Office/Department</label>
            <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.office} />
          </div>
          <div style={{ ...styles.cell, width: "66.66%", borderRight: "none" }}>
            <label style={styles.label}>2. Name</label>
            <div style={{ display: "flex", textAlign: "center" }}>
              {[
                ["lastName", "(Last)"],
                ["firstName", "(First)"],
                ["middleName", "(Middle)"],
              ].map(([field, label]) => (
                <div
                  key={field}
                  style={{
                    flex: 1,
                    paddingInline: "4px",
                  }}
                >
                  <span style={{ fontSize: "8px", fontStyle: "italic", display: "block" }}>{label}</span>
                  {/* An input does not inherit text-align, so each name is centred under its caption here. */}
                  <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, textAlign: "center" }} value={formData[field]} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="leave-print-row" style={styles.row}>
          <div style={{ ...styles.cell, width: "25%" }}>
            <label style={styles.label}>3. Date of Filing</label>
            <ReadOnlyInput type="date" style={inputWithoutUnderlineStyle} value={formData.dateOfFiling} />
          </div>
          <div style={{ ...styles.cell, width: "50%" }}>
            <label style={styles.label}>4. Position</label>
            <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.position} />
          </div>
          <div style={{ ...styles.cell, width: "25%", borderRight: "none" }}>
            <label style={styles.label}>5. Salary</label>
            <ReadOnlyInput style={inputWithoutUnderlineStyle} value={formData.salary} />
          </div>
        </div>

        <div className="leave-print-section" style={styles.sectionTitle}>6. DETAILS OF APPLICATION</div>
        <div className="leave-print-row" style={styles.row}>
          <div style={{ ...styles.cell, width: "50%" }}>
            <label style={styles.label}>6.A Type of Leave to be Availed of</label>
            {leaveTypes.map((type) => (
              <div key={type} className="leave-print-check" style={styles.checklistItem}>
                <SelectionIndicator checked={formData.leaveType === type} />
                <span>{type}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-end", marginTop: "5px", gap: "4px" }}>
              <span>Others:</span>
              <ReadOnlyInput
                style={{ ...styles.input, flex: 1 }}
                value={formData.leaveTypeOther}
              />
            </div>
          </div>

          <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
            <label style={styles.label}>6.B Details of Leave</label>

            <p className="leave-print-sublabel" style={styles.subLabel}>In case of Vacation/Special Privilege Leave:</p>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailVacationWithinChecked} />
              <span>Within the Philippines</span>
              <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailVacationWithinNote} />
            </div>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailVacationAbroadChecked} />
              <span>Abroad (Specify)</span>
              <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailVacationAbroadNote} />
            </div>

            <p className="leave-print-sublabel" style={styles.subLabel}>In case of Sick Leave:</p>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailSickHospitalChecked} />
              <span>In Hospital (Specify Illness)</span>
              <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailSickHospitalNote} />
            </div>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailSickOutpatientChecked} />
              <span>Out Patient (Specify Illness)</span>
              <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailSickOutpatientNote} />
            </div>

            <p className="leave-print-sublabel" style={styles.subLabel}>In case of Special Leave Benefits for Women:</p>
            <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
              <span style={{ whiteSpace: "nowrap" }}>(Specify Illness)</span>
              <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.leaveDetailWomen} />
            </div>

            <p className="leave-print-sublabel" style={styles.subLabel}>In case of Study Leave:</p>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailStudyMasters} />
              <span>Completion of Master's Degree</span>
            </div>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailStudyReview} />
              <span>BAR/Board Examination Review</span>
            </div>

            <p className="leave-print-sublabel" style={styles.subLabel}>Other purpose:</p>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailOtherMonetization} />
              <span>Monetization of Leave Credits</span>
            </div>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.leaveDetailOtherTerminal} />
              <span>Terminal Leave</span>
            </div>
            {/* A monetization filing states what the credits are for; a leave request has no such line. */}
            {formData.otherPurposeNote !== undefined ? (
              <div style={{ display: "flex", alignItems: "flex-end", marginTop: "5px", gap: "4px" }}>
                <span style={{ whiteSpace: "nowrap" }}>Purpose:</span>
                <ReadOnlyInput style={{ ...styles.input, flex: 1 }} value={formData.otherPurposeNote} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="leave-print-row" style={styles.row}>
          <div style={{ ...styles.cell, width: "50%" }}>
            <label style={styles.label}>6.C Number of Working Days Applied For</label>
            <ReadOnlyInput
              style={{ ...styles.input, margin: "10px 0", display: "block" }}
              value={formData.numberOfDays}
            />
            <label style={styles.label}>Inclusive Dates</label>
            <div style={{ margin: "8px 0 6px" }}>
              <div
                style={{
                  ...styles.input,
                  minHeight: "22px",
                  padding: "2px 0 4px",
                  display: "block",
                  textTransform: "none",
                }}
              >
                {formData.inclusiveDateRange}
              </div>
            </div>
          </div>
          <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
            <label style={styles.label}>6.D Commutation</label>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.commutation === "not_requested"} />
              Not Requested
            </div>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.commutation === "requested"} />
              Requested
            </div>
            <SignatureBlock
              signatureDataUrl={applicant.signatureDataUrl}
              fallbackText={applicant.fallbackText}
              name={formData.applicantName}
              caption="(Signature of Applicant)"
            />
          </div>
        </div>

        <div className="leave-print-section" style={styles.sectionTitle}>7. DETAILS OF ACTION ON APPLICATION</div>
        <div className="leave-print-row" style={styles.row}>
          <div style={{ ...styles.cell, width: "50%" }}>
            <label style={styles.label}>7.A Certification of Leave Credits</label>
            <p style={{ textAlign: "center", fontSize: "10px" }}>
              As of <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, width: "80px", display: "inline" }} value={formData.creditsAsOf} />
            </p>
            <table style={styles.creditsTable}>
              <thead>
                <tr>
                  <th style={tdStyle}></th>
                  <th style={tdStyle}>Vacation Leave</th>
                  <th style={tdStyle}>Sick Leave</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Total Earned", "vlEarned", "slEarned"],
                  ["Less this App.", "vlLess", "slLess"],
                  ["Balance", "vlBalance", "slBalance"],
                ].map(([label, vl, sl]) => (
                  <tr key={label}>
                    <td style={tdStyle}>{label}</td>
                    <td style={tdStyle}>
                      <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, textAlign: "center" }} value={formData[vl]} />
                    </td>
                    <td style={tdStyle}>
                      <ReadOnlyInput style={{ ...inputWithoutUnderlineStyle, textAlign: "center" }} value={formData[sl]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <SignatoryLine signatory={hrmo} />
          </div>

          {/* A column so the Chief's signature sits at the bottom, level with the HR Head's in 7.A. */}
          <div style={{ ...styles.cell, width: "50%", borderRight: "none", display: "flex", flexDirection: "column" }}>
            <label style={styles.label}>7.B Recommendation</label>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.recommendation === "approved"} />
              For approval
            </div>
            <div className="leave-print-check" style={styles.checklistItem}>
              <SelectionIndicator checked={formData.recommendation === "disapproved"} />
              For disapproval due to:
            </div>
            <ReadOnlyInput
              style={{ ...inputWithoutUnderlineStyle, display: "block", marginTop: "10px", height: "40px" }}
              value={formData.disapprovalReason}
            />
            <div style={{ marginTop: "auto" }}>
              <SignatoryLine signatory={chief} />
            </div>
          </div>
        </div>

        {/* 7.C and 7.D share one open box with the QR footer, as on the printed CSC form. */}
        <div className="leave-print-row" style={{ ...styles.row, borderBottom: "none" }}>
          <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
            <label style={styles.label}>7.C Approved For:</label>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
              <ReadOnlyInput style={{ ...styles.input, width: "40px" }} value={formData.approvedDaysPay} />
              <span>days with pay</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
              <ReadOnlyInput style={{ ...styles.input, width: "40px" }} value={formData.approvedDaysNoPay} />
              <span>days without pay</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 0" }}>
              {/* A day count fits the short blank; a monetization's amount takes the width it needs. */}
              <ReadOnlyInput
                style={formData.approvedOthers ? { ...styles.input, flex: 1 } : { ...styles.input, width: "40px" }}
                value={formData.approvedOthers}
              />
              <span style={{ whiteSpace: "nowrap" }}>others (Specify)</span>
            </div>
          </div>
          <div style={{ ...styles.cell, width: "50%", borderRight: "none" }}>
            <label style={styles.label}>7.D Disapproved Due To:</label>
            <ReadOnlyInput
              style={{ ...inputWithoutUnderlineStyle, display: "block", height: "20px" }}
              value={formData.disapprovedReason}
            />
          </div>
        </div>

        {/*
         * The Regional Director signs centred under both 7.C and 7.D, as on the printed CSC form,
         * with the QR raised beside the signature rather than in a band of its own below it.
         */}
        <div className="leave-print-qr" style={styles.qrFooter}>
          <div style={{ gridColumn: 2 }}>
            <SignatoryLine signatory={{ ...regionalDirector, caption: "OIC, Regional Director" }} />
          </div>
          {/* The record's reference stays inside the QR payload; only the printed caption was replaced. */}
          <div style={styles.qrColumn}>
            <FormQrCode
              value={qrPayload}
              size={118}
              align="right"
              caption=""
              logoSrc="/MGB-Logo-remove-background.png"
              logoAspectRatio={204 / 189}
            />
            <div style={styles.qrFooterNote}>
              This is an official Leave Form approved digitally and generated from the MGB-X Online
              Leave Form.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
