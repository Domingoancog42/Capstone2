import React from 'react';
import { Briefcase, TrendingUp } from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

/**
 * Employment Status Distribution Card
 * Displays the distribution of employees by employment status.
 *
 * @param {Object} props
 * @param {Array} props.data - Array of employment status data
 * @param {boolean} props.loading - Loading state
 */
const EmploymentStatusCard = ({ data = [], loading = false }) => {
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.count || 0), 0);
  const statusColors = {
    Regular: '#16a34a',
    Permanent: '#16a34a',
    Contractual: '#3b82f6',
    Casual: '#8b5cf6',
    'Not Specified': '#9ca3af',
  };
  const fallbackColors = ['#0f9f8f', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6'];
  const chartData = data.map((status, index) => ({
    status: status.employment_status || 'Not Specified',
    count: Number(status.count || 0),
    percentage: Number(status.percentage || 0),
    color: statusColors[status.employment_status] || fallbackColors[index % fallbackColors.length],
  }));

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-4 shadow-md">
        <div className="mb-4 h-6 w-1/2 rounded bg-gray-200" />
        <div className="h-52 rounded bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-4 shadow-md transition-shadow duration-300 hover:shadow-lg">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-green-100 p-3">
            <Briefcase className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h3 className="m-0 text-lg font-semibold text-gray-800">Employment Status</h3>
            <p className="m-0 mt-1 text-sm text-gray-500">{totalEmployees} Total Employees</p>
          </div>
        </div>
        <TrendingUp className="h-5 w-5 text-green-500" />
      </div>

      <div className="flex-1">
        {data.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-gray-200 text-center text-gray-500">
            <div>
              <Briefcase className="mx-auto mb-2 h-12 w-12 text-gray-300" />
              <p className="m-0 text-sm font-medium">No employment status data available</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-3">
            <div className="h-[185px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value, name, item) => [
                      `${value} employees (${Number(item?.payload?.percentage || 0).toFixed(1)}%)`,
                      item?.payload?.status || 'Employment Status',
                    ]}
                    contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }}
                  />
                  <Pie
                    data={chartData}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={78}
                    stroke="#ffffff"
                    strokeWidth={2}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`${entry.status}-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {chartData.map((entry, index) => (
                <div key={`${entry.status}-legend-${index}`} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: entry.color }} />
                  <span>{entry.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmploymentStatusCard;
