import React from 'react';
import { Building2, Users } from 'lucide-react';

/**
 * Department Headcount Card
 * Displays employee distribution across departments/divisions
 * 
 * @param {Object} props
 * @param {Array} props.data - Array of department headcount data
 * @param {boolean} props.loading - Loading state
 */
const DepartmentHeadcountCard = ({ data = [], loading = false }) => {
  const totalEmployees = data.reduce((sum, item) => sum + parseInt(item.employee_count || 0), 0);
  const totalDepartments = data.length;

  // Color palette for departments
  const departmentColors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-teal-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-red-500',
  ];

  const getColorClass = (index) => {
    return departmentColors[index % departmentColors.length];
  };

  if (loading) {
    return (
      <div className="h-full min-h-[360px] animate-pulse rounded-lg bg-white p-4 shadow-md">
        <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-gray-100 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  // Sort by employee count (descending)
  const sortedData = [...data].sort((a, b) => 
    parseInt(b.employee_count || 0) - parseInt(a.employee_count || 0)
  );

  // Get top 5 and calculate "Others"
  const topDepartments = sortedData.slice(0, 5);
  const otherDepartments = sortedData.slice(5);
  const othersCount = otherDepartments.reduce((sum, d) => sum + parseInt(d.employee_count || 0), 0);

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-lg bg-white p-4 shadow-md transition-shadow duration-300 hover:shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Building2 className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Department Headcount</h3>
            <p className="text-sm text-gray-500">
              {totalDepartments} Departments • {totalEmployees} Employees
            </p>
          </div>
        </div>
      </div>

      {/* Department List */}
      <div className="flex-1 space-y-4">
        {sortedData.length === 0 ? (
          <div className="text-center text-gray-500 py-5">
            <Building2 className="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>No department data available</p>
          </div>
        ) : (
          <>
            {/* Top Departments */}
            <div className="space-y-3">
              {topDepartments.map((dept, index) => {
                const percentage = parseFloat(dept.percentage || 0);
                return (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <div className={`w-3 h-3 ${getColorClass(index)} rounded flex-shrink-0`}></div>
                        <span className="font-medium text-gray-700 truncate" title={dept.division_name}>
                          {dept.division_name}
                        </span>
                        {dept.division_code && (
                          <span className="text-xs text-gray-400">({dept.division_code})</span>
                        )}
                      </div>
                      <span className="text-gray-600 font-medium ml-2 flex-shrink-0">
                        {dept.employee_count}
                      </span>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`${getColorClass(index)} h-2 rounded-full transition-all duration-500`}
                        style={{ width: `${Math.min(percentage, 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{percentage.toFixed(1)}% of total workforce</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Others section if there are more than 5 departments */}
            {otherDepartments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">
                      Other Departments ({otherDepartments.length})
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-gray-600">
                    {othersCount} employees
                  </span>
                </div>
              </div>
            )}

            {/* Summary Stats */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center bg-blue-50 rounded-lg p-3">
                  <p className="text-lg font-bold text-blue-700">
                    {(totalEmployees / totalDepartments).toFixed(0)}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Avg. per Dept</p>
                </div>
                <div className="text-center bg-green-50 rounded-lg p-3">
                  <p className="text-lg font-bold text-green-700">
                    {topDepartments[0]?.employee_count || 0}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Largest Dept</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {sortedData.length > 0 && (
        <div className="mt-auto pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Organizational structure</span>
            <button className="hidden text-blue-600 hover:text-blue-700 font-medium">
              View All Departments →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DepartmentHeadcountCard;
