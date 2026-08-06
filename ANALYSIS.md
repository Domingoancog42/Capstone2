# MGB Region X HRIS — Complete System Analysis

**Project:** Human Resource Information System — Mines and Geosciences Bureau, Region X (Philippines)
**Analysis date:** 2026-08-05
**Branch analysed:** `main1.0`
**Scope:** 419 files (excluding `node_modules/` and `.git/`), 55 live database tables

**Method:** full filesystem walk; Node-based import-graph resolution across all 191 frontend source files; `php -l` over all 59 backend files (59/59 pass); live MariaDB introspection via `information_schema`; table-to-file cross-reference by SQL-context grep.

**Grouping note:** every file in the project is documented. Where a group is genuinely homogeneous — PHPMailer's 60 translation files, 21 uploaded binaries, 8 backup dumps — the group is documented once and its members named, rather than repeating an identical description. Everything carrying distinct logic is documented individually.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Folder Structure](#2-folder-structure)
3. [Backend Analysis](#3-backend-analysis)
4. [Frontend Analysis](#4-frontend-analysis)
5. [Database Analysis](#5-database-analysis)
6. [RBAC Analysis](#6-rbac-analysis)
7. [System Flow](#7-system-flow)
8. [Dependency Analysis](#8-dependency-analysis)
9. [Optimization Suggestions](#9-optimization-suggestions)
10. [Final Report](#10-final-report)

---

## 1. Architecture Overview

```
Browser — React 19 SPA (Create React App)
    │   axios, withCredentials: true, X-CSRF-Token header
    ▼
Apache :80  ──►  /Capstone2/frontend/backend/api/*.php
    │            59 single-file endpoints, no framework
    │            each: require connection-pdo.php → CORS → session → CSRF → PDO
    ▼
MariaDB 10.4 `hris` — 55 tables, PDO prepared statements, ERRMODE_EXCEPTION
```

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 19.2, Tailwind CSS 3.4, CRA 5.0.1 — no TypeScript, no router library |
| Backend | PHP 8 with `declare(strict_types=1)` on every file |
| Database | MariaDB 10.4 (XAMPP), InnoDB, `utf8mb4` |
| Mail | PHPMailer 6.x, vendored by hand (not Composer-installed) |
| Session | PHP native, cookie `HRISSESSID`, `httponly` + `samesite=Lax` |
| Charts | Recharts (+ FullCalendar for the leave/travel widget) |

### Key architectural decisions

All of the following are deliberate and documented in-source.

| Decision | Location | Rationale |
|---|---|---|
| No React Router | `src/App.jsx` L60–83 | Hand-rolled `history.pushState` + `popstate`; the role prefix in the URL decides access |
| Host-relative API base URL | `frontend/.env.production` | One build works on localhost, a LAN address, and a forwarded port with no rebuild; puts the API on the same origin as the page, sidestepping CORS entirely |
| Long-polled change feed | `backend/api/changes.php` | Cross-machine live refresh. Releases the PHP session lock before parking, bounds the hold, and elects a leader tab client-side so a browser holds one connection, not one per tab |
| Self-healing schema | `ensure_*()` in ~20 endpoints | `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` on first request instead of a migration runner |
| Layered `.htaccess` | 7 files | The project sits inside `htdocs`, so every file is a URL whether or not anything links to it. Each directory denies what it must |
| Session user re-read per request | `connection-pdo.php` L394 | A revoked role or archived account takes effect on the next request, not at next login |

---

## 2. Folder Structure

```
Capstone2/
├── .htaccess                       Blocks src/ and node_modules/ over HTTP; denies .env, package.json
├── .gitignore                      Secrets, DB dumps, uploads, vendor, build output
├── ANALYSIS.md                     This document
├── .agents/                        EMPTY
└── frontend/
    ├── .env.development            npm start config (relies on package.json "proxy")
    ├── .env.production             npm run build config
    ├── .env.example                Template + extensive explanation of every name
    ├── package.json                41 dependencies; "proxy": "http://localhost"
    ├── package-lock.json           Exact dependency inventory (742 KB)
    ├── tailwind.config.js          darkMode:"class"; gov.navy/gold/gray brand palette
    ├── postcss.config.js           tailwindcss + autoprefixer
    ├── README.md                   (deleted from working tree — see §10)
    ├── docs/                       EMPTY
    ├── public/                     16 files — index.html, PH address JSON, logos, CSV template
    ├── build/                      Compiled bundle (gitignored) — main.js 3.37 MB
    ├── vendor/                     ORPHANED Composer autoloader — see §8.2
    │
    ├── src/
    │   ├── index.jsx               Entry: theme init → createRoot → <App/>
    │   ├── App.jsx                 Session hydration, routing, idle timeout, live updates, Toaster
    │   ├── tailwind.css            1,536 lines — directives, brand tokens, base + utilities layers
    │   ├── mobile.css              Structural mobile layer; every rule inside a max-width query
    │   │
    │   ├── components/             24 subfolders
    │   │   ├── UI/                 8 design-system primitives
    │   │   ├── UI_Login/           Login, forgot password, 2FA + 5 auth primitives
    │   │   ├── analytics/          9 dashboard analytic cards
    │   │   ├── auth/               AccessDenied, PasswordExpiryModal
    │   │   ├── auto/               Auto-refresh config + hook
    │   │   ├── breadcrumbs/        Breadcrumb trail
    │   │   ├── bubble_chat/        Floating chat widget
    │   │   ├── calendar/           Calendar board (DEAD — see §8.2)
    │   │   ├── chart/              4 chart wrappers (3 DEAD)
    │   │   ├── darkmode/           Theme toggle + applyTheme/initializeTheme
    │   │   ├── dashboard/          6 dashboard overview components
    │   │   ├── employee/           Employee card, service counter
    │   │   ├── layout/             WorkspaceShell, RoleWorkspacePage, module definitions, Footer
    │   │   ├── leave/              9 leave-specific components
    │   │   ├── navigation/         Sidebar, Header, DashCalendarWidget (+ its CSS Module)
    │   │   ├── notification/       NotificationBell, NotificationCenter
    │   │   ├── payroll/            LeaveMonetizationForm
    │   │   ├── profile/            ProfilePage + 8 cards + sections/ (11 sections)
    │   │   └── settings/           Settings primitives + barrel + notice hook
    │   │
    │   ├── module/                 16 business domains
    │   │   ├── attendance/  calendar/  compensatory/  employee/  leave/
    │   │   ├── Loan/  overtime/  passslip/  payroll/  performance/
    │   │   └── reports/  rewards/  serviceRecord/  travel/
    │   │
    │   ├── page/                   7 subfolders — one per role, plus settings
    │   │   ├── Admin/  Chief/  Employee/  HRHead/  HRStaff/  Regionaldirector/
    │   │   ├── settings/           8 settings screens
    │   │   └── rewards/            EMPTY
    │   │
    │   ├── services/               18 API-client modules
    │   ├── hooks/                  3 files — ALL DEAD
    │   ├── utils/                  11 pure helpers
    │   ├── data/                   leaveTypes.js — static constants
    │   └── PHPMailer-master/       Vendored library, 65 PHP files
    │
    └── backend/
        ├── api/                    59 PHP files — 46 endpoints, 12 includes, 1 dev script
        ├── database/               hris.sql (5 MB, gitignored, htaccess-denied)
        ├── backups/                8 dumps, 18 MB (gitignored, htaccess-denied)
        └── uploads/                3 subdirs, 21 files (htaccess: no exec, no listing)
            ├── profile-images/     11 PNGs
            ├── leave-attachments/  1 PDF, 1 JPG, .gitkeep
            └── ipcr-verifications/ 3 PNG/JPG, 1 DOCX, 1 JPEG
```

### File census

| Category | Count |
|---|---|
| Frontend `.jsx` | 145 |
| Frontend `.js` (excl. PHPMailer) | 43 |
| Frontend `.css` | 3 |
| Backend API `.php` | 59 |
| PHPMailer `.php` | 65 |
| Orphaned vendor `.php` | 10 |
| Public assets | 16 |
| Uploaded files | 21 |
| Backup dumps | 8 |
| `.htaccess` files | 7 |

---

## 3. Backend Analysis

### 3.1 Core and shared includes (12 files)

None of these are ever requested over HTTP; all are denied in `backend/api/.htaccess`.

#### `connection-pdo.php` — 944 lines

The kernel. Required first by every other file.

- **Purpose:** CORS, session bootstrap, PDO connection, CSRF enforcement, session-user resolution, RBAC helpers, notification fan-out.
- **Key functions:** `hris_configure_cors`, `json_response`, `read_json_body`, `require_method`, `hris_csrf_token`, `hris_verify_csrf_token`, `session_user`, `hris_destroy_session`, `hris_find_employee_for_user`, `hris_enrich_user_with_employee`, `session_user_record`, `refresh_session_user`, `require_session_user`, `hris_normalize_role`, `hris_user_role_key`, `hris_session_employee_record_id`, `hris_can_manage_employee_records`, `hris_require_employee_record_access`, `format_user`, `write_auth_audit`, `hris_database_table_exists`, `hris_ensure_payroll_meta_table`, `hris_ensure_notifications_table`, `hris_notify_users`, `hris_notify_roles`, `hris_notify_employee`
- **Tables:** users, roles, status, employees, divisions, designations, notifications, audit_logs, settings, payroll, payrollmeta
- **Depends on:** `smtp-config.php`, `app_settings.php`
- **Used by:** every endpoint
- **Status:** required — the single most critical file in the backend

#### `app_settings.php` — 1,518 lines

Settings key/value store **and the entire permission engine**.

- **Key functions:** `hris_permission_items`, `hris_default_role_permission_access`, `hris_builtin_permission_roles`, `hris_custom_permission_roles`, `hris_permission_templates`, `hris_store_permission_templates`, `hris_permissions_for_role_key`, `hris_permissions_for_user`, `hris_user_permission_overrides`, `hris_sync_user_permission_override`, `hris_security_settings`, `hris_two_factor_settings`, `hris_password_has_expired`, `hris_password_validity_days`, plus ~10 `hris_ensure_*` runtime migrations
- **Tables:** settings, roles, audit_logs, users, employees, payroll
- **Used by:** connection-pdo, settings, email-domain-policy, public_settings, login, password_expiry_check
- **Status:** required

#### Remaining includes

| File | Purpose | Key functions | Tables |
|---|---|---|---|
| `audit_logs_helper.php` | Audit context capture, geo-IP lookup, paginated queries | `hris_client_ip_address`, `hris_audit_location_from_ip`, `hris_audit_browser_from_user_agent`, `hris_audit_os_from_user_agent`, `hris_audit_device_from_user_agent`, `hris_audit_request_context`, `hris_paginated_audit_logs` | audit_logs, users, employees |
| `password-reset-utils.php` (826 L) | PHPMailer wiring and **all transactional email bodies** | `hris_configured_mailer`, `send_password_reset_email`, `send_leave_request_rejection_email`, `send_travel_order_rejection_email`, `send_compensatory_rejection_email`, `send_employee_account_activation_email`, `consume_password_reset_code` | session store only |
| `two-factor-utils.php` | OTP lifecycle, lockout, admin alerts | `hris_two_factor_issue_code`, `hris_two_factor_store_code`, `hris_two_factor_record_failed_attempt`, `hris_two_factor_lock_account`, `hris_two_factor_notify_admins_of_login`, `hris_two_factor_mask_email` | users, roles, status, audit_logs |
| `hris-mail.php` | HTML email component library | `hris_mail_document`, `hris_mail_code_block`, `hris_mail_status_block`, `hris_mail_button_block`, +16 more | none |
| `leave-credit-utils.php` | Leave credit accrual, usage recalculation, audit | `ensure_employee_default_leave_credits`, `recalculate_employee_leave_credit_usage`, `fetch_employee_leave_credit_snapshot`, `validate_leave_credit_approval`, `upsert_employee_leave_credit_balance` | leave_credits, leave_types, employees, divisions, designations |
| `deduction-catalog.php` | Unifies 5 deduction family tables behind one UNION; syncs payroll columns | `deduction_catalog_union_sql`, `deduction_catalog_compute`, `deduction_catalog_compute_tiered`, `deduction_catalog_sync_payroll_columns`, `deduction_catalog_table_for_id` | gsis_/phic_/pagibig_/withholding_tax_/other_/attendance_deductions, payroll, payrolldeduction |
| `email-domain-policy.php` | Allow/deny-list for login email domains | `hris_email_domain_policy`, `hris_email_domain_policy_violation`, `hris_email_domain_matches` | settings |
| `smtp-config.php` | Constants; resolves creds from local file → env → empty | — | none |
| `smtp-credentials.example.php` | Committed template | — | none |
| `smtp-credentials.local.php` | **Live Gmail app password.** Correctly gitignored, untracked, htaccess-denied | — | none |

### 3.2 Authentication and session endpoints (10)

| File | Method | Auth | Purpose |
|---|---|---|---|
| `login.php` (323 L) | POST | public | Eight sequential gates: lockout window → `password_verify` → `is_archived` → status=Active → email-domain policy → password expiry → 2FA branch → `session_regenerate_id(true)` |
| `logout.php` | POST | optional | Audit write, clear `$_SESSION`, expire cookie, `session_destroy()` |
| `session.php` | GET | required | Returns the refreshed session user |
| `csrf.php` | GET | public | Issues a CSRF token |
| `public_settings.php` | GET | public | Captcha flag, max password length, session timeout — the values the login screen needs before a session exists |
| `two_factor_verify.php` | POST | pending-2FA | Validates the OTP, promotes the pending login to a real session |
| `two_factor_resend.php` | POST | pending-2FA | Re-issues an OTP |
| `two_factor_profile.php` | GET/POST | required | Per-user 2FA enable/disable |
| `forgot_password.php` | POST | public | Issues an emailed reset code |
| `reset_password.php` | POST | public | Consumes the code, sets the new password |
| `force_change_password.php` | POST | required | Handles the `must_change_password` flag |

### 3.3 Business endpoints (35)

| File | Lines | Purpose | Primary tables |
|---|---|---|---|
| `payroll.php` | 3,393 | Payroll generation, deduction engine, withholding-tax brackets, approval workflow (Draft → Pending Approval → Approved → Paid → Archived), bulk transitions | payroll, payrollmeta, payrolldeduction, payrollapproval, allowance, employeededuction, 6 deduction tables, attendance_daily_records, holidays, leave_requests, overtime, pass_slip, loan_requests, cash_advance_requests |
| `reports.php` | 3,025 | Report catalog, KPIs, charts, **hand-written CSV / XLSX / PDF writers** | ~15 tables read-only, plus audit_logs |
| `employee.php` | 2,189 | Employee CRUD, CSV import, auto-provisions the linked `users` row and sends the activation email | employees, users, roles, status, divisions, designations, service_records |
| `attendance.php` | 1,779 | CSV punch import, daily rollup, DTR, adjustment requests | attendance_logs, attendance_daily_records, attendance_adjustments, holidays, leave_requests, overtime |
| `deduction.php` | 1,346 | Deduction type/category CRUD, payroll recalculation | payroll, payrolldeduction, allowance, employeededuction |
| `settings.php` | 1,302 | Divisions, designations, leave types, permission matrix, locked accounts, system config | divisions, designations, leave_types, settings, users, roles |
| `leave_request.php` | 1,133 | Leave filing, attachments, two-level approval, rejection email | leave_requests, leave_approvals, leave_attachments, leave_credits, leave_types |
| `loan_request.php` | 1,051 | Loan filing, document upload, audit trail | loan_requests, loan_request_audit_trail |
| `rewards.php` | 1,004 | Award cycles, one-vote-per-user ballots, certificate issuance with sequence numbers | reward_cycles, reward_cycle_votes, reward_certificates, reward_certificate_sequence |
| `leave_monetization.php` | 959 | Monetization requests, daily-rate calculation, credit deduction | leave_monetization_requests, leave_credits, leave_types |
| `payslip.php` | ~800 | Payslip rendering, bulk ZIP download | payroll, payrollmeta, allowance, deduction tables |
| `email_verification.php` | ~750 | Email change with OTP confirmation | users, employees, status |
| `opcr.php` | ~700 | Office performance review templates and assignments | opcr_templates, division_opcr_assignments |
| `ipcr.php` | ~690 | Individual performance review, ratings (Q1/E2/T3/A4), verification uploads | ipcr, ipcr_templates, ipcr_verification_files |
| `compensatory.php` | ~650 | CTO requests and review chain | compensatory |
| `leave_credit.php` | ~620 | Balance management, bulk add, reset, history | leave_credits, leave_types |
| `analytics.php` | ~620 | Dashboard distributions — role, gender, PWD, age, department, attendance trend | employees, users, roles, divisions, leave_*, attendance_daily_records |
| `backup.php` | ~580 | **Hand-written mysqldump in PHP**, schedule, history, authenticated streaming | backup_history, settings, all tables |
| `service_record.php` | ~570 | Government service record with LWOP calculation | service_records, employees, leave_requests |
| `travel_order.php` | ~570 | Travel orders and rejection email | travel_orders |
| `overtime.php` | ~530 | Overtime filing and approval | overtime |
| `password_change.php` | ~490 | In-app password change with emailed confirmation code | users |
| `user.php` | ~470 | User account CRUD, role assignment, per-user permission overrides | users, roles, status, employees |
| `cash_advance.php` | ~450 | Cash advance requests | cash_advance_requests |
| `changes.php` | ~370 | Long-polled change feed, 22 topics | 30+ tables (fingerprint only) |
| `pass_slip.php` | ~350 | Pass slips | pass_slip |
| `access_request.php` | ~340 | "Request access" from the Access Denied screen; grants module permission | module_access_requests, users, roles, employees |
| `roles.php` | ~330 | Custom role CRUD with `base_role` inheritance | roles, users |
| `chat.php` | ~280 | Internal messaging contacts and threads | messages, users, employees |
| `notifications.php` | ~260 | List, mark-read, delete notifications | notifications |
| `employee_profile_image.php` | ~200 | Profile photo upload | employees |
| `permissions.php` | ~180 | Permission read/apply for a user | users, roles |
| `employee_signature.php` | ~160 | E-signature stored base64 in `employees.e_signature` | employees |
| `password_expiry_check.php` | 90 | **BROKEN** — see §8.1 | users |
| `audit_logs.php` | 34 | Admin-only paginated audit log | audit_logs |
| `test_password_expiry.php` | 130 | Dev-only scenario simulator; htaccess-denied | none |

### 3.4 Middleware, session handling and authorization

There is no framework middleware. The chain is **include-order-as-middleware**, executed the moment `connection-pdo.php` is required:

```
 1. hris_configure_cors()        localhost-only origin allowlist, credentials: true
 2. OPTIONS → 204 exit
 3. session_name('HRISSESSID'), httponly, samesite=Lax, session_start()
 4. PDO connect                  127.0.0.1, root, EMPTY PASSWORD,
                                 ERRMODE_EXCEPTION, EMULATE_PREPARES=false
 5. require app_settings.php
 6. hris_verify_csrf_token()     GET/HEAD/OPTIONS issue a token;
                                 all others hash_equals or 419
    ─────────── endpoint body begins ───────────
 7. require_method('POST')       → 405
 8. require_session_user()       → 401; idle-timeout check;
                                 re-reads the user from the DB every request
 9. role gate                    hris_user_role_key() + *_can_manage() → 403
10. record-level gate            hris_require_employee_record_access() → 403
```

Step 8 is unusually strong for a project of this size: because the session user is re-read from the database on every request, a revoked role or an archived account takes effect immediately rather than at next login.

**Authentication coverage — verified per file:**

- Session required (38 files): access_request, analytics, attendance, audit_logs, backup, cash_advance, changes, chat, compensatory, deduction, email_verification, employee, employee_profile_image, employee_signature, force_change_password, ipcr, leave_credit, leave_monetization, leave_request, loan_request, notifications, opcr, overtime, pass_slip, password_change, payroll, payslip, permissions, reports, rewards, roles, service_record, session, settings, travel_order, two_factor_profile, user, connection-pdo
- Intentionally public (10): csrf, login, logout, public_settings, forgot_password, reset_password, two_factor_verify, two_factor_resend, password_expiry_check, test_password_expiry
- Includes, never served (11): app_settings, audit_logs_helper, deduction-catalog, email-domain-policy, hris-mail, leave-credit-utils, password-reset-utils, two-factor-utils, smtp-config, smtp-credentials.example, smtp-credentials.local

No endpoint is missing an auth gate that should have one.

### 3.5 PHPMailer (65 files)

`frontend/src/PHPMailer-master/` — a vendored copy of PHPMailer 6.x, not installed by Composer.

- **Actually loaded:** `src/Exception.php`, `src/PHPMailer.php`, `src/SMTP.php` — required directly by `password-reset-utils.php` via a relative path. Because PHP reads these from disk, the root `.htaccess` rule blocking `frontend/src` over HTTP does not affect outgoing mail.
- **Present but never loaded:** `src/POP3.php`, `src/OAuth.php`, `src/OAuthTokenProvider.php`, `src/DSNConfigurator.php`, `get_oauth_token.php`, and all **60** `language/phpmailer.lang-*.php` files (only the English defaults are used).
- **Documentation:** `README.md`, `SECURITY.md`, `SMTPUTF8.md`, `COMMITMENT`, `LICENSE`, `VERSION`, `composer.json`.
- **Status:** required. Keep the directory intact — trimming a vendored library invites breakage on upgrade, and it is already unreachable over HTTP.

### 3.6 File uploads

| Handler | Destination | Allowed extensions | Size cap |
|---|---|---|---|
| `employee_profile_image.php` | `uploads/profile-images/` | png jpg jpeg gif webp bmp | 5 MB |
| `leave_request.php` | `uploads/leave-attachments/` | pdf png jpg jpeg gif webp bmp | 10 MB |
| `loan_request.php` | `uploads/` | + doc docx | 10 MB |
| `ipcr.php` | `uploads/ipcr-verifications/` | pdf png jpg jpeg doc docx xls xlsx | **none** |
| `opcr.php` | `uploads/` | same | **none** |

All five generate stored filenames containing `bin2hex(random_bytes(8))`, so an individual file URL is not guessable. Validation is **extension-only** — no content sniffing — mitigated by the execution ban in `uploads/.htaccess`. The missing size caps on IPCR/OPCR are confirmed by a 6.4 MB PNG sitting in `uploads/ipcr-verifications/`.

---

## 4. Frontend Analysis

### 4.1 HTML and assets

| File | Size | Status |
|---|---|---|
| `public/index.html` | 1.8 KB | Required — CRA template, `%PUBLIC_URL%/mgb.png` as icon |
| `public/manifest.json` | 376 B | Required — PWA manifest, declares `mgb.png` at both 192 and 512 |
| `public/robots.txt` | 70 B | Required (trivial) |
| `public/mgb.png` | 86 KB | Used — 16 references, favicon, manifest |
| `public/bagongpilipinas.png` | 700 KB | Used — 7 references (auth screens) |
| `public/background.png` | **6.4 MB** | Used — 2 references (login background). Grossly oversized |
| `public/favicon.ico` | 3.9 KB | **UNUSED** — CRA leftover; `index.html` points at `mgb.png` |
| `public/logo192.png` | 5.3 KB | **UNUSED** — manifest points at `mgb.png` |
| `public/logo512.png` | 9.7 KB | **UNUSED** — same |
| `public/philippines-addresses/barangay.json` | **4.7 MB** | Used — fetched eagerly on profile mount |
| `public/philippines-addresses/city.json` | 187 KB | Used |
| `public/philippines-addresses/province.json` | 8.7 KB | Used |
| `public/philippines-addresses/region.json` | 2.3 KB | Used |
| `public/philippines-addresses/zipcodes.json` | 47 KB | **UNUSED** — never fetched |
| `public/templates/dummy-employees-300.csv` | 115 KB | Used — employee CSV import template |

All four address JSON files are fetched together in `ProfilePage.jsx` L283 via `Promise.all`, on every profile mount.

### 4.2 CSS (3 files — no duplication found)

| File | Lines | Purpose |
|---|---|---|
| `src/tailwind.css` | 1,536 | `@tailwind` directives, `:root` brand tokens (`--brand: #D61E1E`), `@layer base`, `@layer utilities`. Required |
| `src/mobile.css` | ~300 | Mobile layer — every rule inside a `max-width` query, deliberately structural rather than per-screen. Must load *after* `tailwind.css`; source order is what makes it win at equal specificity. Required |
| `src/components/navigation/DashCalendarWidget.module.css` | 2.5 KB | The only CSS Module in the project. Required |

No duplicated CSS was found. The project has no third-party stylesheet other than `sweetalert2.min.css`, imported in two places.

### 4.3 Layout, sidebar and header

| File | Purpose | Status |
|---|---|---|
| `components/layout/WorkspaceShell.jsx` | Sidebar + Header + breadcrumbs + content frame | Required |
| `components/layout/RoleWorkspacePage.jsx` | The generic role dashboard: maps nav key → module component, computes breadcrumbs, renders `AccessDeniedInline` on permission failure | Required — used by all 5 non-admin roles |
| `components/layout/selfServiceModules.jsx` | Shared self-service module definitions (my leave, my payslip, my IPCR) | Required |
| `components/layout/performanceRewardsModules.jsx` | Shared OPCR/IPCR/rewards module definitions | Required — HR Head + HR Staff |
| `components/layout/Footer.jsx` | Footer | Required |
| `components/navigation/Sidebar.jsx` (35 KB) | Nav tree, collapsible groups, **live pending-count badges** — polls 7 services | Required |
| `components/navigation/Header.jsx` (26 KB) | Avatar, profile menu, notification bell mount, password-expiry banner | Required |
| `components/navigation/DashCalendarWidget.jsx` | Mini calendar | Required |
| `components/breadcrumbs/breadcrumbs.jsx` | Breadcrumb trail | Required |

**Sidebar permission loading.** `RoleWorkspacePage` passes the **unfiltered** navigation list to `Sidebar` on purpose: a revoked module stays visible and answers with Access Denied plus a "Request Access" button, rather than silently vanishing. The filtered list from `filterNavigationItemsByPermissions()` is used only to choose a safe landing route and the "Go Back" target.

### 4.4 Forms and modals

| Component | Purpose | Status |
|---|---|---|
| `components/UI/modal.jsx` | Generic modal shell | Required — 24 consumers |
| `components/leave/LeaveForm.jsx` (1,276 L) | Leave filing form | Required |
| `components/leave/LeaveRequestModal.jsx` | Leave request modal | Required |
| `components/leave/LeaveReviewModal.jsx` | Approver review modal | Required |
| `components/leave/LeaveModal.jsx` | One-line re-export of `LeaveRequestModal` | **DEAD** |
| `components/payroll/LeaveMonetizationForm.jsx` (1,136 L) | Monetization form | Required |
| `components/profile/ProfileImageModal.jsx` | Photo crop and upload | Required |
| `components/auth/PasswordExpiryModal.jsx` | Expiry warning modal | Required — but never fires, see §8.1 |
| `components/UI/{InputField, button, card, table, Pagination, ActionIconButton, NotificationBadge}.jsx` | Design-system primitives | All required, 14–24 consumers each |
| `components/UI_Login/ui/{AuthCard, AuthField, AuthButton, AuthAlert, authTheme}` | Auth-screen primitives | Required |

### 4.5 AJAX layer (18 services)

Every request goes through the single axios instance in `services/api.js` (`withCredentials`, 20-second timeout). Two interceptors:

- **Request:** lazily fetches `/csrf.php` and attaches `X-CSRF-Token` on POST/PUT/PATCH/DELETE; adds UA client-hint headers.
- **Response:** harvests rotated CSRF tokens from any payload; publishes an auto-refresh topic derived from the request URL; on 401 (except auth-exempt endpoints) dispatches `hris:auth-session-expired`, which `App.jsx` turns into a global logout.

`api.js` (27.9 KB) holds 90 exported functions. The 17 domain services (`leaveService`, `payrollService`, `notificationService`, …) are thin wrappers over the same instance. `liveUpdatesService.js` runs the long-poll with leader-tab election; `autorefreshconfig.js` and `autorefreshdatalist.jsx` provide the `useAutoRefreshOnChange` hook and the BroadcastChannel relay that keeps sibling tabs in sync.

**Endpoint call distribution** (references across all services): settings 17, payroll 14, rewards 10, reports 8, loan_request 8, ipcr 8, employee 8, notifications 7, leave_credit 7, attendance 7, leave_request 6, email_verification 6, backup 6, and 33 more.

### 4.6 Pages

| Role | File | Lines |
|---|---|---|
| Admin | `page/Admin/AdminDashboard.jsx` | 2,948 |
| Admin | `page/Admin/create_employee.jsx` | ~900 |
| HR Head | `page/HRHead/Hrheaddashboard.jsx` | 1,011 |
| HR Staff | `page/HRStaff/Hrstaffdashboard.jsx` | 652 |
| Regional Director | `page/Regionaldirector/RegionalDashboard.jsx` | 382 |
| Chief | `page/Chief/chiefdashboard.jsx` | 279 |
| Chief | `page/Chief/teamoverview.jsx` | ~200 |
| Employee | `page/Employee/employeedashboard.jsx` | 266 |

**Settings pages** (`page/settings/`). All 8 are reachable, but the hub is misleadingly named: **`division.jsx` (3,333 lines) is the entire Settings workspace**, not a division editor. It imports and renders `auditlogs.jsx`, `deductions.jsx`, `email_domain_policy.jsx`, `math_captcha.jsx`, `permission.jsx`, `roles.jsx` and `twofactorauthentication.jsx` as tabs. Only `division.jsx` and `permission.jsx` are imported by `AdminDashboard.jsx` directly.

### 4.7 Business modules

16 domains under `src/module/`: attendance, calendar, compensatory, employee, leave, Loan, overtime, passslip, payroll, performance, reports, rewards, serviceRecord, travel. All are reachable from a dashboard except the leave sub-components listed in §8.2.

---

## 5. Database Analysis

**55 live tables.** The committed dump `hris.sql` contains 51; 7 more are created at runtime; 3 in the dump no longer exist live.

| | Tables |
|---|---|
| **Created at runtime, absent from `hris.sql`** | `payrollmeta`, `reward_cycles`, `reward_cycle_votes`, `reward_certificates`, `reward_rounds`, `reward_round_nominees`, `reward_round_votes` |
| **In `hris.sql`, dropped from live DB** | `rate_limit_hits`, `rate_limit_blocks`, `report_schedules` |

### 5.1 Core identity

#### `users` — 301 rows

| Column | Type | Notes |
|---|---|---|
| `id` | int unsigned | **PK** |
| `username` | varchar(100) | UNIQUE |
| `email` | varchar(150) | UNIQUE — the de facto join key to `employees` |
| `email_verified_at`, `email_updated_at` | datetime | |
| `password_hash` | varchar(255) | bcrypt |
| `role_id` | int unsigned | **FK → roles.id** |
| `status_id` | int unsigned | **FK → status.id** |
| `must_change_password` | tinyint(1) | |
| `password_changed_at` | timestamp | Drives expiry |
| `failed_login_attempts`, `locked_until` | int / datetime | Lockout |
| `two_factor_enabled`, `is_archived` | tinyint(1) | |

**`users` has no `employee_id` column.** The link to `employees` is resolved at runtime by **email string match with a COLLATE cast** (`connection-pdo.php` L353), with fallbacks through `employee_id`, username, and even a full-name `CONCAT` comparison. This is the single largest normalization defect in the schema.

#### `employees` — 300 rows

PK `id`; FKs `division_id → divisions.id`, `designation_id → designations.id`. UNIQUE on `employee_id` and `email`.

45 columns across: identity (first/middle/last name, DOB, gender, civil status), address (address, city, province, zip), contact (email, phone), family (spouse name/occupation, father, mother), education (highest_education, school_name, education_course, year_graduated), emergency contact (name, relationship, phone, address), physical (height, weight, blood_type), government IDs (`emp_gsis_id_no`, `emp_pagibig_id_no`, `emp_philhealth_id_no`, `tin_no`), employment (division_id, designation_id, basic_salary, salary_rate, date_hired, status, employment_status, pwd), and media (`profile_image`, `e_signature` as longtext base64).

#### Reference tables

| Table | Rows | Notes |
|---|---|---|
| `roles` | 5 | `name` UNIQUE, `base_role` — custom roles inherit a built-in |
| `status` | 2 | Active / Inactive |
| `divisions` | 6 | `name` and `code` both UNIQUE |
| `designations` | 38 | FK → divisions.id |

### 5.2 Leave subsystem (7 tables)

| Table | Rows | PK | FKs | Notes |
|---|---|---|---|---|
| `leave_types` | 17 | leave_type_id | — | `code` UNIQUE |
| `leave_requests` | 8 | leave_request_id | employee_id, leave_type_id, reviewed_by_employee_id, approved_by_employee_id → employees | `current_level` drives the two-step chain |
| `leave_approvals` | 0 | leave_approvals_id | leave_request_id, approver_id | UNIQUE (request, level) |
| `leave_attachments` | 0 | leave_attachments_id | leave_request_id | |
| `leave_credits` | 2,326 | leave_credits_id | employee_id, leave_type_id | UNIQUE (employee, type, year); **generated stored column** `remaining_credits = total_credits - used_credits` |
| `leave_monetization_requests` | 3 | id | employee_id, leave_type_id | |
| `compensatory` | 0 | id | employee_id, approved_by → users, reviewed_by/approved_by_employee_id | |

### 5.3 Attendance subsystem (4 tables)

`attendance_logs` (2,456 raw punches; UNIQUE on employee + punch_at + punch_type) rolls up into `attendance_daily_records` (667; UNIQUE on employee + date), which `attendance_adjustments` (0) amends. `holidays` (0 rows) and `attendance_deductions` (3) support the calculations.

### 5.4 Payroll subsystem (10 tables)

| Table | Rows | Notes |
|---|---|---|
| `payroll` | 353 | **50+ hard-coded deduction columns** |
| `payrollmeta` | 320 | Runtime-created; JSON snapshot a payslip is rebuilt from; FK CASCADE from payroll |
| `payrolldeduction` | 1,626 | Proper child table — coexists with the columns above |
| `payrollapproval` | 509 | Approval audit trail |
| `allowance` | 5 | |
| `employeededuction` | 0 | Per-employee recurring deductions |
| `gsis_deductions` | 8 | Deduction family |
| `phic_deductions` | 2 | Deduction family |
| `pagibig_deductions` | 9 | Deduction family |
| `other_deductions` | 23 | Deduction family |
| `withholding_tax_deductions` | 0 | Deduction family |
| `attendance_deductions` | 3 | Deduction family |

**Two structural defects here:**

1. **`payroll` is severely denormalized.** It carries 50+ hard-coded deduction columns (`gfal`, `mpl_lite`, `enrp_mowel`, `ucpb_salary_loan`, `disallowance_praise`, `disallowance_maternity_leave`, `family_support_w_court_order`, …) *alongside* the properly normalized `payrolldeduction` child table. `deduction_catalog_sync_payroll_columns()` runs `ALTER TABLE` at runtime to add more as new deduction types are created.

2. **Broken foreign key.** `payroll_ibfk_1` references a table named **`employee`** (singular) which does not exist — confirmed live in `information_schema.KEY_COLUMN_USAGE`. Additionally `payroll.employee_id` is `int(11)` while `employees.id` is `int(10) unsigned`, so the constraint cannot be repointed without a type change. The code works around this with `payroll_with_legacy_fk_bypass()`, which issues a **connection-wide `SET FOREIGN_KEY_CHECKS=0`** — disabling *all* referential integrity for the duration of the callback, not just this one constraint.

### 5.5 Remaining tables

**Performance:** `ipcr` (301), `ipcr_templates` (0), `ipcr_verification_files` (1), `opcr_templates` (0), `division_opcr_assignments` (1).

**Requests:** `travel_orders` (0), `pass_slip` (2), `overtime` (0), `loan_requests` (4), `loan_request_audit_trail` (5), `cash_advance_requests` (0), `module_access_requests` (2).

**Rewards — live:** `reward_cycles` (3), `reward_cycle_votes` (4), `reward_certificates` (1), `reward_certificate_sequence` (1).
**Rewards — dead:** `reward_nominations` (1), `reward_rounds` (1), `reward_round_nominees` (0), `reward_round_votes` (0).

**System:** `settings` (23, key/value), `audit_logs` (398), `notifications` (**9,525 rows / 5.5 MB — the largest table**), `messages` (0), `service_records` (301), `backup_history` (2).

### 5.6 Table → file cross-reference

| Table | Backend files that touch it |
|---|---|
| employees | 30 files — the most widely read table |
| divisions / designations | 26 / 21 files |
| users | 24 files |
| roles | 16 files |
| settings | app_settings, backup, changes, connection-pdo, email-domain-policy, settings |
| payroll | app_settings, changes, deduction-catalog, deduction, payroll, reports |
| leave_requests | analytics, attendance, changes, leave_request, payroll, reports, service_record |
| notifications | changes, notifications, connection-pdo |
| audit_logs | app_settings, audit_logs_helper, reports, two-factor-utils, connection-pdo |
| rate_limit_* / report_schedules | **none** |

### 5.7 Tables safe to remove

| Table | Rows | Reason |
|---|---|---|
| `rate_limit_hits` | — | Already dropped live. Feature deleted (`rate-limit-utils.php`, `rate_limit.php`, `ratelimit.jsx` all show `D` in git status). Present only in `hris.sql` |
| `rate_limit_blocks` | — | Same |
| `report_schedules` | — | Already dropped live. `ScheduledReportsPanel.jsx` deleted. Present only in `hris.sql` |
| `reward_rounds` | 1 | Superseded by `reward_cycles`. Zero code references |
| `reward_round_nominees` | 0 | Same |
| `reward_round_votes` | 0 | Same |
| `reward_nominations` | 1 | Retired certificate module. Explicitly documented as dead in `rewards.php` L92 |

**Do NOT remove despite having 0 rows** — all of these have live code paths and will fill as the system is used: `holidays`, `messages`, `leave_approvals`, `leave_attachments`, `employeededuction`, `overtime`, `travel_orders`, `compensatory`, `cash_advance_requests`, `ipcr_templates`, `opcr_templates`, `withholding_tax_deductions`, `attendance_adjustments`.

### 5.8 Normalization issues — summary

1. `users` ↔ `employees` joined by **email string**, not a foreign key
2. `payroll` carries 50+ deduction columns **and** a `payrolldeduction` child table
3. Six deduction family tables share an **identical 17-column definition**
4. `payroll_ibfk_1` points at a nonexistent table; worked around by disabling FK checks
5. `division_opcr_assignments.division` is a **varchar(150) name**, not a FK to `divisions.id`
6. `reward_nominations` and `reward_certificates` **denormalize employee name, code, division and designation** into the row (defensible for certificates, which must not change retroactively; less so for nominations)

---

## 6. RBAC Analysis

### 6.1 Role management

Six built-in roles plus admin-created custom roles. A custom role carries `roles.base_role`, which decides its dashboard component and URL prefix — custom roles have no route space of their own (`utils/roleRoutes.js` L133, `resolveBaseRole`).

| Role key | Label | Default landing path |
|---|---|---|
| `admin` | Admin | `/admin/dashboard` |
| `hrhead` | HR Head | `/hrhead/dashboard` |
| `hrstaff` | HR Staff | `/hrstaff/dashboard` |
| `chief` | Chief | `/chief/dashboard` |
| `regionaldirector` | Regional Director | `/regionaldirector/dashboard` |
| `employee` | Employee | `/employee/dashboard` |

### 6.2 Permission matrix

**16 resources × up to 6 actions**, defined in `hris_permission_items()` (`app_settings.php`).

| Resource | Default actions |
|---|---|
| `dashboard`, `auditLogs`, `calendar`, `payslip` | view |
| `profile`, `serviceRecord`, `permissions`, `settings`, `leaveBalance` | view, edit |
| `reports` | view, export |
| `rewardsRecognition` | view, create, edit |
| `users`, `employees` | view, create, edit, delete |
| `payroll` | view, create, edit, export |
| `attendance`, `leave` | view, create, edit, approve, reject, export |

**Default grants** (`hris_default_role_permission_access()`):

| Role | Resources granted |
|---|---|
| admin | `'all'` |
| hrhead | dashboard, profile, serviceRecord, users, permissions, auditLogs, calendar, employees, rewardsRecognition, attendance, leave, leaveBalance, payroll, reports (14) |
| hrstaff | dashboard, profile, serviceRecord, calendar, employees, rewardsRecognition, attendance, leave, leaveBalance, reports (10) |
| regionaldirector | dashboard, profile, serviceRecord, calendar, leave, reports, rewardsRecognition, auditLogs (8) |
| chief | dashboard, profile, serviceRecord, calendar, attendance, leave, reports (7) |
| employee | dashboard, profile, serviceRecord, calendar, attendance, leave, payslip (7) |

### 6.3 Module permissions

45+ navigation keys collapse onto the 16 resources via `MODULE_PERMISSION_MAP` (`utils/permissions.js` L4). Notable mappings, each commented in-source:

- `travel`, `cto`, `passSlip`, `leaveMonetization`, `payrollLeaveMonetization` → **`leave`** — they follow the leave approval chain, not payroll
- `rewardsNomination`, `rewardsLoyalty` → **`rewardsRecognition`** — split out from `employees` because issuing a certificate in the Regional Executive Director's name is not the same right as editing an employee record
- `overtime`, `legacyAttendance` → **`attendance`**
- `payrollGenerate`, `payrollRecords`, `payrollLoan`, `payrollCashAdvance`, `archivedPayroll` → **`payroll`**
- All report categories (generated from `REPORT_CATEGORIES`) and `performance*` → **`reports`**
- `ipcr` → **`serviceRecord`**

`ALWAYS_ALLOWED_MODULES` bypasses the matrix entirely for a user's *own* records — `myAttendance`, `myPayslip`, `myIpcr`, `myServiceRecord`, `myNomination` — plus `messages` and `notifications`. The rationale is that an HR Staff member with no payroll permission still has their own payslip, and casting one vote is not the same right as running the award.

### 6.4 User-specific permissions

Stored in `settings` under the key `user_permission_overrides` as `{userId: template}`. `hris_sync_user_permission_override()` compares a signature of the override against the role template and **auto-drops the override** when they match, so a user does not silently keep a stale copy after the role template is edited.

### 6.5 Sidebar permission loading

```
Sidebar receives the UNFILTERED navigation list
  └─ a revoked module stays visible
     └─ clicking it renders AccessDeniedInline + "Request Access"
        └─ POST access_request.php → notifies admins → grant writes the override

filterNavigationItemsByPermissions() is used only to:
  - pick the fallback landing route
  - pick the Access Denied "Go Back" target
```

### 6.6 Access validation flow

```
BACKEND
  format_user()
    → hris_permissions_for_user(userId, roleKey)
        → override exists? use it
        : hris_permissions_for_role_key(roleKey)
    → embedded in the session payload as user.permissions

FRONTEND
  userCanAccessModule(user, navKey)
    → ALWAYS_ALLOWED_MODULES? → true
    → permissionResourceForModule(navKey) → resource
    → unmapped resource? → true (fail-open by design)
    → admin? → true
    → userHasPermission(resource, 'view') || userCanAccessResource(resource)

LIVE SYNC
  App.jsx useAutoRefreshOnChange(refreshPermissions, {topics:['permissions','settings']})
    → refreshSession() → new permissions apply without re-login
    → the stored copy is compared first, so an unchanged poll does not remount the workspace
```

### 6.7 Critical finding — the matrix does not enforce

**The frontend permission matrix is UX only.** Enforcement is server-side and real, but it uses a *different* mechanism: hard-coded role-key checks, one set per endpoint — `leave_can_manage()`, `payroll_require_staff_role()`, `ipcr_can_manage()`, `cash_advance_can_manage()`, `rewards_require_manager()`, and roughly 30 more.

Consequence: granting `payroll.edit` to a Chief in the admin matrix reveals the menu item, but `payroll.php` still rejects the request, because `payroll_is_staff_role()` never consults `hris_permissions_for_user()`. The two systems are not connected. This is not a security hole — the server is the stricter of the two — but it makes the admin UI misleading.

---

## 7. System Flow

```
LOGIN
  Login.jsx
    → GET  /public_settings.php     captcha flag, max password length, session timeout
    → GET  /csrf.php                CSRF token
    → POST /login.php               { username, password }
        ↓
AUTHENTICATION  (login.php — 8 sequential gates)
  1. lockout window still open?          → 423
  2. password_verify()                   → 401 + record failed attempt (+ lock at threshold)
  3. is_archived                         → 403
  4. status = 'Active'                   → 403
  5. email domain policy                 → 403
  6. password expired                    → 403 + set must_change_password
  7. 2FA required?
       ├─ yes → issue OTP by email → 200 { requiresTwoFactor: true }
       │        → two_factor_verify.php → promotes pending login to session
       └─ no  → continue
  8. session_regenerate_id(true)
     $_SESSION['user'] = format_user()   permissions embedded here
     audit write + admin alert + "new login detected" email
        ↓
DASHBOARD
  handleLogin() → localStorage['hris_admin_user']
                → getDefaultPathForRole(roleKey, baseRoleKey)
  App.jsx switch(resolveBaseRole(...)) → 1 of 6 dashboard components
  startLiveUpdates() → long-poll /changes.php (leader tab only)
        ↓
MODULE ACCESS
  Sidebar renders the unfiltered nav tree → user clicks an item
  RoleWorkspacePage:
    matchedNavigationItem → canAccessNavigationItem(item, user)
      ├─ denied  → AccessDeniedInline → "Request Access" → access_request.php
      └─ allowed → modules[activeItem.key] renders the workspace component
        ↓
API
  service function → axios
    → request interceptor attaches X-CSRF-Token (POST/PUT/PATCH/DELETE)
    → endpoint: CORS → session start → CSRF verify
                → require_method → require_session_user
                → role gate → record-level gate
        ↓
DATABASE
  PDO prepared statement (EMULATE_PREPARES = false)
  ensure_*() self-heals the schema on first touch
        ↓
FRONTEND DISPLAY
  json_response() → React state → render
  On mutation:
    publishAutoRefresh() → BroadcastChannel → sibling tabs (same machine)
    changes.php revision moves → other machines refresh within one inner tick
```

---

## 8. Dependency Analysis

### 8.1 Broken and non-functional code

#### `password_expiry_check.php` is dead on arrival — three UI features silently never fire

```php
require_once __DIR__ . '/session.php';   // session.php calls json_response() → exit
$pdo = get_pdo_connection();             // this function does not exist anywhere
$sessionUser = get_session_user($pdo);   // this function does not exist anywhere
```

`session.php` terminates the request with `{success:true, user:{…}}`, so lines 12 onward never execute — which is the only reason the two undefined-function calls do not produce a fatal error. Consumers read `response.passwordExpiry`, receive `undefined`, and fall through their `else` branch:

| Consumer | Broken behaviour |
|---|---|
| `components/navigation/Header.jsx` L186 | Expiry banner never shows — **and it re-polls this useless endpoint every 60 seconds, forever, for every signed-in user** |
| `page/Employee/employeedashboard.jsx` L44 | `PasswordExpiryModal` never opens |
| `components/profile/ProfilePage.jsx` L279 | Expiry information absent from the profile |

`test_password_expiry.php` contains the identical bug. It is htaccess-denied, so harmless.

#### `payroll_ibfk_1` → nonexistent table `employee`

Worked around by a connection-wide `SET FOREIGN_KEY_CHECKS=0` in `payroll_with_legacy_fk_bypass()`. See §5.4.

#### No broken imports

All 191 frontend source files resolve cleanly. Zero unresolved relative imports.

### 8.2 Dead files — safe to remove

**Never imported by anything (15 files):**

| File | Size | Note |
|---|---|---|
| `components/profile/sections/EmailVerificationSection.jsx` | **41 KB / 991 L** | Superseded by `ChangeEmailSection.jsx` (10 KB). Largest dead file in the project |
| `components/chart/barchart.jsx` | 5.3 KB | Charting moved to Recharts in `ReportsCharts.jsx` |
| `components/chart/linechart.jsx` | 5.5 KB | Same |
| `components/employee/ServiceCounterCard.jsx` | 3.6 KB | |
| `components/leave/LeaveModal.jsx` | 48 B | One-line re-export |
| `components/UI_Login/logout.jsx` | 1.1 KB | Logout is handled in `App.jsx` |
| `hooks/usePermission.js` | 7.2 KB | **Duplicates `utils/permissions.js`** with divergent logic |
| `hooks/useTablePagination.js` | 1.1 KB | Superseded by `UI/Pagination.jsx` |
| `hooks/useTableSort.js` | 2.3 KB | |
| `module/calendar/HrHeadCalendarWorkspace.jsx` | 200 B | |
| `module/leave/LeaveApproval.jsx` | 1.4 KB | Superseded by `LeaveDashboard.jsx` |
| `module/leave/LeaveBalance.jsx` | 1.2 KB | Superseded by `LeaveBalanceManagementWorkspace.jsx` |
| `module/leave/LeaveHistory.jsx` | 1.6 KB | |
| `module/leave/LeaveRequest.jsx` | 1.1 KB | |
| `module/reports/ReportsKpiGrid.jsx` | 6.6 KB | |

**Reachable only from dead files (4 files, cascade):**

| File | Size | Kept alive only by |
|---|---|---|
| `components/calendar/calendar.jsx` | **35 KB** | `HrHeadCalendarWorkspace.jsx` (dead) |
| `components/chart/ChartCardShell.jsx` | 1.8 KB | `barchart.jsx` / `linechart.jsx` (dead) |
| `components/analytics/index.js` | 915 B | A barrel file nobody imports |
| `components/analytics/DepartmentHeadcountCard.jsx` | 6.8 KB | The dead barrel only |

**Non-source dead weight:**

| Path | Size | Note |
|---|---|---|
| `frontend/vendor/` | 10 files | **Orphaned Composer install.** No `composer.json` exists anywhere in `frontend/`; `installed.php` names the root package `micha/monitoring` — an unrelated project; `autoload_psr4.php` maps `Predis\`, `Psr\Http\Message\` and `Fgribreau\` to directories **that are not on disk**. Nothing in the project requires `vendor/autoload.php`. Already gitignored |
| `src/module/employee/.codex-write-probe.txt` | 7 B | Contains the word `probe`. Tooling artifact |
| `frontend/docs/`, `.agents/`, `src/page/rewards/` | — | Empty directories |
| `public/favicon.ico`, `logo192.png`, `logo512.png` | 19 KB | CRA defaults, unreferenced |
| `public/philippines-addresses/zipcodes.json` | 47 KB | Never fetched |
| `backend/backups/*.sql` | **18 MB, 8 files** | Working-tree only, gitignored. Six are one-off pre-migration snapshots (`presplit`, `prenormalize`, `precolumns`, `preseed`) |

### 8.3 Unused npm dependencies — 14 of 41

`apexcharts`, `react-apexcharts`, `boneyard-js`, `build`, `jwt-decode`, `leaflet`, `react-leaflet`, `react-hook-form`, `react-router-dom`, `react-select`, `select-philippines-address`, `ua-parser-js`, `web-vitals`, `zod`

Two are notable:

- **`build`** is a junk package that should never have been installed
- **`react-router-dom`** is present but routing is hand-rolled in `App.jsx`

`@fullcalendar/*` (4 packages) is used **only** by `components/dashboard/DashboardLeaveTravelCalendar.jsx`. It survives the dead-code purge, but if that widget is ever retired, four more packages go with it.

### 8.4 Unused API surface

- **`analytics.php`** is reachable only through `DashboardAnalytics` → `AdminAnalyticsOverview`. It is live, but `get_department_headcount()` and `get_leave_utilization()` results are fetched and discarded, because the only consuming card (`DepartmentHeadcountCard`) is dead.
- **No orphaned endpoints.** All 46 HTTP endpoints have at least one frontend caller.

### 8.5 Duplicate code

| Duplication | Locations |
|---|---|
| Permission checking | `utils/permissions.js` (live) vs `hooks/usePermission.js` (dead) — divergent implementations of the same idea |
| Role normalization | `hris_normalize_role()` (PHP) vs `normalizeRole()` (JS) — identical switch, kept in sync by hand |
| Deduction family schema | 6 tables with **identical 17-column definitions** |
| Payroll deduction storage | 50+ columns on `payroll` **and** the `payrolldeduction` child table |
| Employee ↔ user resolution | `hris_find_employee_for_user()` + `hris_session_employee_record_id()` + a JOIN in `session_user_record()` — three code paths for one lookup |
| Rejection email builders | 4 near-identical `*_rejection_html_body()` / `*_rejection_text_body()` pairs in `password-reset-utils.php` |

No duplicated CSS or JS assets were found.

### 8.6 Missing references

None. Every relative import resolves; every `require_once` target exists; every navigation key maps to a module or falls through to the documented fail-open path.

---

## 9. Optimization Suggestions

### Security — highest value first

1. **Fix `password_expiry_check.php`.** Replace the `require session.php` plus undefined-function calls with the standard `require_once connection-pdo.php` → `require_session_user()` pattern. Restores three broken features and removes a useless 60-second poll from every session. Roughly 10 lines of work.
2. **Set a MySQL root password.** `connection-pdo.php` connects as `root` with an empty password. It also runs `CREATE DATABASE IF NOT EXISTS` — DDL rights the application does not need at request time. Create a least-privilege `hris_app` user.
3. **Move database credentials out of source**, using the same `smtp-credentials.local.php` pattern already proven in this codebase.
4. **Serve uploads through an authenticated endpoint.** Leave attachments are medical certificates; today anyone holding the URL can fetch one without a session. `uploads/.htaccess` already documents this as the known gap.
5. **Add size caps to the IPCR and OPCR uploads** — the other three handlers have them — and add `finfo` / `getimagesize` content validation to all five.
6. **Repair the payroll foreign key** so `SET FOREIGN_KEY_CHECKS=0` can be deleted: `ALTER TABLE payroll MODIFY employee_id INT UNSIGNED`, drop `payroll_ibfk_1`, re-add pointing at `employees(id)`.
7. **Consider reinstating rate limiting** on `login.php` and `forgot_password.php`. The per-account lockout survives, but the per-IP throttle was removed, so credential stuffing across many accounts is unthrottled.

### Performance

8. **`background.png` is 6.4 MB** for a login backdrop. Resize and convert to WebP — expect roughly 99% reduction.
9. **`main.js` is 3.37 MB with zero code splitting** — no `React.lazy` anywhere in the project. Splitting the six role dashboards alone would cut initial load dramatically.
10. **Remove the 14 unused npm packages.** Several (apexcharts, leaflet, zod) ship real bytes.
11. **`barangay.json` is 4.7 MB and fetched eagerly** on every profile mount, alongside three sibling files. Load it lazily after a city is selected.
12. **`notifications` is 9,525 rows / 5.5 MB with no retention policy**, and a single payroll run fans out 300+ rows. Add a scheduled purge (for example, read and older than 90 days).
13. **The sidebar polls 7 separate services** for badge counts on every mount. Fold these into one `/pending_counts.php` aggregate.

### Code structure

14. **Split the four largest frontend files** — `PayrollManagementWorkspace.jsx` (4,352 L), `division.jsx` (3,333 L), `AdminDashboard.jsx` (2,948 L), `LeaveBalanceManagementWorkspace.jsx` (2,421 L). Same treatment for `payroll.php` (3,393 L) and `reports.php` (3,025 L).
15. **Rename `page/settings/division.jsx` → `SettingsWorkspace.jsx`.** The current name actively misleads: it is the settings hub, and divisions are one small tab within it.
16. **Add a `users.employee_id` foreign key column and backfill it.** This retires three fragile string-matching lookup paths at once.
17. **Collapse the 6 identical deduction tables** into one `deduction_definitions` table with a `family` discriminator. `deduction-catalog.php` already UNIONs them, so the abstraction exists — the storage has not caught up.
18. **Connect the permission matrix to backend enforcement.** Replace the hard-coded `*_can_manage()` role checks with `hris_permissions_for_user()` lookups, so the admin UI and reality agree.
19. **Delete `hooks/usePermission.js`** rather than leaving a second, divergent permission implementation next to the real one.

### Folder organization

20. **Remove the three empty directories** (`frontend/docs/`, `.agents/`, `src/page/rewards/`) or populate them.
21. **Move `src/PHPMailer-master/` to `backend/lib/`.** A PHP library living under the React source tree is why the root `.htaccess` needs a special rule to hide it.
22. **Prune `backend/backups/`** — 18 MB of one-off migration snapshots in the working tree.

### Reusable components

23. **Extract the shared workspace table pattern.** At least 12 module workspaces re-implement filter bar + table + pagination + row actions inline. `UI/table.jsx` and `UI/Pagination.jsx` exist but are composed by hand each time.
24. **Extract the rejection-email builder.** Four near-identical pairs in `password-reset-utils.php` differ only in subject, entity label and field list.

### Maintainability

25. **Write a real `README.md`.** Setup, DB import, environment variables, roles, and verify commands are entirely undocumented. (The previous two-line placeholder has been deleted from the working tree.)
26. **Commit a structure-only `schema.sql`.** `.gitignore` already anticipates it (`!/frontend/backend/database/schema.sql`) but the file does not exist, so a fresh clone has no schema at all. It should include the 7 runtime-created tables the current dump is missing.
27. **Regenerate `hris.sql`** — it is 4 tables behind the live database and 3 tables ahead of it.
28. **Adopt `.editorconfig`.** Line endings are mixed and unpredictable per directory (the reports module and `PayrollManagementWorkspace.jsx` are CRLF; most other source files are LF), which makes any bulk codemod hazardous.
29. **Add tests.** The CRA test runner is configured and zero test files exist.

---

## 10. Final Report

### Feature map

| Feature | Frontend | Backend | Tables | Status |
|---|---|---|---|---|
| Authentication + 2FA | `login.jsx`, `two_factor_verification.jsx` | login, two_factor_* | users, roles, status | Working |
| Password reset / change / expiry | `forgot_password.jsx`, `PasswordChangeSection` | forgot/reset_password, password_change | users | **Expiry broken** |
| Employee management | `EmployeeManagementWorkspace`, `create_employee` | employee.php | employees, users | Working |
| Attendance + DTR | `AttendanceManagementWorkspace` | attendance.php | attendance_* ×3, holidays | Working |
| Leave (request / approve / credits) | `LeaveDashboard`, `LeaveBalanceManagementWorkspace` | leave_request, leave_credit | leave_* ×6 | Working |
| Travel / Pass slip / CTO / Overtime | 4 workspaces | 4 endpoints | 4 tables | Working |
| Payroll + payslip | `PayrollManagementWorkspace`, `PayslipWorkspace` | payroll, payslip, deduction | payroll ×10 | Working (schema debt) |
| Loans + cash advance | `fileloan`, `CashAdvanceWorkspace` | loan_request, cash_advance | 3 tables | Working |
| Performance (IPCR / OPCR) | 3 workspaces | ipcr, opcr | 5 tables | Working |
| Service records | `ServiceRecordWorkspace` | service_record | service_records | Working |
| Rewards + certificates | `AwardCyclesWorkspace`, `LoyaltyWorkspace` | rewards.php | reward_cycles ×4 (+4 dead) | Working |
| Reports + export | `AdminReports`, `ReportsCharts` | reports.php | ~15 read-only | Working |
| RBAC + roles | `permission.jsx`, `roles.jsx` | app_settings, settings, roles | settings, roles | **UI/API disconnect** |
| Notifications | `NotificationBell`, `NotificationCenter` | notifications.php | notifications | **No retention** |
| Chat | `bubble_chat.jsx` | chat.php | messages | Working (0 rows) |
| Audit logs | `auditlogs.jsx` | audit_logs + helper | audit_logs | Working |
| Backups | `division.jsx` tab | backup.php | backup_history | Working |
| Live updates | `liveUpdatesService` | changes.php | 30+ (fingerprint) | Working |
| Rate limiting | — | — | 2 orphan tables | **Removed** |
| Scheduled reports | — | — | 1 orphan table | **Removed** |

### Files safe to remove — summary

| Category | Count | Size |
|---|---|---|
| Dead source files | 19 | ~120 KB |
| Orphaned `frontend/vendor/` | 10 | ~65 KB |
| Empty directories | 3 | — |
| Tooling artifact | 1 | 7 B |
| Unused public assets | 4 | 66 KB |
| Backup dumps | 8 | 18 MB |
| npm packages | 14 | — |
| Database tables | 7 | — |

Nothing on this list has a live reference. Every finding was verified by full import-graph resolution and live database introspection, not by pattern matching alone.

### Files requiring refactoring

| Priority | Item |
|---|---|
| **Critical** | `password_expiry_check.php` (non-functional); `payroll` table FK and column sprawl |
| **High** | `PayrollManagementWorkspace.jsx` 4,352 L; `payroll.php` 3,393 L; `division.jsx` 3,333 L (also misnamed); `reports.php` 3,025 L; `AdminDashboard.jsx` 2,948 L |
| **Medium** | 6 duplicate deduction tables; triple employee↔user lookup; 4 duplicated rejection-email builders; RBAC UI/API disconnect |

### Missing documentation

- Root `README.md` — deleted from the working tree; was a two-line placeholder before that
- No API reference for the 46 endpoints
- No entity-relationship diagram
- No setup or deployment guide
- No `schema.sql`, despite `.gitignore` explicitly expecting one
- No contributor guide
- No tests of any kind — the CRA test runner is configured, zero test files exist

### Overall System Health: 7.4 / 10

| Dimension | Score | Basis |
|---|---|---|
| Functionality | 9.0 | 19 of 20 features complete and working; unusually broad for a capstone |
| Code quality | 8.5 | Strict types throughout, PDO prepared statements everywhere, **59/59 PHP files lint clean**, zero TODO/FIXME/HACK, only 3 `console.*` across 191 files, no `var_dump` or `print_r` |
| Documentation (in-code) | 9.5 | Exceptional. Comments explain *why*, not *what*. The `.htaccess` files, the `changes.php` header, `.env.example` and the `mobile.css` preamble are better than most production code |
| Security | 7.0 | Strong: CSRF on all writes, `session_regenerate_id`, bcrypt, per-request session revalidation, account lockout, 2FA, layered `.htaccess`, secrets correctly gitignored and untracked. Weak: empty root DB password, unauthenticated upload URLs, extension-only file validation, `FOREIGN_KEY_CHECKS=0` |
| Database design | 5.5 | Good FK coverage and indexing on newer tables — undermined by `payroll` denormalization, a broken FK to a nonexistent table, email-string identity join, 6 duplicate deduction tables, 7 orphan tables |
| Performance | 5.5 | 3.37 MB bundle with no code splitting, 6.4 MB background image, 4.7 MB eager JSON fetch, 7-service sidebar polling, unbounded notifications table |
| Architecture | 8.0 | Clean layering, consistent endpoint conventions, thoughtful live-update design. Held back by RBAC enforcement not matching its own matrix |
| Maintainability | 6.5 | Six files over 2,400 lines, mixed line endings, zero tests, external documentation absent |

### Verdict

This is a genuinely strong capstone. The breadth of working features and the quality of in-code reasoning are well above typical for a project of this kind — the architectural comments in particular explain trade-offs that most codebases leave implicit.

Its weaknesses are the predictable ones for a system that grew fast: schema debt concentrated in `payroll`, a handful of very large files, and a permission matrix whose UI has outrun its enforcement.

The single highest-value fix is `password_expiry_check.php` — roughly 10 lines of work that restores three user-visible features and removes a per-minute wasted request from every active session.
