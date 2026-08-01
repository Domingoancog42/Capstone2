import React from 'react';
import { Users, TrendingUp } from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

/**
 * Role Distribution Analytics Card
 * Displays the distribution of users across different roles
 * 
 * @param {Object} props
 * @param {Array} props.data - Array of role distribution data
 * @param {boolean} props.loading - Loading state
 */
const RoleDistributionCard = ({ data = [], loading = false }) => {
  const totalUsers = data.reduce((sum, item) => sum + parseInt(item.count || 0), 0);
  const roleColors = {
    Admin: '#ef4444',
    HRHead: '#2563eb',
    'HR Head': '#2563eb',
    HRStaff: '#06b6d4',
    'HR Staff': '#06b6d4',
    Employee: '#22c55e',
    RegionalDirector: '#7c3aed',
    'Regional Director': '#7c3aed',
    Chief: '#f97316',
  };
  const fallbackColors = ['#0f9f8f', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6', '#84cc16'];
  const chartData = data.map((role, index) => ({
    role: role.role_name || 'Unassigned',
    count: Number(role.count || 0),
    percentage: Number(role.percentage || 0),
    color: roleColors[role.role_name] || fallbackColors[index % fallbackColors.length],
  }));

  const renderCountLabel = ({ cx, cy, midAngle, outerRadius, value }) => {
    const radians = (Math.PI / 180) * -midAngle;
    const x = cx + (outerRadius + 28) * Math.cos(radians);
    const y = cy + (outerRadius + 28) * Math.sin(radians);

    return (
      <text
        x={x}
        y={y}
        fill="#111827"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={500}
      >
        {value}
      </text>
    );
  };

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-6 shadow-md">
        <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-6 shadow-md transition-shadow duration-300 hover:shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Role Distribution</h3>
            <p className="text-sm text-gray-500">{totalUsers} Total Users</p>
          </div>
        </div>
        <TrendingUp className="w-5 h-5 text-green-500" />
      </div>

      {/* Role Pie Chart */}
      <div className="flex-1">
        {data.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <Users className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>No role data available</p>
          </div>
        ) : (
          <div className="h-[220px] rounded-lg border border-gray-100 bg-white px-2 py-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 12, right: 44, bottom: 12, left: 44 }}>
                <Tooltip
                  formatter={(value, name, item) => [
                    `${value} users (${Number(item?.payload?.percentage || 0).toFixed(1)}%)`,
                    item?.payload?.role || 'Role',
                  ]}
                  contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }}
                />
                <Pie
                  data={chartData}
                  dataKey="count"
                  nameKey="role"
                  cx="50%"
                  cy="50%"
                  outerRadius={82}
                  label={renderCountLabel}
                  labelLine={false}
                  stroke="#ffffff"
                  strokeWidth={2}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`${entry.role}-${index}`}
                      fill={entry.color}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Footer */}
      {data.length > 0 && (
        <div className="mt-auto pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Updated just now</span>
            <button className="hidden text-blue-600 hover:text-blue-700 font-medium">
              View Details →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleDistributionCard;
