import React from 'react';
import { Heart, Users } from 'lucide-react';
import { formatNumber } from '../../module/reports/reportsTheme';
import { AnalyticsCard, Meter, StatTile, useAnalyticsTheme } from './analyticsChartKit';

/**
 * PWD (Persons with Disability) Distribution Card
 *
 * No chart library here — the card is a headline ratio plus one meter per division,
 * which is the right form: a single ratio against a limit is a meter, not a
 * two-slice pie.
 *
 * Two things changed. The meter track was neutral grey against a teal fill; it is
 * now a light step of the fill's own ramp, so the state reads across the whole bar
 * instead of only the filled part. And the headline numbers were painted
 * `text-teal-700` / `text-teal-600` — text wearing the data colour. Values and
 * labels now use text tokens; the coloured mark beside them carries identity.
 *
 * @param {Object} props
 * @param {Array} props.data - Array of PWD distribution by division
 * @param {Object} props.summary - Summary statistics
 * @param {boolean} props.loading - Loading state
 */
const PWDDistributionCard = ({ data = [], summary = {}, loading = false }) => {
  const theme = useAnalyticsTheme();
  const pwdCount = parseInt(summary?.pwd_count || 0, 10);
  const totalEmployees = parseInt(summary?.total_employees || 0, 10);
  const pwdPercentage = parseFloat(summary?.pwd_percentage || 0);

  return (
    <AnalyticsCard
      icon={Heart}
      accent={theme.series[0]}
      title="PWD Status"
      subtitle="Persons with Disability"
      loading={loading}
      tableColumns={['Division', 'PWD', 'Total', 'Share']}
      tableRows={data.map((division) => [
        division.division_name || 'Unassigned',
        formatNumber(parseInt(division.pwd_count || 0, 10)),
        formatNumber(parseInt(division.total_employees || 0, 10)),
        `${parseFloat(division.pwd_percentage || 0).toFixed(1)}%`,
      ])}
      footer={
        <p className="m-0 text-xs text-slate-500 dark:text-slate-400">Inclusivity metrics</p>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <StatTile
            label="PWD employees"
            value={formatNumber(pwdCount)}
            hint={`of ${formatNumber(totalEmployees)} total`}
            theme={theme}
          />
          <StatTile
            label="Share of workforce"
            value={`${pwdPercentage.toFixed(1)}%`}
            theme={theme}
          />
        </div>

        <div>
          <h4 className="m-0 mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
            Distribution by division
          </h4>

          {data.length === 0 ? (
            <div className="py-4 text-center text-slate-500 dark:text-slate-400">
              <Users className="mx-auto mb-2 h-10 w-10 text-slate-300 dark:text-slate-600" aria-hidden="true" />
              <p className="m-0 text-sm">No PWD data available</p>
            </div>
          ) : (
            <div className="max-h-56 space-y-4 overflow-y-auto pr-1">
              {data.map((division, index) => {
                const divisionPwdPercent = parseFloat(division.pwd_percentage || 0);

                return (
                  <Meter
                    key={`${division.division_name || 'division'}-${index}`}
                    value={divisionPwdPercent}
                    max={100}
                    theme={theme}
                    label={division.division_name || 'Unassigned'}
                    valueText={`${formatNumber(parseInt(division.pwd_count || 0, 10))}/${formatNumber(
                      parseInt(division.total_employees || 0, 10)
                    )}`}
                    hint={`${divisionPwdPercent.toFixed(1)}% of division`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AnalyticsCard>
  );
};

export default PWDDistributionCard;
