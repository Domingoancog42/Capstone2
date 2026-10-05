import React from 'react';
import { Clock, Users } from 'lucide-react';
import { formatNumber } from '../../module/reports/reportsTheme';
import { AnalyticsCard, Meter, StatTile, useAnalyticsTheme } from './analyticsChartKit';

/**
 * Senior Citizen Analytics Card
 * Headline counts plus the share of workforce aged 60+.
 *
 * The progress bar was `bg-gradient-to-r from-orange-500 to-amber-500`: a gradient
 * on a value mark, so the same bar length read as a different colour depending on
 * where the eye landed, and the track underneath was neutral grey. It is now a flat
 * fill with a track from the same ramp.
 *
 * The retirement notice keeps a status colour, which is correct here — it means
 * "needs attention", not "series 2" — and it ships with an icon and a label so the
 * meaning never rests on the colour alone.
 *
 * @param {Object} props
 * @param {Object} props.data - Senior citizen statistics
 * @param {boolean} props.loading - Loading state
 */
const SeniorCitizenCard = ({ data = {}, loading = false }) => {
  const theme = useAnalyticsTheme();
  const seniorCount = parseInt(data?.senior_count || 0, 10);
  const totalEmployees = parseInt(data?.total_employees || 0, 10);
  const seniorPercentage = parseFloat(data?.senior_percentage || 0);
  const upcomingRetirement = parseInt(data?.upcoming_retirement || 0, 10);

  return (
    <AnalyticsCard
      icon={Users}
      accent={theme.series[0]}
      title="Senior Citizens"
      subtitle="60+ years old"
      loading={loading}
      footer={
        <p className="m-0 text-xs text-slate-500 dark:text-slate-400">Retirement tracking</p>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <StatTile
            label="Total"
            value={formatNumber(seniorCount)}
            hint={`${seniorPercentage.toFixed(1)}% of workforce`}
            theme={theme}
          />
          <StatTile
            label="Upcoming"
            value={formatNumber(upcomingRetirement)}
            hint="Within 1 year"
            theme={theme}
          />
        </div>

        <Meter
          value={seniorCount}
          max={totalEmployees}
          theme={theme}
          label="Senior citizens"
          valueText={`${formatNumber(seniorCount)} / ${formatNumber(totalEmployees)}`}
        />

        {upcomingRetirement > 0 ? (
          <div
            className="flex items-start gap-2 rounded border-l-4 bg-slate-50 p-3 dark:bg-slate-800/60"
            style={{ borderLeftColor: theme.status.warning }}
          >
            <Clock
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: theme.status.warning }}
              aria-hidden="true"
            />
            <div>
              <p className="m-0 text-sm font-medium text-slate-900 dark:text-slate-100">
                Retirement planning
              </p>
              <p className="m-0 mt-1 text-xs text-slate-600 dark:text-slate-300">
                {formatNumber(upcomingRetirement)} employee{upcomingRetirement === 1 ? '' : 's'} approaching retirement age
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </AnalyticsCard>
  );
};

export default SeniorCitizenCard;
