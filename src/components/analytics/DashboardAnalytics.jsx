import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, AlertCircle } from 'lucide-react';
import RoleDistributionCard from './RoleDistributionCard';
import EmploymentStatusCard from './EmploymentStatusCard';
import GenderDistributionCard from './GenderDistributionCard';
import AttendanceTrendCard from './AttendanceTrendCard';
import PerformanceManagementCard from './PerformanceManagementCard';
import { fetchAllAnalytics } from '../../services/analyticsService';

/**
 * Main Dashboard Analytics Container
 * Orchestrates all analytics cards and data fetching
 */
const DashboardAnalytics = ({
  embedded = false,
  showHeader = true,
  children = null,
  data,
  loading: externalLoading,
  onRefresh,
}) => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const usesExternalData = data !== undefined;

  const loadAnalytics = useCallback(async () => {
    if (usesExternalData) {
      return onRefresh?.();
    }

    try {
      setLoading(true);
      setError(null);
      
      const response = await fetchAllAnalytics();
      
      if (response.success) {
        setAnalyticsData(response.data);
        setLastUpdated(new Date());
      } else {
        setError('Failed to load analytics data');
      }
    } catch (err) {
      console.error('Error loading analytics:', err);
      setError('Unable to connect to analytics service');
    } finally {
      setLoading(false);
    }
  }, [onRefresh, usesExternalData]);

  useEffect(() => {
    if (usesExternalData) {
      return undefined;
    }

    loadAnalytics();

    const intervalId = window.setInterval(loadAnalytics, 5 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [loadAnalytics, usesExternalData]);

  const resolvedAnalyticsData = usesExternalData ? data : analyticsData;
  const resolvedLoading = usesExternalData ? Boolean(externalLoading) : loading;

  const formatLastUpdated = () => {
    if (!lastUpdated) return 'Never';
    
    const now = new Date();
    const diffMs = now - lastUpdated;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return '1 hour ago';
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    return lastUpdated.toLocaleString();
  };

  const handleExport = () => {
    if (!resolvedAnalyticsData) {
      return;
    }

    const rows = [['Metric', 'Label', 'Count', 'Percentage']];
    const addRows = (metric, records, labelKey, countKey, percentageKey = 'percentage') => {
      (records || []).forEach((record) => {
        rows.push([
          metric,
          record[labelKey] ?? '',
          record[countKey] ?? '',
          record[percentageKey] ?? '',
        ]);
      });
    };

    rows.push(['Summary', 'Total Employees', resolvedAnalyticsData.total_employees || 0, '']);
    rows.push(['Summary', 'Active Users', resolvedAnalyticsData.total_active_users || 0, '']);
    rows.push(['Summary', 'Average Age', resolvedAnalyticsData.average_age || 0, '']);
    addRows('Role Distribution', resolvedAnalyticsData.role_distribution, 'role_name', 'count');
    addRows('Employment Status', resolvedAnalyticsData.employment_status, 'employment_status', 'count');
    addRows('Gender Distribution', resolvedAnalyticsData.gender_distribution, 'gender', 'count');
    addRows('Gender by Division', resolvedAnalyticsData.gender_by_division, 'division_name', 'total_employees', '');
    addRows('Age Group', resolvedAnalyticsData.age_group, 'age_group', 'count');

    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={embedded ? "space-y-4" : "space-y-4"}>
      {showHeader ? (
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="m-0 text-xl font-bold text-gray-800">
                {embedded ? 'Workforce Analytics' : 'Dashboard Analytics'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Last updated: {formatLastUpdated()}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={loadAnalytics}
                disabled={resolvedLoading}
                className="flex items-center space-x-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${resolvedLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                onClick={handleExport}
                disabled={!resolvedAnalyticsData || resolvedLoading}
                className="flex items-center space-x-2 rounded-lg bg-gray-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-red-400 mr-3" />
            <div>
              <p className="text-sm font-medium text-red-800">Error Loading Analytics</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Summary Stats Row */}
      {!resolvedLoading && resolvedAnalyticsData && !embedded && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">Total Employees</p>
            <p className="text-lg font-bold">{resolvedAnalyticsData.total_employees || 0}</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-green-500 to-green-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">Active Users</p>
            <p className="text-lg font-bold">{resolvedAnalyticsData.total_active_users || 0}</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">Average Age</p>
            <p className="text-lg font-bold">{resolvedAnalyticsData.average_age || 0} yrs</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">PWD Employees</p>
            <p className="text-lg font-bold">{resolvedAnalyticsData.pwd_summary?.pwd_count || 0}</p>
          </div>
        </div>
      )}

      {/* Two-column desktop layout; each inner grid preserves the requested card order. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="grid grid-cols-1 items-stretch gap-4">
          <PerformanceManagementCard
            data={resolvedAnalyticsData?.performance_management || {}}
            loading={resolvedLoading}
          />

          <EmploymentStatusCard
            data={resolvedAnalyticsData?.employment_status || []}
            loading={resolvedLoading}
          />
        </div>

        <div className="grid grid-cols-1 items-stretch gap-4">
          <AttendanceTrendCard
            data={resolvedAnalyticsData?.attendance_trend || []}
            loading={resolvedLoading}
          />

          <RoleDistributionCard
            data={resolvedAnalyticsData?.role_distribution || []}
            loading={resolvedLoading}
          />
        </div>
      </div>

      {children ? (
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          <GenderDistributionCard
            data={resolvedAnalyticsData?.gender_distribution || []}
            divisionData={resolvedAnalyticsData?.gender_by_division || []}
            loading={resolvedLoading}
          />

          {children}
        </div>
      ) : (
        <GenderDistributionCard
          data={resolvedAnalyticsData?.gender_distribution || []}
          divisionData={resolvedAnalyticsData?.gender_by_division || []}
          loading={resolvedLoading}
        />
      )}

    </section>
  );
};

export default DashboardAnalytics;
