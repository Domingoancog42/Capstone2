import React from 'react';
import { User } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const genderSeries = [
  { key: 'female', label: 'Female', color: '#ec4899' },
  { key: 'male', label: 'Male', color: '#3b82f6' },
  { key: 'other', label: 'Other', color: '#8b5cf6' },
  { key: 'notSpecified', label: 'Not Specified', color: '#94a3b8' },
];

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

const GenderDistributionCard = ({ data = [], divisionData = [], loading = false }) => {
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.count || 0, 10), 0);
  const chartData = divisionData.length > 0
    ? divisionData.map((division) => ({
        division: division.division_name || 'Unassigned',
        label: compactDivisionName(division.division_name),
        male: Number(division.male_count || 0),
        female: Number(division.female_count || 0),
        other: Number(division.other_count || 0),
        notSpecified: Number(division.not_specified_count || 0),
      }))
    : [{
        division: 'All Employees',
        label: 'All',
        male: countFromGenderRows(data, 'male'),
        female: countFromGenderRows(data, 'female'),
        other: data
          .filter((item) => !['male', 'female', 'not specified'].includes(String(item.gender || '').trim().toLowerCase()))
          .reduce((sum, item) => sum + Number(item.count || 0), 0),
        notSpecified: countFromGenderRows(data, 'not specified'),
      }];
  const hasChartData = chartData.some((item) => genderSeries.some((series) => Number(item[series.key] || 0) > 0));

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
          <div className="rounded-lg bg-purple-100 p-3">
            <User className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h3 className="m-0 text-lg font-semibold text-gray-800">Gender Distribution</h3>
            <p className="m-0 mt-1 text-sm text-gray-500">{totalEmployees} Total Employees</p>
          </div>
        </div>
      </div>

      <div className="flex-1">
        {!hasChartData ? (
          <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-gray-200 text-center text-gray-500">
            <div>
              <User className="mx-auto mb-2 h-12 w-12 text-gray-300" />
              <p className="m-0 text-sm font-medium">No gender data available</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-3">
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -28, bottom: 0 }} barCategoryGap={18}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#6b7280" />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: 'rgba(15, 118, 110, 0.06)' }}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.division || 'Division'}
                    formatter={(value, name) => [`${value} employees`, name]}
                    contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12 }}
                  />
                  {genderSeries.map((series) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.label}
                      stackId="gender"
                      fill={series.color}
                      radius={series.key === 'male' ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              {genderSeries.map((series) => (
                <div key={series.key} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: series.color }} />
                  <span>{series.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GenderDistributionCard;
