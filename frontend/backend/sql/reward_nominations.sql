-- Rewards & Recognition
--
-- The workspace previously kept nominations in `window.localStorage`, so every browser held its own
-- list: an award issued on one machine did not exist on any other, and clearing site data destroyed
-- the record of it permanently. These tables make awards shared, durable, and auditable.
--
-- The employee's name, division, position, and employment type are snapshotted onto the nomination
-- for the same reason service records snapshot theirs: the certificate is a dated document and must
-- keep saying what the recipient's post was when the award was given, even after a transfer or a
-- division rename.

CREATE TABLE IF NOT EXISTS reward_nominations (
    id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_record_id       INT UNSIGNED NOT NULL,
    category                 VARCHAR(40) NOT NULL,
    award_period             VARCHAR(7) NULL,
    years_of_service         INT UNSIGNED NULL,
    reason                   TEXT NOT NULL,
    employee_name            VARCHAR(200) NOT NULL,
    employee_code            VARCHAR(50) NULL,
    division_name            VARCHAR(180) NULL,
    designation_title        VARCHAR(180) NULL,
    employment_type          VARCHAR(50) NULL,
    nominated_by_employee_id INT UNSIGNED NULL,
    nominated_by_name        VARCHAR(200) NULL,
    status                   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    reviewed_by_user_id      INT UNSIGNED NULL,
    reviewed_by_name         VARCHAR(200) NULL,
    reviewed_at              DATETIME NULL,
    decision_note            VARCHAR(255) NULL,
    certificate_number       VARCHAR(40) NULL,
    certificate_issued_at    DATETIME NULL,
    signatory_name           VARCHAR(200) NULL,
    signatory_title          VARCHAR(180) NOT NULL DEFAULT 'OIC Regional Executive Director',
    is_archived              TINYINT(1) NOT NULL DEFAULT 0,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- A certificate number must never repeat. This is the backstop; the sequence table below is
    -- what actually generates them.
    UNIQUE KEY uq_reward_certificate_number (certificate_number),
    KEY idx_reward_status (status, created_at),
    KEY idx_reward_period (category, award_period, status),
    KEY idx_reward_employee (employee_record_id, status),
    CONSTRAINT fk_reward_nominations_employee
        FOREIGN KEY (employee_record_id) REFERENCES employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Certificate numbering.
--
-- Numbers used to come from `String(Date.now()).slice(-6)` in the browser: that window repeats every
-- ~16.7 minutes and each browser generated independently, so the numbers were neither sequential nor
-- unique. One row per year, incremented inside the approval transaction, gives a gapless sequence.
CREATE TABLE IF NOT EXISTS reward_certificate_sequence (
    award_year  SMALLINT UNSIGNED NOT NULL,
    last_number INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (award_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
