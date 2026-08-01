-- Service Record (CSC Form No. 1)
--
-- `employees` stores only current state, so a promotion overwrites the previous designation and
-- salary and the history is lost. This table is the append-only record those documents are built
-- from. `service_to IS NULL` marks the appointment currently in force.
--
-- designation_title / station / branch are stored as text on purpose. Divisions and designations
-- are renamed and archived from Settings, and a certified service record must state what the post
-- was called at the time — not what that row happens to be called today. The *_id columns are kept
-- alongside for provenance only and are never used for display.

CREATE TABLE IF NOT EXISTS service_records (
    id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_record_id INT UNSIGNED NOT NULL,
    service_from       DATE NOT NULL,
    service_to         DATE NULL,
    designation_title  VARCHAR(180) NOT NULL,
    employment_status  VARCHAR(50) NOT NULL,
    monthly_salary     DECIMAL(12,2) NULL,
    salary_grade       VARCHAR(20) NULL,
    step_increment     VARCHAR(10) NULL,
    station            VARCHAR(180) NOT NULL,
    branch             VARCHAR(180) NOT NULL DEFAULT 'Mines and Geosciences Bureau',
    separation_date    DATE NULL,
    separation_cause   VARCHAR(255) NULL,
    remarks            VARCHAR(255) NULL,
    designation_id     INT UNSIGNED NULL,
    division_id        INT UNSIGNED NULL,
    source             VARCHAR(20) NOT NULL DEFAULT 'manual',
    is_archived        TINYINT(1) NOT NULL DEFAULT 0,
    created_by         INT UNSIGNED NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_service_records_employee (employee_record_id, service_from),
    KEY idx_service_records_open (employee_record_id, service_to),
    CONSTRAINT fk_service_records_employee
        FOREIGN KEY (employee_record_id) REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: one open row per active employee, from whatever their record says today.
-- `source = 'migrated'` marks these as a synthesised starting point rather than a real historical
-- entry, so HR can tell which rows came from an actual appointment document.
INSERT INTO service_records
    (employee_record_id, service_from, service_to, designation_title, employment_status,
     monthly_salary, station, designation_id, division_id, source, remarks)
SELECT
    e.id,
    e.date_hired,
    NULL,
    d.name,
    COALESCE(NULLIF(TRIM(e.employment_status), ''), e.status),
    e.basic_salary,
    dv.name,
    e.designation_id,
    e.division_id,
    'migrated',
    'Opening entry migrated from the employee record.'
FROM employees e
JOIN designations d ON d.id = e.designation_id
JOIN divisions dv ON dv.id = e.division_id
WHERE e.is_archived = 0
  AND e.date_hired IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM service_records sr WHERE sr.employee_record_id = e.id
  );
