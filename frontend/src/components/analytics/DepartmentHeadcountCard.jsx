import React from 'react';
import { Building2 } from 'lucide-react';
import { formatNumber } from '../../module/reports/reportsTheme';
import { AnalyticsCard, RankedBarChart, StatTile, useAnalyticsTheme } from './analyticsChartKit';

/**
 * Department Headcount Card
 * Employees per division, ranked, with the tail folded into "Other".
 *
 * The old card sorted divisions by headcount and then coloured them
 * `departmentColors[index % 8]` — colour by rank. That breaks the rule that colour
 * follows the entity: a division that gains two people and moves from 4th to 3rd
 * changes colour, and every division below it changes too, so a reader who learned
 * "Field Operations is orange" is misled by the next refresh. It also cycled a
 * fixed list, so a 9th division silently reused the 1st division's hue.
 *
 * Divisions are nominal and this is one series, so every bar wears slot 1 and no
 * hue carries information that bar length is not already carrying.
 *
 * @param {Object} props
 * @param {Array} props.data - Array of department headcount data
 * @param {boolean} props.loading - Loading state
 */
const DepartmentHeadcountCard = ({ data = [], loading = false }) => {
  const theme = useAnalyticsTheme();
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.employee_count || 0, 10), 0);
  const totalDepartments = data.length;

  const sortedData = [...data].sort(
    (a, b) => parseInt(b.employee_count || 0, 10) - parseInt(a.employee_count || 0, 10)
  );

  const topDepartments = sortedData.slice(0, 5);
  const otherDepartments = sortedData.slice(5);
  const othersCount = otherDepartments.reduce(
    (sum, item) => sum + parseInt(item.employee_count || 0, 10),
    0
  );

  // Fold the tail rather than grow the palette — a 9th hue is indistinguishable from
  // an existing one and would be doing no work here anyway.
  const chartData = [
    ...topDepartments.map((dept) => ({
      label: dept.division_name || 'Unassigned',
      value: parseInt(dept.employee_count || 0, 10),
      percentage: parseFloat(dept.percentage || 0),
    })),
    ...(otherDepartments.length > 0
      ? [{
          label: `Other (${otherDepartments.length})`,
          value: othersCount,
          percentage: totalEmployees > 0 ? (othersCount / totalEmployees) * 100 : 0,
        }]
      : []),
  ];

  const averagePerDepartment = totalDepartments > 0
    ? Math.round(totalEmployees / totalDepartments)
    : 0;

  return (
    <AnalyticsCard
      icon={Building2}
      accent={theme.series[0]}
      title="Department Headcount"
      subtitle={`${formatNumber(totalDepartments)} departments · ${formatNumber(totalEmployees)} employees`}
      loading={loading}
      isEmpty={sortedData.length === 0}
      emptyMessage="No department data available"
      emptyIcon={Building2}
      tableColumns={['Division', 'Employees', 'Share']}
      tableRows={sortedData.map((dept) => [
        dept.division_name || 'Unassigned',
        formatNumber(parseInt(dept.employee_count || 0, 10)),
        `${parseFloat(dept.percentage || 0).toFixed(1)}%`,
      ])}
      footer={
        <div className="grid grid-cols-2 gap-4">
          <StatTile label="Avg. per dept" value={formatNumber(averagePerDepartment)} theme={theme} />
          <StatTile
            label="Largest dept"
            value={formatNumber(parseInt(topDepartments[0]?.employee_count || 0, 10))}
            hint={topDepartments[0]?.division_name}
            theme={theme}
          />
        </div>
      }
    >
      <RankedBarChart
        data={chartData}
        theme={theme}
        seriesLabel="Employees"
        valueFormatter={formatNumber}
        labelWidth={136}
      />
    </AnalyticsCard>
  );
};

export default DepartmentHeadcountCard;
