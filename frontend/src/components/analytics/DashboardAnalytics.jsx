import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, AlertCircle } from 'lucide-react';
import RoleDistributionCard from './RoleDistributionCard';
import EmploymentStatusCard from './EmploymentStatusCard';
import PWDDistributionCard from './PWDDistributionCard';
import GenderDistributionCard from './GenderDistributionCard';
import SeniorCitizenCard from './SeniorCitizenCard';
import AgeGroupCard from './AgeGroupCard';
import AttendanceTrendCard from './AttendanceTrendCard';
import { fetchAllAnalytics } from '../../services/analyticsService';

/**
 * Main Dashboard Analytics Container
 * Orchestrates all analytics cards and data fetching
 */
const DashboardAnalytics = ({ embedded = false, showHeader = true, children = null }) => {
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadAnalytics = async () => {
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
  };

  useEffect(() => {
    loadAnalytics();

    const intervalId = window.setInterval(loadAnalytics, 5 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

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
    if (!analyticsData) {
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

    rows.push(['Summary', 'Total Employees', analyticsData.total_employees || 0, '']);
    rows.push(['Summary', 'Active Users', analyticsData.total_active_users || 0, '']);
    rows.push(['Summary', 'Average Age', analyticsData.average_age || 0, '']);
    addRows('Role Distribution', analyticsData.role_distribution, 'role_name', 'count');
    addRows('Employment Status', analyticsData.employment_status, 'employment_status', 'count');
    addRows('Gender Distribution', analyticsData.gender_distribution, 'gender', 'count');
    addRows('Gender by Division', analyticsData.gender_by_division, 'division_name', 'total_employees', '');
    addRows('Age Group', analyticsData.age_group, 'age_group', 'count');

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
                disabled={loading}
                className="flex items-center space-x-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                onClick={handleExport}
                disabled={!analyticsData || loading}
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
      {!loading && analyticsData && !embedded && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">Total Employees</p>
            <p className="text-lg font-bold">{analyticsData.total_employees || 0}</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-green-500 to-green-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">Active Users</p>
            <p className="text-lg font-bold">{analyticsData.total_active_users || 0}</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">Average Age</p>
            <p className="text-lg font-bold">{analyticsData.average_age || 0} yrs</p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 p-4 text-white">
            <p className="text-sm opacity-90 mb-2">PWD Employees</p>
            <p className="text-lg font-bold">{analyticsData.pwd_summary?.pwd_count || 0}</p>
          </div>
        </div>
      )}

      {/* Analytics Cards Grid */}
      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* Role Distribution */}
        <RoleDistributionCard 
          data={analyticsData?.role_distribution || []} 
          loading={loading}
        />

        {/* Employment Status */}
        <EmploymentStatusCard 
          data={analyticsData?.employment_status || []} 
          loading={loading}
        />

        {/* Gender Distribution */}
        <GenderDistributionCard 
          data={analyticsData?.gender_distribution || []} 
          divisionData={analyticsData?.gender_by_division || []}
          loading={loading}
        />

        {/* Age Group Distribution */}
        <AgeGroupCard 
          data={analyticsData?.age_group || []} 
          loading={loading}
        />

        <AttendanceTrendCard
          data={analyticsData?.attendance_trend || []}
          loading={loading}
        />

        {/* PWD Distribution */}
        <PWDDistributionCard 
          data={analyticsData?.pwd_distribution || []} 
          summary={analyticsData?.pwd_summary || {}}
          loading={loading}
        />

        {/* Senior Citizen */}
        <SeniorCitizenCard 
          data={analyticsData?.senior_citizen || {}} 
          loading={loading}
        />

        {children}
      </div>

    </section>
  );
};

export default DashboardAnalytics;
