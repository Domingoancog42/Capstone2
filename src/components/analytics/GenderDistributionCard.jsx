import React from 'react';
import { User } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber } from '../../module/reports/reportsTheme';
import {
  AnalyticsCard,
  AnalyticsLegend,
  AnalyticsTooltip,
  GENDER_SERIES,
  categoryAxisProps,
  useAnalyticsTheme,
  valueAxisProps,
} from './analyticsChartKit';

function compactDivisionName(value) {
  const text = String(value || 'Unassigned').trim();

  if (text.length <= 10) {
    return text;
  }

  const initials = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 6)
    .toUpperCase();

  return initials || `${text.slice(0, 9)}…`;
}

function countFromGenderRows(rows, genderName) {
  const match = rows.find((item) => String(item.gender || '').trim().toLowerCase() === genderName);
  return Number(match?.count || 0);
}

/**
 * Gender Distribution Card
 * Gender split per division, stacked.
 *
 * Categorical, with the hues coming from the shared slot order instead of a private
 * map — which also ended a collision: this card used to paint "Male" `#3b82f6` while
 * the employment card painted "Contract of Service" the same blue.
 *
 * Stacked segments are separated by a 2px gap in the surface colour, not by a stroke
 * drawn around each segment. Interior segments have no free end to label, so the
 * legend and tooltip carry identity and the table view keeps every value reachable
 * without hovering — which is also the relief the sub-3:1 light-mode steps require.
 */
const GenderDistributionCard = ({ data = [], divisionData = [], loading = false }) => {
  const theme = useAnalyticsTheme();
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.count || 0, 10), 0);

  const chartData = divisionData.length > 0
    ? divisionData.map((division) => ({
        division: division.division_name || 'Unassigned',
        label: compactDivisionName(division.division_name),
        male: Number(division.male_count || 0),
        female: Number(division.female_count || 0),
      }))
    : [{
        division: 'All Employees',
        label: 'All',
        male: countFromGenderRows(data, 'male'),
        female: countFromGenderRows(data, 'female'),
      }];

  const hasChartData = chartData.some((item) => GENDER_SERIES.some((series) => Number(item[series.key] || 0) > 0));

  const series = GENDER_SERIES.map((entry) => ({ ...entry, color: theme.series[entry.slot] }));

  /**
   * The rounded data-end belongs to the top of the whole stack, which differs per
   * row — an all-female division ends on "Female". Rounding one series unconditionally
   * would put a rounded cap in the middle of the stack.
   */
  const topSeriesKeyFor = (row) => {
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (Number(row[series[index].key] || 0) > 0) {
        return series[index].key;
      }
    }
    return null;
  };

  return (
    <AnalyticsCard
      icon={User}
      accent={theme.series[0]}
      title="Gender Distribution"
      subtitle={`${formatNumber(totalEmployees)} total employees`}
      loading={loading}
      isEmpty={!hasChartData}
      emptyMessage="No gender data available"
      emptyIcon={User}
      tableColumns={['Division', ...series.map((entry) => entry.label)]}
      tableRows={chartData.map((row) => [
        row.division,
        ...series.map((entry) => formatNumber(row[entry.key])),
      ])}
    >
      <div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={18}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis dataKey="label" {...categoryAxisProps(theme)} />
            <YAxis {...valueAxisProps(theme)} allowDecimals={false} width={40} />
            <Tooltip
              cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
              content={(
                <AnalyticsTooltip
                  theme={theme}
                  formatter={formatNumber}
                  labelFormatter={(label) => chartData.find((row) => row.label === label)?.division || label}
                />
              )}
            />
            {series.map((entry) => (
              <Bar
                key={entry.key}
                dataKey={entry.key}
                name={entry.label}
                stackId="gender"
                fill={entry.color}
                maxBarSize={24}
                // The 2px surface-coloured stroke is what reads as the gap between segments.
                stroke={theme.surface}
                strokeWidth={2}
                activeBar={{ fillOpacity: 0.82 }}
              >
                {chartData.map((row, index) => (
                  <Cell
                    key={`${entry.key}-${index}`}
                    radius={topSeriesKeyFor(row) === entry.key ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>

        <AnalyticsLegend items={series} theme={theme} />
      </div>
    </AnalyticsCard>
  );
};

export default GenderDistributionCard;
