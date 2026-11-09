import React from 'react';
import { Briefcase } from 'lucide-react';
import { formatNumber } from '../../module/reports/reportsTheme';
import { AnalyticsCard, RankedBarChart, useAnalyticsTheme } from './analyticsChartKit';

/**
 * Employment Status Distribution Card
 * Headcount per employment status, ranked.
 *
 * Was a pie whose private hex map painted "Regular" in `#16a34a` — a status green
 * on a series that carries identity, not health. Status colours are reserved for
 * good/warning/serious/critical and always ship with an icon and a label; using
 * one for "series 1" teaches the reader a meaning the chart does not have.
 *
 * Employment status is nominal and this is one series, so every bar wears slot 1.
 *
 * @param {Object} props
 * @param {Array} props.data - Array of employment status data
 * @param {boolean} props.loading - Loading state
 */
const EmploymentStatusCard = ({ data = [], loading = false }) => {
  const theme = useAnalyticsTheme();

  const chartData = [...data]
    .map((status) => ({
      label: status.employment_status || 'Not Specified',
      value: Number(status.count || 0),
      percentage: Number(status.percentage || 0),
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <AnalyticsCard
      icon={Briefcase}
      accent={theme.series[0]}
      title="Employment Status"
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No employment status data available"
      emptyIcon={Briefcase}
      tableColumns={['Status', 'Employees', 'Share']}
      tableRows={chartData.map((row) => [
        row.label,
        formatNumber(row.value),
        `${row.percentage.toFixed(1)}%`,
      ])}
    >
      <RankedBarChart
        data={chartData}
        theme={theme}
        seriesLabel="Employees"
        valueFormatter={formatNumber}
        labelWidth={140}
      />
    </AnalyticsCard>
  );
};

export default EmploymentStatusCard;
