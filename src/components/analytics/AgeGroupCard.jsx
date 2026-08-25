import React from 'react';
import { Users } from 'lucide-react';
import { formatNumber } from '../../module/reports/reportsTheme';
import { AnalyticsCard, CategoryColumnChart, StatTile, useAnalyticsTheme } from './analyticsChartKit';

/** Canonical band order. The bands are ordinal — swapping two of them changes the meaning. */
const AGE_BAND_ORDER = ['18-25', '26-35', '36-45', '46-55', '56-65', '65+', 'Unknown'];

const AGE_BAND_MIDPOINTS = {
  '18-25': 21.5,
  '26-35': 30.5,
  '36-45': 40.5,
  '46-55': 50.5,
  '56-65': 60.5,
  '65+': 67,
};

const getAgeGroupMidpoint = (ageGroup) => AGE_BAND_MIDPOINTS[ageGroup] || 0;

/**
 * Age Distribution Card
 *
 * Was a donut painted `#10b981 → #0f9f8f → #155e75 → #facc15 → #f59e0b → #f97316`:
 * a rainbow across a scale that has a real order, so the colours implied a sequence
 * the hues do not actually carry (aqua does not read as "before" yellow).
 *
 * Ordered categories normally take a one-hue ordinal ramp so the order is visible
 * in the colour. That is not available here: the ramp needs ΔL ≥ 0.06 between
 * adjacent steps while the lightest step still clears 2:1 on the surface, and
 * between those two constraints the blue ramp fits **five** steps. There are six
 * age bands (seven with Unknown). Rather than fold two real bands together to suit
 * the palette, the order moves to the axis — bands run left to right in sequence —
 * and one hue does identity. Column, not bar, because the band labels are short and
 * the left-to-right reading is the point.
 */
const AgeGroupCard = ({ data = [], loading = false }) => {
  const theme = useAnalyticsTheme();
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.count || 0, 10), 0);
  const weightedAgeSum = data.reduce(
    (sum, item) => sum + getAgeGroupMidpoint(item.age_group) * parseInt(item.count || 0, 10),
    0
  );
  const averageAge = totalEmployees > 0 ? (weightedAgeSum / totalEmployees).toFixed(1) : '0.0';

  const chartData = [...data]
    .map((group) => ({
      label: group.age_group || 'Unknown',
      value: Number(group.count || 0),
      percentage: Number(group.percentage || 0),
    }))
    .sort((a, b) => {
      const left = AGE_BAND_ORDER.indexOf(a.label);
      const right = AGE_BAND_ORDER.indexOf(b.label);
      return (left === -1 ? AGE_BAND_ORDER.length : left) - (right === -1 ? AGE_BAND_ORDER.length : right);
    });

  return (
    <AnalyticsCard
      icon={Users}
      accent={theme.series[0]}
      title="Age Distribution"
      subtitle={`Average age ${averageAge} years`}
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No age group data available"
      emptyIcon={Users}
      tableColumns={['Age group', 'Employees', 'Share']}
      tableRows={chartData.map((row) => [
        row.label,
        formatNumber(row.value),
        `${row.percentage.toFixed(1)}%`,
      ])}
    >
      <div className="space-y-4">
        <StatTile
          label="Total employees"
          value={formatNumber(totalEmployees)}
          hint={`Across ${chartData.length} age band${chartData.length === 1 ? '' : 's'}`}
          theme={theme}
        />
        <CategoryColumnChart
          data={chartData}
          theme={theme}
          seriesLabel="Employees"
          valueFormatter={formatNumber}
        />
      </div>
    </AnalyticsCard>
  );
};

export default AgeGroupCard;
