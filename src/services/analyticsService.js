import api from "./api";

const getAnalytics = async (type, params = {}) => {
  const response = await api.get("/analytics.php", {
    params: {
      type,
      ...params,
    },
  });

  return response.data;
};

export const fetchAllAnalytics = () => getAnalytics("all");
export const fetchDashboardAnalytics = (year = new Date().getFullYear()) => (
  getAnalytics("dashboard", { year })
);
export const fetchRoleDistribution = () => getAnalytics("role_distribution");
export const fetchEmploymentStatus = () => getAnalytics("employment_status");
export const fetchAttendanceTrend = (days = 30) => getAnalytics("attendance_trend", { days });
export const fetchPerformanceManagement = (year = new Date().getFullYear()) => (
  getAnalytics("performance_management", { year })
);
export const fetchPWDDistribution = () => getAnalytics("pwd_distribution");
export const fetchGenderDistribution = () => getAnalytics("gender_distribution");
export const fetchSeniorCitizenData = () => getAnalytics("senior_citizen");
export const fetchAgeGroupDistribution = () => getAnalytics("age_group");
export const fetchDepartmentHeadcount = () => getAnalytics("department_headcount");
export const fetchLeaveUtilization = () => getAnalytics("leave_utilization");
export const fetchPayrollSummary = () => getAnalytics("payroll_summary");
export const fetchSummaryStatistics = () => getAnalytics("summary");

const analyticsService = {
  fetchAllAnalytics,
  fetchDashboardAnalytics,
  fetchRoleDistribution,
  fetchEmploymentStatus,
  fetchAttendanceTrend,
  fetchPerformanceManagement,
  fetchPWDDistribution,
  fetchGenderDistribution,
  fetchSeniorCitizenData,
  fetchAgeGroupDistribution,
  fetchDepartmentHeadcount,
  fetchLeaveUtilization,
  fetchPayrollSummary,
  fetchSummaryStatistics,
};

export default analyticsService;
