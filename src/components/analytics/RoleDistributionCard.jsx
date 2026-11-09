import React from "react";
import { Users } from "lucide-react";
import {
  ROLE_SLOTS,
  SERIES_SLOT_COUNT,
  assignEntitySlots,
  formatNumber,
  normalizeEntityKey,
} from "../../module/reports/reportsTheme";
import {
  AnalyticsCard,
  DistributionPieChart,
  useAnalyticsTheme,
} from "./analyticsChartKit";

/**
 * Headcount per role as a part-to-whole donut. The center and breakdown values
 * count into place, while the centered role names and counts below keep the
 * chart readable without relying on color alone.
 */
const RoleDistributionCard = ({ data = [], loading = false }) => {
  const theme = useAnalyticsTheme();

  const roleSlots = assignEntitySlots(
    data.map((role) => role.role_name || "Unassigned"),
    ROLE_SLOTS
  );

  const chartData = [...data]
    .map((role) => {
      const label = role.role_name || "Unassigned";
      const slot = roleSlots.get(normalizeEntityKey(label));

      return {
        label,
        value: Number(role.count || 0),
        // Past the eighth role, use the muted token instead of inventing another hue.
        slot: slot === null || slot === undefined ? SERIES_SLOT_COUNT : slot,
        color: slot === null || slot === undefined ? theme.textMuted : theme.series[slot],
      };
    })
    .filter((role) => role.value > 0)
    .sort((a, b) => a.slot - b.slot || b.value - a.value);

  return (
    <AnalyticsCard
      icon={Users}
      accent={theme.series[0]}
      title="Role Distribution"
      loading={loading}
      isEmpty={chartData.length === 0}
      emptyMessage="No role data available"
      emptyIcon={Users}
    >
      <DistributionPieChart
        data={chartData}
        theme={theme}
        valueFormatter={formatNumber}
        height={220}
        donut
        centerLabel="Total Distribution"
        showPercentages={false}
        legendLayout="centered-row"
        animateValues
      />
    </AnalyticsCard>
  );
};

export default RoleDistributionCard;
