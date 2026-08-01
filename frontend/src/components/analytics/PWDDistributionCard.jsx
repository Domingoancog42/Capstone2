import React from 'react';
import { Heart, Users } from 'lucide-react';

/**
 * PWD (Persons with Disability) Distribution Card
 * Displays PWD statistics and distribution across divisions
 *
 * @param {Object} props
 * @param {Array} props.data - Array of PWD distribution by division
 * @param {Object} props.summary - Summary statistics
 * @param {boolean} props.loading - Loading state
 */
const PWDDistributionCard = ({ data = [], summary = {}, loading = false }) => {
  const pwdCount = parseInt(summary?.pwd_count || 0, 10);
  const totalEmployees = parseInt(summary?.total_employees || 0, 10);
  const pwdPercentage = parseFloat(summary?.pwd_percentage || 0);

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-6 shadow-md">
        <div className="mb-4 h-6 w-1/2 rounded bg-gray-200" />
        <div className="mb-4 h-20 rounded bg-gray-100" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-6 shadow-md transition-shadow duration-300 hover:shadow-lg">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-teal-100 p-3">
            <Heart className="h-6 w-6 text-teal-600" />
          </div>
          <div>
            <h3 className="m-0 text-lg font-semibold text-gray-800">PWD Status</h3>
            <p className="m-0 mt-1 text-sm text-gray-500">Persons with Disability</p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-lg bg-gradient-to-r from-teal-50 to-cyan-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="m-0 text-3xl font-bold text-teal-700">{pwdCount}</p>
            <p className="m-0 text-sm text-gray-600">PWD Employees</p>
          </div>
          <div className="text-right">
            <p className="m-0 text-2xl font-semibold text-teal-600">{pwdPercentage.toFixed(1)}%</p>
            <p className="m-0 text-xs text-gray-500">of {totalEmployees} total</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Distribution by Division</h4>
        {data.length === 0 ? (
          <div className="py-4 text-center text-gray-500">
            <Users className="mx-auto mb-2 h-10 w-10 text-gray-300" />
            <p className="m-0 text-sm">No PWD data available</p>
          </div>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {data.map((division, index) => {
              const divisionPwdPercent = parseFloat(division.pwd_percentage || 0);

              return (
                <div key={index} className="rounded-lg bg-gray-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-gray-700">
                      {division.division_name}
                    </span>
                    <span className="text-sm font-semibold text-teal-600">
                      {division.pwd_count}/{division.total_employees}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-teal-500 transition-all duration-500"
                      style={{ width: `${Math.min(divisionPwdPercent, 100)}%` }}
                    />
                  </div>
                  <p className="m-0 mt-1 text-xs text-gray-500">
                    {divisionPwdPercent.toFixed(1)}% of division
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Inclusivity metrics</span>
        </div>
      </div>
    </div>
  );
};

export default PWDDistributionCard;
