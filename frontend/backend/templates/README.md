The PDS export uses `Personal-Data-Sheet-CS-Form-No.-212-Revised-2026.xlsx`.

CSC revision and filling guide:
https://csc.gov.ph/downloads/category/566-mc-no-05-2026

Workbook mirror published by DOST-PCAARRD (downloaded 14 October 2026):
https://www.pcaarrd.dost.gov.ph/index.php/job-vacancies/pds-files/4939-annex-h1-cs-form-no-212-revised-2025-personal-data-sheet

The mirror URL still contains 2025, but the workbook is labeled Revised 2026 and
includes the restored monthly salary and grade/step columns and seven continuation
sheets. Reuse its original Open XML package so Excel controls, drawings and form
geometry survive employee-data exports. The export sets legal-size paper, fits
each form sheet to one page, opens in Normal view at 100% so the form is continuous,
fits entered text to its fields, hides unused continuation tabs and helper data,
and leaves a white worksheet canvas beside the form. Values remain editable in Excel. Use Print Preview for the
legal-size page preview; Page Layout editing view can visually split wide forms.

`api/pds-xlsx.php` maps the saved profile to this workbook. C2 has 24 work rows;
the remaining records from the existing 28-record download go into C6. PDF export
includes the four main pages and any populated continuation pages.

The profile page saves Civil Service Eligibility and Learning & Development
entries to employee-specific tables, initialized automatically by the PDS API.
Eligibility fills seven rows on C2 and up to 24 more on C9; training fills 17 rows
on C3 and up to 44 more on C5. Both Excel and PDF use the same saved records.

Regression checks:

- Run `php backend/tests/pds-xlsx-test.php <temporary-output-directory>` from
  `frontend` to validate and generate synthetic export fixtures.
- Run `php backend/tests/pds-profile-records-test.php` to check record validation.
  Add `--database <temporary-output-directory>` to verify MySQL save/reload and
  generate the eligibility/training fixture in a disposable local test database.
  Optional `PDS_TEST_MYSQL_DSN`, `PDS_TEST_MYSQL_USER`, and
  `PDS_TEST_MYSQL_PASSWORD` configure that database connection.
- On Windows with Microsoft Excel installed, run
  `backend/tests/pds-excel-layout-test.ps1 -FixtureDirectory <same-directory>`.
  This opens both fixtures in Excel itself and verifies native checkbox states,
  legal-size page settings, visible sheets and saved employee values.
