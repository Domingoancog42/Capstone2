import React from 'react';
import { Users } from 'lucide-react';
import {
  ROLE_SLOTS,
  SERIES_SLOT_COUNT,
  assignEntitySlots,
  formatNumber,
  normalizeEntityKey,
} from '../../module/reports/reportsTheme';
import { AnalyticsCard, RankedBarChart, useAnalyticsTheme } from './analyticsChartKit';

/**
 * Role Distribution Analytics Card
 * Headcount per role, ranked.
 *
 * Was a six-slice pie on a private hex map. Two things were wrong with it. A pie
 * compares every slice against every other, so its palette had to clear the
 * all-pairs gate and did not: `#7c3aed` against `#2563eb` measured ΔE 0.4 under
 * deuteranopia — the same colour to that reader — and `#f97316` against `#ef4444`
 * measured 10.4 unsimulated, below the 15 floor where full-colour readers start to
 * struggle too. Past three series no ordering of any eight-hue palette clears
 * all-pairs, so the fix is the form, not the colours.
 *
 * Each role keeps its own hue so it stays identifiable at a glance and across screens.
 * The hue is pinned to the role's name — the built-in roles have fixed slots and any
 * custom role HR adds takes the next free one — so a role that gains staff keeps its
 * colour and so do the roles around it.
 *
 * The bars sit in slot order rather than ranked by headcount, and that ordering is
 * load-bearing, not cosmetic. Colour-gating depends on which bars can end up next to
 * each other: in slot order only consecutive slots ever touch, which is the adjacent
 * pairlist the eight-slot order clears (worst adjacent CVD ΔE 9.1 light / 8.4 dark).
 * Re-sorting by headcount would let any two slots become neighbours, which is the
 * all-pairs pairlist — and that fails at six classes (`#008300` vs `#eb6834` measures
 * ΔE 3.2 under protanopia). Ranked order and per-role colour cannot both be had; the
 * ranking is still legible from the bar lengths, and a fixed order has its own merit
 * on a dashboard you read repeatedly, since the rows stop moving between refreshes.
 *
 * @param {Object} props
 * @param {Array} props.data - Array of role distribution data
 * @param {boolean} props.loading - Loading state
 */
const RoleDistributionCard = ({ data = [], loading = false }) => {
  const theme = useAnalyticsTheme();
  const totalUsers = data.reduce((sum, item) => sum + parseInt(item.count || 0, 10), 0);

  const roleSlots = assignEntitySlots(
    data.map((role) => role.role_name || 'Unassigned'),
    ROLE_SLOTS
  );

  const chartData = [...data]
    .map((role) => {
      const label = role.role_name || 'Unassigned';
      const slot = roleSlots.get(normalizeEntityKey(label));

      return {
        label,
        value: Number(role.count || 0),
        percentage: Number(role.percentage || 0),
        // Past the eighth role, fall back to the muted token rather than invent a ninth hue.
        slot: slot === null || slot === undefined ? SERIES_SLOT_COUNT : slot,
        color: slot === null || slot === undefined ? theme.textMuted : theme.series[slot],
      };
    })
    .sort((a, b) => a.slot - b.slot || b.value - a.value);

  return (
    <AnalyticsCard
      icon={Users}
      accent={theme.series[0]}
      title="Role Distribution"
      subtitle={`${formatNumber(totalUsers)} total users`}
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No role data available"
      emptyIcon={Users}
      tableColumns={['Role', 'Users', 'Share']}
      tableRows={chartData.map((row) => [
        row.label,
        formatNumber(row.value),
        `${row.percentage.toFixed(1)}%`,
      ])}
      footer={
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Updated just now</span>
        </div>
      }
    >
      {/*
        No legend: this is one series, and the y-axis already names every bar. A legend here would
        reprint the same six labels beside the chart. Colour reinforces identity; the axis text
        carries it, so nothing rests on colour alone.
      */}
      <RankedBarChart
        data={chartData}
        theme={theme}
        seriesLabel="Users"
        valueFormatter={formatNumber}
        labelWidth={120}
      />
    </AnalyticsCard>
  );
};

export default RoleDistributionCard;
