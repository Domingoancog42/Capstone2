-- User-requested synthetic monthly points for the Performance Management line chart.
-- Official IPCR/OPCR imports are left untouched. Running this file again replaces only these
-- clearly labeled example rows, so the chart data remains deterministic and duplicate-free.

START TRANSACTION;

SET @example_year := YEAR(CURDATE());
SET @example_source := 'Monthly performance chart example (synthetic)';
SET @example_employee_id := (
    SELECT e.id
    FROM employees e
    WHERE e.is_archived = 0
    ORDER BY e.id ASC
    LIMIT 1
);
SET @example_division := (
    SELECT d.name
    FROM employees e
    INNER JOIN divisions d ON d.id = e.division_id AND d.is_archived = 0
    WHERE e.id = @example_employee_id
    LIMIT 1
);

DELETE FROM ipcr
WHERE mode_of_verification_name = @example_source;

DELETE FROM division_opcr_assignments
WHERE mode_of_verification_name = @example_source;

DELETE FROM opcr_templates
WHERE template_name LIKE CONCAT('Monthly performance chart example ', @example_year, '-%')
  AND NOT EXISTS (
      SELECT 1
      FROM division_opcr_assignments doa
      WHERE doa.template_id = opcr_templates.template_id
  );

INSERT INTO ipcr (
    employee_id,
    period_from,
    period_to,
    output,
    success_indicator,
    kpi_category,
    actual_accomplishment,
    remarks,
    final_rating,
    q1_rating,
    e2_rating,
    t3_rating,
    a4_rating,
    mode_of_verification_name,
    submitted_at,
    status,
    is_archived
)
SELECT
    @example_employee_id,
    DATE_ADD(MAKEDATE(@example_year, 1), INTERVAL sample.month_offset MONTH),
    LAST_DAY(DATE_ADD(MAKEDATE(@example_year, 1), INTERVAL sample.month_offset MONTH)),
    CONCAT(
        'Monthly performance chart example ',
        @example_year,
        '-',
        LPAD(sample.month_offset + 1, 2, '0')
    ),
    'Synthetic monthly point for dashboard visualization',
    'Example',
    'User-requested example value for the monthly line chart.',
    'Synthetic example; not sourced from an official performance form.',
    sample.average_rating,
    sample.average_rating,
    sample.average_rating,
    sample.average_rating,
    sample.average_rating,
    @example_source,
    TIMESTAMP(
        LAST_DAY(DATE_ADD(MAKEDATE(@example_year, 1), INTERVAL sample.month_offset MONTH)),
        '12:00:00'
    ),
    'reviewed',
    0
FROM (
    SELECT 0 AS month_offset, 1.00 AS average_rating
    UNION ALL SELECT 1, 2.00
    UNION ALL SELECT 2, 3.00
    UNION ALL SELECT 3, 4.00
    UNION ALL SELECT 4, 5.00
    UNION ALL SELECT 5, 4.00
    UNION ALL SELECT 6, 3.00
    UNION ALL SELECT 7, 2.00
    UNION ALL SELECT 8, 1.00
    UNION ALL SELECT 9, 2.00
    UNION ALL SELECT 10, 3.00
    UNION ALL SELECT 11, 4.00
) sample
WHERE @example_employee_id IS NOT NULL;

INSERT INTO opcr_templates (
    template_name,
    category,
    office_division,
    year_semester,
    template_status,
    output,
    success_indicator,
    is_archived
)
SELECT
    CONCAT(
        'Monthly performance chart example ',
        @example_year,
        '-',
        LPAD(sample.month_offset + 1, 2, '0')
    ),
    'Example',
    @example_division,
    CONCAT('Monthly example ', @example_year),
    'Example',
    CONCAT('Monthly OPCR chart example for ', DATE_FORMAT(
        DATE_ADD(MAKEDATE(@example_year, 1), INTERVAL sample.month_offset MONTH),
        '%M %Y'
    )),
    'Synthetic monthly point for dashboard visualization',
    0
FROM (
    SELECT 0 AS month_offset
    UNION ALL SELECT 1
    UNION ALL SELECT 2
    UNION ALL SELECT 3
    UNION ALL SELECT 4
    UNION ALL SELECT 5
    UNION ALL SELECT 6
    UNION ALL SELECT 7
    UNION ALL SELECT 8
    UNION ALL SELECT 9
    UNION ALL SELECT 10
    UNION ALL SELECT 11
) sample
WHERE @example_division IS NOT NULL;

INSERT INTO division_opcr_assignments (
    opcr_no,
    template_id,
    employee_id,
    division,
    period,
    semester,
    prepared_by,
    remarks,
    actual_accomplishment,
    assignment_status,
    approved_by,
    final_rating,
    q1_rating,
    e2_rating,
    t3_rating,
    a4_rating,
    mode_of_verification_name,
    submitted_at,
    is_archived
)
SELECT
    CONCAT(
        'OPCR-CHART-EXAMPLE-',
        @example_year,
        '-',
        LPAD(sample.month_offset + 1, 2, '0')
    ),
    template.template_id,
    @example_employee_id,
    @example_division,
    DATE_FORMAT(
        DATE_ADD(MAKEDATE(@example_year, 1), INTERVAL sample.month_offset MONTH),
        '%M %Y'
    ),
    'Monthly Example',
    'Dashboard Chart Example',
    'Synthetic example; not sourced from an official performance form.',
    'User-requested example value for the monthly line chart.',
    'Rated',
    'Dashboard Chart Example',
    sample.average_rating,
    sample.average_rating,
    sample.average_rating,
    sample.average_rating,
    sample.average_rating,
    @example_source,
    TIMESTAMP(
        LAST_DAY(DATE_ADD(MAKEDATE(@example_year, 1), INTERVAL sample.month_offset MONTH)),
        '15:00:00'
    ),
    0
FROM (
    SELECT 0 AS month_offset, 5.00 AS average_rating
    UNION ALL SELECT 1, 4.00
    UNION ALL SELECT 2, 3.00
    UNION ALL SELECT 3, 2.00
    UNION ALL SELECT 4, 1.00
    UNION ALL SELECT 5, 2.00
    UNION ALL SELECT 6, 3.00
    UNION ALL SELECT 7, 4.00
    UNION ALL SELECT 8, 5.00
    UNION ALL SELECT 9, 4.00
    UNION ALL SELECT 10, 3.00
    UNION ALL SELECT 11, 2.00
) sample
INNER JOIN opcr_templates template
    ON template.template_name = CONCAT(
        'Monthly performance chart example ',
        @example_year,
        '-',
        LPAD(sample.month_offset + 1, 2, '0')
    )
WHERE @example_employee_id IS NOT NULL
  AND @example_division IS NOT NULL;

COMMIT;
