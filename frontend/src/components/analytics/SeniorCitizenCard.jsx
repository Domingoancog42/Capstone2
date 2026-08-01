import React from 'react';
import { Users, Clock } from 'lucide-react';

/**
 * Senior Citizen Analytics Card
 * Displays statistics about senior citizen employees (60+ years)
 * 
 * @param {Object} props
 * @param {Object} props.data - Senior citizen statistics
 * @param {boolean} props.loading - Loading state
 */
const SeniorCitizenCard = ({ data = {}, loading = false }) => {
  const seniorCount = parseInt(data?.senior_count || 0);
  const totalEmployees = parseInt(data?.total_employees || 0);
  const seniorPercentage = parseFloat(data?.senior_percentage || 0);
  const upcomingRetirement = parseInt(data?.upcoming_retirement || 0);

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-6 shadow-md">
        <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div className="h-24 bg-gray-100 rounded"></div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-6 shadow-md transition-shadow duration-300 hover:shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-orange-100 rounded-lg">
            <Users className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Senior Citizens</h3>
            <p className="text-sm text-gray-500">60+ years old</p>
          </div>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <Users className="w-5 h-5 text-orange-500" />
            <span className="text-xs font-medium text-gray-500">TOTAL</span>
          </div>
          <p className="text-3xl font-bold text-orange-700">{seniorCount}</p>
          <p className="text-sm text-gray-600 mt-1">
            {seniorPercentage.toFixed(1)}% of workforce
          </p>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-5 h-5 text-amber-500" />
            <span className="text-xs font-medium text-gray-500">UPCOMING</span>
          </div>
          <p className="text-3xl font-bold text-amber-700">{upcomingRetirement}</p>
          <p className="text-sm text-gray-600 mt-1">Within 1 year</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Senior Citizens</span>
          <span className="font-medium text-gray-700">
            {seniorCount} / {totalEmployees}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-gradient-to-r from-orange-500 to-amber-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(seniorPercentage, 100)}%` }}
          ></div>
        </div>
      </div>

      {/* Info Box */}
      {upcomingRetirement > 0 && (
        <div className="mt-4 p-3 bg-amber-50 border-l-4 border-amber-400 rounded">
          <div className="flex items-start space-x-2">
            <Clock className="w-4 h-4 text-amber-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Retirement Planning</p>
              <p className="text-xs text-amber-700 mt-1">
                {upcomingRetirement} employee{upcomingRetirement !== 1 ? 's' : ''} approaching retirement age
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Retirement tracking</span>
          <button className="hidden text-orange-600 hover:text-orange-700 font-medium">
            View Details →
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeniorCitizenCard;
