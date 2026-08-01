import React from 'react';
import { Users, TrendingUp } from 'lucide-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { numberFormatter } from "../../utils/format";

const ageGroupColors = {
  '18-25': '#10b981',
  '26-35': '#0f9f8f',
  '36-45': '#155e75',
  '46-55': '#facc15',
  '56-65': '#f59e0b',
  '65+': '#f97316',
  Unknown: '#94a3b8',
};

const fallbackColors = ['#0f9f8f', '#155e75', '#facc15', '#f97316', '#8b5cf6', '#ec4899'];

const getAgeGroupMidpoint = (ageGroup) => {
  const midpoints = {
    '18-25': 21.5,
    '26-35': 30.5,
    '36-45': 40.5,
    '46-55': 50.5,
    '56-65': 60.5,
    '65+': 67,
  };

  return midpoints[ageGroup] || 0;
};

const AgeGroupCard = ({ data = [], loading = false }) => {
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.count || 0, 10), 0);
  const weightedAgeSum = data.reduce((sum, item) => {
    return sum + (getAgeGroupMidpoint(item.age_group) * parseInt(item.count || 0, 10));
  }, 0);
  const averageAge = totalEmployees > 0 ? (weightedAgeSum / totalEmployees).toFixed(1) : 0;
  const chartData = data.map((group, index) => ({
    ageGroup: group.age_group || 'Unknown',
    count: Number(group.count || 0),
    percentage: Number(group.percentage || 0),
    color: ageGroupColors[group.age_group] || fallbackColors[index % fallbackColors.length],
  }));

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-6 shadow-md">
        <div className="mb-4 h-6 w-1/2 rounded bg-gray-200" />
        <div className="h-52 rounded bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-6 shadow-md transition-shadow duration-300 hover:shadow-lg">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-indigo-100 p-3">
            <Users className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h3 className="m-0 text-lg font-semibold text-gray-800">Age Distribution</h3>
            <p className="m-0 mt-1 text-sm text-gray-500">Avg. age: {averageAge} years</p>
          </div>
        </div>
        <TrendingUp className="h-5 w-5 text-indigo-500" />
      </div>

      <div className="flex-1">
        {data.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-gray-200 text-center text-gray-500">
            <div>
              <Users className="mx-auto mb-2 h-12 w-12 text-gray-300" />
              <p className="m-0 text-sm font-medium">No age group data available</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-3">
            <div className="relative h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value, name, item) => [
                      `${numberFormatter.format(value)} employees (${Number(item?.payload?.percentage || 0).toFixed(1)}%)`,
                      item?.payload?.ageGroup || 'Age Group',
                    ]}
                    contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }}
                  />
                  <Pie
                    data={chartData}
                    dataKey="count"
                    nameKey="ageGroup"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={88}
                    stroke="#ffffff"
                    strokeWidth={2}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`${entry.ageGroup}-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="m-0 text-3xl font-bold text-gray-900">{numberFormatter.format(totalEmployees)}</p>
                  <p className="m-0 text-xs text-gray-500">employees</p>
                </div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              {chartData.map((entry, index) => (
                <div key={`${entry.ageGroup}-legend-${index}`} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: entry.color }} />
                  <span>{entry.ageGroup}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgeGroupCard;
