-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 06, 2026 at 06:56 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

SET FOREIGN_KEY_CHECKS = 0;

--
-- Database: `hris`
--

--
-- Drop every table first so this dump can be re-imported over an existing
-- `hris` database. Without this the import aborts on the first
-- "#1050 Table already exists" error and later tables (`users` included)
-- are never created. All drops must happen before any CREATE TABLE, because
-- the primary keys below are added by ALTER TABLE at the end of this file --
-- dropping and recreating tables one by one would leave dangling foreign
-- keys and fail with "#1005 errno: 150".
--

DROP TABLE IF EXISTS `allowance`, `announcements`, `attendance_adjustments`, `attendance_daily_records`, `attendance_deductions`, `attendance_logs`, `audit_logs`, `backup_history`, `cash_advance_requests`, `compensatory`, `designations`, `divisions`, `division_opcr_assignments`, `employee_children`, `employee_education_background`, `employee_family_background`, `employeededuction`, `employees`, `gsis_deductions`, `holidays`, `ipcr`, `ipcr_verification_files`, `leave_attachments`, `leave_credits`, `leave_monetization_requests`, `leave_requests`, `leave_types`, `loan_records`, `messages`, `module_access_requests`, `notifications`, `opcr_templates`, `other_deductions`, `overtime`, `pagibig_deductions`, `pass_slip`, `profile_edit_requests`, `payroll`, `payrollapproval`, `payrolldeduction`, `payrollmeta`, `phic_deductions`, `rate_limits`, `reward_certificates`, `reward_certificate_sequence`, `reward_cycles`, `reward_cycle_votes`, `roles`, `service_record_print_requests`, `service_records`, `settings`, `travel_orders`, `users`, `withholding_tax_deductions`;

-- --------------------------------------------------------

--
-- Table structure for table `allowance`
--

CREATE TABLE `allowance` (
  `allowance_id` int(11) NOT NULL,
  `allowance_name` varchar(50) NOT NULL,
  `amount` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `allowance`
--

INSERT INTO `allowance` (`allowance_id`, `allowance_name`, `amount`) VALUES
(1, 'PERA', 2000.00),
(2, 'PRATA', 1500.00),
(3, 'MA', 1000.00),
(4, 'CA', 800.00),
(5, 'SA', 1200.00);

-- --------------------------------------------------------

--
-- Table structure for table `announcements`
--

CREATE TABLE `announcements` (
  `id` int(10) UNSIGNED NOT NULL,
  `title` varchar(200) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `description` text DEFAULT NULL,
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `attendance_adjustments`
--

CREATE TABLE `attendance_adjustments` (
  `id` int(10) UNSIGNED NOT NULL,
  `attendance_daily_record_id` int(10) UNSIGNED DEFAULT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `attendance_date` date NOT NULL,
  `requested_time_in` datetime DEFAULT NULL,
  `requested_time_out` datetime DEFAULT NULL,
  `reason` text NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `requested_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `attendance_daily_records`
--

CREATE TABLE `attendance_daily_records` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `attendance_date` date NOT NULL,
  `time_in` datetime DEFAULT NULL,
  `time_out` datetime DEFAULT NULL,
  `total_minutes` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `late_minutes` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `undertime_minutes` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `status` varchar(30) NOT NULL DEFAULT 'Incomplete',
  `source` enum('import','manual','adjusted') NOT NULL DEFAULT 'import',
  `updated_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `attendance_deductions`
--

CREATE TABLE `attendance_deductions` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `calculation_type` enum('fixed','percentage','tiered','bracket') NOT NULL DEFAULT 'fixed',
  `default_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `default_rate` decimal(12,8) NOT NULL DEFAULT 0.00000000,
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `threshold_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `threshold_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`threshold_rules`)),
  `base_floor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_cap` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_payroll` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `attendance_deductions`
--

INSERT INTO `attendance_deductions` (`id`, `code`, `name`, `description`, `calculation_type`, `default_amount`, `default_rate`, `basis`, `threshold_amount`, `threshold_rules`, `base_floor`, `base_cap`, `is_recurring`, `is_active`, `show_in_payroll`, `sort_order`, `created_at`, `updated_at`) VALUES
(31, 'late_deduction', 'Late Deduction', 'Tardiness, charged per hour late. One hour is 0.56818182% of monthly salary, from the DBM Budget Circular 004-03 rate of monthly salary / 22 days / 8 hours. CSC rules allow no offsetting of tardiness against extra hours worked.', 'percentage', 0.00, 0.56818182, 'per_hour', 0.00, NULL, 0.00, NULL, 0, 1, 1, 310, '2026-07-29 06:31:28', '2026-07-29 12:40:33'),
(32, 'absence_deduction', 'Absence Deduction', 'Absence without pay, charged per day. One day is 4.54545455% of monthly salary, the DBM Budget Circular 004-03 daily rate of monthly salary / 22 days. Applies only to days not covered by an approved leave credit.', 'percentage', 0.00, 4.54545455, 'per_day', 0.00, NULL, 0.00, NULL, 0, 1, 1, 320, '2026-07-29 06:31:28', '2026-07-29 12:40:33'),
(33, 'undertime_deduction', 'Undertime Deduction', 'Undertime — leaving before the end of the shift — charged per hour on the same DBM Budget Circular 004-03 hourly rate as tardiness, 0.56818182% of monthly salary per hour.', 'percentage', 0.00, 0.56818182, 'per_hour', 0.00, NULL, 0.00, NULL, 0, 1, 1, 330, '2026-07-29 06:31:28', '2026-07-29 12:40:33');

-- --------------------------------------------------------

--
-- Table structure for table `attendance_logs`
--

CREATE TABLE `attendance_logs` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `punch_at` datetime NOT NULL,
  `punch_type` enum('time_in','time_out') NOT NULL,
  `raw_state` varchar(20) DEFAULT NULL,
  `source` varchar(50) NOT NULL DEFAULT 'csv',
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_logs`
--

CREATE TABLE `audit_logs` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `action` varchar(150) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `device` varchar(120) DEFAULT NULL,
  `browser` varchar(120) DEFAULT NULL,
  `os` varchar(120) DEFAULT NULL,
  `actor_id` int(10) UNSIGNED DEFAULT NULL,
  `actor_name` varchar(255) DEFAULT NULL,
  `actor_role` varchar(100) DEFAULT NULL,
  `category` varchar(80) DEFAULT NULL,
  `entity_type` varchar(100) DEFAULT NULL,
  `entity_id` varchar(100) DEFAULT NULL,
  `summary` text DEFAULT NULL,
  `details_json` longtext DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `audit_logs`
--

INSERT INTO `audit_logs` (`id`, `user_id`, `action`, `ip_address`, `location`, `device`, `browser`, `os`, `actor_id`, `actor_name`, `actor_role`, `category`, `entity_type`, `entity_id`, `summary`, `details_json`, `user_agent`, `created_at`) VALUES
(1, NULL, 'login.failed', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', NULL, NULL, NULL, 'auth', 'login_identifier', 'admin@gmail.com', 'A login attempt failed for an unknown account.', '{\"identifier\":\"admin@gmail.com\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:55:16'),
(2, 1, 'login.failed', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A login attempt failed.', '{\"username\":\"admin\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:56:46'),
(3, 1, 'login.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A user signed in successfully.', '{\"username\":\"admin\",\"two_factor\":false,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:56:53'),
(4, 1, 'employee.imported', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'Employees were imported from CSV.', '{\"summary\":{\"totalRows\":51,\"created\":51,\"userAccountsCreated\":51,\"duplicatesSkipped\":0,\"invalidRows\":0},\"createdIds\":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51],\"createdUserIds\":[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:57:26'),
(5, 1, 'logout.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A user signed out.', '{\"username\":\"admin\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:58:06'),
(6, 2, 'login.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 2, 'louisse.kaye.aba@gmail.com', 'Employee', 'auth', 'user', '2', 'A user signed in successfully.', '{\"username\":\"louisse.kaye.aba@gmail.com\",\"two_factor\":false,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:58:14'),
(7, 2, 'password.force_change_completed', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 2, 'louisse.kaye.aba@gmail.com', 'Employee', 'auth', 'user', '2', 'A required password change was completed.', '{\"username\":\"louisse.kaye.aba@gmail.com\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:58:46'),
(8, 2, 'logout.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 2, 'louisse.kaye.aba@gmail.com', 'Employee', 'auth', 'user', '2', 'A user signed out.', '{\"username\":\"louisse.kaye.aba@gmail.com\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:59:48'),
(9, 1, 'login.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A user signed in successfully.', '{\"username\":\"admin\",\"two_factor\":false,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 03:59:53'),
(10, 1, 'logout.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A user signed out.', '{\"username\":\"admin\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:00:21'),
(11, 5, 'login.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 5, 'gerald.baclayon@gmail.com', 'HRHead', 'auth', 'user', '5', 'A user signed in successfully.', '{\"username\":\"gerald.baclayon@gmail.com\",\"two_factor\":false,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:00:25'),
(12, 5, 'password.force_change_completed', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 5, 'gerald.baclayon@gmail.com', 'HRHead', 'auth', 'user', '5', 'A required password change was completed.', '{\"username\":\"gerald.baclayon@gmail.com\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:04:29'),
(13, 1, 'login.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A user signed in successfully.', '{\"username\":\"admin\",\"two_factor\":false,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:05:49'),
(14, 2, 'login.failed', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Microsoft Edge', 'Windows 11', 2, 'louisse.kaye.aba@gmail.com', 'Employee', 'auth', 'user', '2', 'A login attempt failed.', '{\"username\":\"louisse.kaye.aba@gmail.com\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0', '2026-08-06 04:07:16'),
(15, 2, 'login.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Microsoft Edge', 'Windows 11', 2, 'louisse.kaye.aba@gmail.com', 'Employee', 'auth', 'user', '2', 'A user signed in successfully.', '{\"username\":\"louisse.kaye.aba@gmail.com\",\"two_factor\":false,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0', '2026-08-06 04:07:23'),
(16, 5, 'leave_credit.deduct', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 5, 'Gerald C. Baclayon', 'HRHead', 'leave_credit', 'employee', '1', 'Deducted 15 day(s) from Vacation Leave balance for Louisse Kaye P. Aba.', '{\"employeeId\":\"EMP2026-0001\",\"employeeName\":\"Louisse Kaye P. Aba\",\"leaveTypeCode\":\"VL\",\"leaveTypeName\":\"Vacation Leave\",\"operation\":\"deduct\",\"adjustmentAmount\":15,\"year\":2026,\"effectiveDate\":\"2026-08-06\",\"remarks\":\"\",\"previousRemaining\":15,\"newRemaining\":0,\"usedCredits\":0,\"totalCredits\":0,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:17:06'),
(17, 5, 'leave_credit.add', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 5, 'Gerald C. Baclayon', 'HRHead', 'leave_credit', 'employee', '1', 'Added 5 day(s) to Vacation Leave balance for Louisse Kaye P. Aba.', '{\"employeeId\":\"EMP2026-0001\",\"employeeName\":\"Louisse Kaye P. Aba\",\"leaveTypeCode\":\"VL\",\"leaveTypeName\":\"Vacation Leave\",\"operation\":\"add\",\"adjustmentAmount\":5,\"year\":2026,\"effectiveDate\":\"2026-08-06\",\"remarks\":\"\",\"previousRemaining\":0,\"newRemaining\":5,\"usedCredits\":0,\"totalCredits\":5,\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:17:20'),
(18, 1, 'logout.success', '2001:4455:476:6900:59e:2e51:5b69:227c', 'Cagayan de Oro, Northern Mindanao, Philippines', 'Desktop', 'Chrome', 'Windows 11', 1, 'admin', 'Admin', 'auth', 'user', '1', 'A user signed out.', '{\"username\":\"admin\",\"network\":{\"ip\":\"2001:4455:476:6900:59e:2e51:5b69:227c\",\"network\":\"2001:4455:476::/48\",\"version\":\"IPv6\",\"city\":\"Cagayan de Oro\",\"region\":\"Northern Mindanao\",\"country\":\"PH\",\"country_name\":\"Philippines\",\"postal\":\"9000\",\"latitude\":8.483659,\"longitude\":124.650003,\"timezone\":\"Asia/Manila\",\"utc_offset\":\"+0800\",\"asn\":\"AS9299\",\"org\":\"Philippine Long Distance Telephone Co.\",\"detected_request_ip\":\"127.0.0.1\",\"ip_resolution\":\"localhost_public_ip_fallback\"}}', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', '2026-08-06 04:48:55');

-- --------------------------------------------------------

--
-- Table structure for table `backup_history`
--

CREATE TABLE `backup_history` (
  `id` int(10) UNSIGNED NOT NULL,
  `backup_type` enum('Manual','Automatic') NOT NULL DEFAULT 'Manual',
  `file_name` varchar(255) NOT NULL,
  `file_path` text NOT NULL,
  `file_size` bigint(20) UNSIGNED NOT NULL DEFAULT 0,
  `status` enum('Completed','Failed','Deleted') NOT NULL DEFAULT 'Completed',
  `error_message` text DEFAULT NULL,
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `backup_history`
--

INSERT INTO `backup_history` (`id`, `backup_type`, `file_name`, `file_path`, `file_size`, `status`, `error_message`, `created_by_user_id`, `created_at`, `deleted_at`, `updated_at`) VALUES
(1, 'Automatic', 'hris-backup-automatic-hris-20260727-060748.sql', 'C:\\xampp\\htdocs\\Capstone2\\frontend\\backend\\backups\\hris-backup-automatic-hris-20260727-060748.sql', 2383255, 'Completed', NULL, NULL, '2026-07-27 11:48:00', NULL, '2026-07-27 04:07:49'),
(2, 'Manual', 'hris-backup-manual-hris-20260728-051424.sql', 'C:\\xampp\\htdocs\\Capstone2\\frontend\\backend\\backups\\hris-backup-manual-hris-20260728-051424.sql', 3179035, 'Completed', NULL, 1, '2026-07-27 11:48:00', NULL, '2026-07-28 03:14:24');

-- --------------------------------------------------------

--
-- Table structure for table `cash_advance_requests`
--

CREATE TABLE `cash_advance_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `cash_advance_amount` decimal(12,2) NOT NULL,
  `request_date` date NOT NULL,
  `purpose` varchar(255) DEFAULT NULL,
  `deduction_notes` text DEFAULT NULL,
  `status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `approved_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `compensatory`
--

CREATE TABLE `compensatory` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `hours_applied` decimal(4,2) NOT NULL,
  `unpaid_hours` decimal(8,2) NOT NULL DEFAULT 0.00,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('Pending','Endorsed','Reviewed','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  `approved_by` int(10) UNSIGNED DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `rejected_note` text DEFAULT NULL,
  `endorsed_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `endorsed_at` timestamp NULL DEFAULT NULL,
  `reviewed_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `approved_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `designations`
--

CREATE TABLE `designations` (
  `id` int(10) UNSIGNED NOT NULL,
  `division_id` int(10) UNSIGNED NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `designations`
--

INSERT INTO `designations` (`id`, `division_id`, `name`, `is_archived`, `created_at`) VALUES
(1, 1, 'System Administrator', 0, '2026-07-25 05:36:50'),
(2, 2, 'Accountant', 0, '2026-07-25 05:36:50'),
(3, 2, 'Accounting Clerk', 0, '2026-07-25 05:36:50'),
(4, 2, 'Accounting supervisor', 0, '2026-07-25 05:36:50'),
(5, 2, 'Administrative aide', 0, '2026-07-25 05:36:50'),
(6, 2, 'Administrative assistant', 0, '2026-07-25 05:36:50'),
(7, 2, 'Administrative Assistant I', 0, '2026-07-25 05:36:50'),
(8, 2, 'Administrative Assistant II', 0, '2026-07-25 05:36:50'),
(9, 2, 'Administrative Assistant III', 0, '2026-07-25 05:36:50'),
(10, 2, 'Chief administrative officer', 0, '2026-07-25 05:36:50'),
(11, 2, 'HR Officer', 0, '2026-07-25 05:36:50'),
(12, 2, 'Hr staff', 0, '2026-07-25 05:36:50'),
(13, 2, 'Support Staff', 0, '2026-07-25 05:36:50'),
(14, 3, 'Administrative Assistant I', 0, '2026-07-25 05:36:50'),
(15, 3, 'Cartographer II', 0, '2026-07-25 05:36:50'),
(16, 3, 'Division chief', 0, '2026-07-25 05:36:50'),
(17, 3, 'Engineer', 0, '2026-07-25 05:36:50'),
(18, 3, 'Field Staff', 0, '2026-07-25 05:36:50'),
(19, 3, 'Science Research Specialist II', 0, '2026-07-25 05:36:50'),
(20, 3, 'Unit Head', 0, '2026-07-25 05:36:50'),
(21, 4, 'Administrative Assistant I', 0, '2026-07-25 05:36:50'),
(22, 4, 'division chief', 0, '2026-07-25 05:36:50'),
(23, 4, 'Engineer', 0, '2026-07-25 05:36:50'),
(24, 4, 'Engineer V', 0, '2026-07-25 05:36:50'),
(25, 4, 'field staff', 0, '2026-07-25 05:36:50'),
(26, 4, 'unit head', 0, '2026-07-25 05:36:50'),
(27, 5, 'Administrative Assistant I', 0, '2026-07-25 05:36:50'),
(28, 5, 'division chief', 0, '2026-07-25 05:36:50'),
(29, 5, 'Engineer', 0, '2026-07-25 05:36:50'),
(30, 5, 'Engineer V', 0, '2026-07-25 05:36:50'),
(31, 5, 'field staff', 0, '2026-07-25 05:36:50'),
(32, 5, 'unit head', 0, '2026-07-25 05:36:50'),
(33, 6, 'administrative assistant', 0, '2026-07-25 05:36:50'),
(34, 6, 'Administrative Assistant I', 0, '2026-07-25 05:36:50'),
(35, 6, 'assistant regional director', 0, '2026-07-25 05:36:50'),
(36, 6, 'OIC Regional Director', 0, '2026-07-25 05:36:50'),
(37, 6, 'regional director', 0, '2026-07-25 05:36:50'),
(38, 6, 'support staff', 0, '2026-07-25 05:36:50');

-- --------------------------------------------------------

--
-- Table structure for table `divisions`
--

CREATE TABLE `divisions` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `code` varchar(20) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `divisions`
--

INSERT INTO `divisions` (`id`, `name`, `description`, `is_archived`, `code`, `created_at`, `updated_at`) VALUES
(1, 'Administration', NULL, 0, 'ADMIN', '2026-07-25 05:36:50', '2026-07-25 05:36:50'),
(2, 'Finance & Administrative Management', NULL, 0, 'FAM', '2026-07-25 05:36:50', '2026-07-25 05:36:50'),
(3, 'Geosciences', NULL, 0, 'GEOSCI', '2026-07-25 05:36:50', '2026-07-25 05:36:50'),
(4, 'Mine Management Division', NULL, 0, 'MMD', '2026-07-25 05:36:50', '2026-07-25 05:36:50'),
(5, 'Mine Safety, Environment and Social Development Division', NULL, 0, 'MSESDD', '2026-07-25 05:36:50', '2026-07-25 05:36:50'),
(6, 'Office of the Regional Director', NULL, 0, 'ORD', '2026-07-25 05:36:50', '2026-07-25 05:36:50');

-- --------------------------------------------------------

--
-- Table structure for table `division_opcr_assignments`
--

CREATE TABLE `division_opcr_assignments` (
  `assignment_id` int(10) UNSIGNED NOT NULL,
  `opcr_no` varchar(50) NOT NULL,
  `template_id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED DEFAULT NULL,
  `division` varchar(150) NOT NULL,
  `period` varchar(100) NOT NULL,
  `semester` varchar(50) NOT NULL,
  `prepared_by` varchar(150) NOT NULL,
  `budget` decimal(12,2) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `actual_accomplishment` text DEFAULT NULL,
  `assignment_status` varchar(50) NOT NULL DEFAULT 'Assigned',
  `approved_by` varchar(150) DEFAULT NULL,
  `final_rating` decimal(5,2) DEFAULT NULL,
  `q1_rating` decimal(5,2) DEFAULT NULL,
  `e2_rating` decimal(5,2) DEFAULT NULL,
  `t3_rating` decimal(5,2) DEFAULT NULL,
  `a4_rating` decimal(5,2) DEFAULT NULL,
  `mode_of_verification_name` varchar(255) DEFAULT NULL,
  `mode_of_verification_path` varchar(500) DEFAULT NULL,
  `mode_of_verification_size` int(10) UNSIGNED DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `division_opcr_assignments`
--

INSERT INTO `division_opcr_assignments` (`assignment_id`, `opcr_no`, `template_id`, `employee_id`, `division`, `period`, `semester`, `prepared_by`, `budget`, `remarks`, `actual_accomplishment`, `assignment_status`, `approved_by`, `final_rating`, `q1_rating`, `e2_rating`, `t3_rating`, `a4_rating`, `mode_of_verification_name`, `mode_of_verification_path`, `mode_of_verification_size`, `submitted_at`, `is_archived`, `created_at`, `updated_at`) VALUES
(1, 'OPCR-20260726-3621', 1, NULL, 'Administration', 'FY 2026', '1st Semester', 'admin', NULL, 'asd', 'sad', 'Rated', NULL, 2.00, 2.00, 2.00, 2.00, 2.00, NULL, NULL, NULL, '2026-07-26 07:19:33', 0, '2026-07-25 23:19:23', '2026-07-25 23:19:33');

-- --------------------------------------------------------

--
-- Table structure for table `employeededuction`
--

CREATE TABLE `employeededuction` (
  `employee_deduction_id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `deduction_type_id` int(10) UNSIGNED NOT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `rate` decimal(9,4) DEFAULT NULL,
  `calculation_type` varchar(20) NOT NULL DEFAULT 'fixed',
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `frequency` varchar(30) NOT NULL DEFAULT 'monthly',
  `effective_start` date DEFAULT NULL,
  `effective_end` date DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 1,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `employees`
--

CREATE TABLE `employees` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` varchar(50) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) NOT NULL,
  `suffix` varchar(20) DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `province` varchar(100) DEFAULT NULL,
  `zip_code` varchar(20) DEFAULT NULL,
  `gender` varchar(30) DEFAULT NULL,
  `email` varchar(150) NOT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `profile_image` varchar(255) DEFAULT NULL,
  `e_signature` longtext DEFAULT NULL,
  `division_id` int(10) UNSIGNED NOT NULL,
  `designation_id` int(10) UNSIGNED NOT NULL,
  `basic_salary` decimal(12,2) DEFAULT NULL,
  `salary_rate` varchar(50) DEFAULT NULL,
  `date_hired` date DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'Active',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `employment_status` varchar(50) DEFAULT NULL,
  `pwd` tinyint(1) NOT NULL DEFAULT 0,
  `civil_status` varchar(50) DEFAULT NULL,
  `spouse_name` varchar(150) DEFAULT NULL,
  `spouse_occupation` varchar(150) DEFAULT NULL,
  `father_name` varchar(150) DEFAULT NULL,
  `mother_name` varchar(150) DEFAULT NULL,
  `highest_education` varchar(150) DEFAULT NULL,
  `school_name` varchar(180) DEFAULT NULL,
  `education_course` varchar(180) DEFAULT NULL,
  `year_graduated` varchar(20) DEFAULT NULL,
  `emergency_contact_name` varchar(150) DEFAULT NULL,
  `emergency_contact_relationship` varchar(100) DEFAULT NULL,
  `emergency_contact_phone` varchar(30) DEFAULT NULL,
  `emergency_contact_address` varchar(255) DEFAULT NULL,
  `height` decimal(5,2) DEFAULT NULL,
  `weight` decimal(5,2) DEFAULT NULL,
  `blood_type` varchar(20) DEFAULT NULL,
  `emp_gsis_id_no` varchar(50) DEFAULT NULL,
  `emp_pagibig_id_no` varchar(50) DEFAULT NULL,
  `emp_philhealth_id_no` varchar(50) DEFAULT NULL,
  `tin_no` varchar(50) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `employees`
--

INSERT INTO `employees` (`id`, `employee_id`, `first_name`, `middle_name`, `last_name`, `date_of_birth`, `address`, `city`, `province`, `zip_code`, `gender`, `email`, `phone`, `profile_image`, `e_signature`, `division_id`, `designation_id`, `basic_salary`, `salary_rate`, `date_hired`, `status`, `is_archived`, `employment_status`, `pwd`, `civil_status`, `spouse_name`, `spouse_occupation`, `father_name`, `mother_name`, `highest_education`, `school_name`, `education_course`, `year_graduated`, `emergency_contact_name`, `emergency_contact_relationship`, `emergency_contact_phone`, `emergency_contact_address`, `height`, `weight`, `blood_type`, `emp_gsis_id_no`, `emp_pagibig_id_no`, `emp_philhealth_id_no`, `tin_no`, `created_at`, `updated_at`) VALUES
(1, 'EMP2026-0001', 'Louisse Kaye', 'P.', 'Aba', '1973-02-02', 'Barangay 02, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'louisse.kaye.aba@gmail.com', '09700000001', NULL, NULL, 2, 2, 28000.00, 'Monthly', '2013-02-02', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.51, 49.00, 'A-', 'GSIS-2026-000001', 'PAGIBIG-2026-000001', 'PHIC-2026-000001', '100000001', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(2, 'EMP2026-0002', 'Joanne Rose', 'O.', 'Alvarez', '1974-03-03', 'Barangay 03, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'joanne.rose.alvarez@gmail.com', '09700000002', NULL, NULL, 3, 14, 29250.00, 'Monthly', '2014-03-03', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.52, 50.00, 'B+', 'GSIS-2026-000002', 'PAGIBIG-2026-000002', 'PHIC-2026-000002', '100000002', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(3, 'EMP2026-0003', 'Joy Christine', 'V.', 'Asis', '1975-04-04', 'Barangay 04, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'joy.christine.asis@gmail.com', '09700000003', NULL, NULL, 4, 21, 20250.00, 'Semi-monthly', '2025-04-04', 'Active', 0, 'Contract of Service', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.53, 51.00, 'B-', 'GSIS-2026-000003', 'PAGIBIG-2026-000003', 'PHIC-2026-000003', '100000003', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(4, 'EMP2026-0004', 'Gerald', 'C.', 'Baclayon', '1976-05-05', 'Barangay 05, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'gerald.baclayon@gmail.com', '09700000004', NULL, NULL, 2, 11, 62000.00, 'Monthly', '2016-05-05', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.54, 52.00, 'AB+', 'GSIS-2026-000004', 'PAGIBIG-2026-000004', 'PHIC-2026-000004', '100000004', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(5, 'EMP2026-0005', 'Anshawer', 'D.', 'Bara-acal', '1977-06-06', 'Barangay 06, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'anshawer.bara-acal@gmail.com', '09700000005', NULL, NULL, 5, 27, 33000.00, 'Monthly', '2017-06-06', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.55, 53.00, 'AB-', 'GSIS-2026-000005', 'PAGIBIG-2026-000005', 'PHIC-2026-000005', '100000005', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(6, 'EMP2026-0006', 'Brenz Ryan', 'B.', 'Bautista', '1978-07-07', 'Barangay 07, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'brenz.ryan.bautista@gmail.com', '09700000006', NULL, NULL, 6, 33, 22500.00, 'Semi-monthly', '2024-07-07', 'Active', 0, 'Contract of Service', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.56, 54.00, 'O+', 'GSIS-2026-000006', 'PAGIBIG-2026-000006', 'PHIC-2026-000006', '100000006', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(7, 'EMP2026-0007', 'Jeaneth Ann', 'C.', 'Bonavente', '1979-08-08', 'Barangay 08, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'jeaneth.ann.bonavente@gmail.com', '09700000007', NULL, NULL, 3, 16, 75000.00, 'Monthly', '2019-08-08', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.57, 55.00, 'O-', 'GSIS-2026-000007', 'PAGIBIG-2026-000007', 'PHIC-2026-000007', '100000007', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(8, 'EMP2026-0008', 'Lea Therese', 'N.', 'Bondad', '1980-09-09', 'Barangay 09, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'lea.therese.bondad@gmail.com', '09700000008', NULL, NULL, 2, 3, 36750.00, 'Monthly', '2020-09-09', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.58, 56.00, 'A+', 'GSIS-2026-000008', 'PAGIBIG-2026-000008', 'PHIC-2026-000008', '100000008', '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(9, 'EMP2026-0009', 'Earl Ven Kirby', 'M.', 'Budiongan', '1981-10-10', 'Barangay 10, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'earl.ven.kirby.budiongan@gmail.com', '09700000009', NULL, NULL, 3, 15, 18750.00, 'Semi-monthly', '2023-10-10', 'Active', 0, 'Contract of Service', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.59, 57.00, 'A-', 'GSIS-2026-000009', 'PAGIBIG-2026-000009', 'PHIC-2026-000009', '100000009', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(10, 'EMP2026-0010', 'Quinne Marie', 'T.', 'Buhawe', '1982-11-11', 'Barangay 11, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'quinne.marie.buhawe@gmail.com', '09700000010', NULL, NULL, 4, 23, 39250.00, 'Monthly', '2022-11-11', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.60, 58.00, 'B+', 'GSIS-2026-000010', 'PAGIBIG-2026-000010', 'PHIC-2026-000010', '100000010', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(11, 'EMP2026-0011', 'Lemuel', 'C.', 'Cabahit', '1983-12-12', 'Barangay 12, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'lemuel.cabahit@gmail.com', '09700000011', NULL, NULL, 5, 29, 40500.00, 'Monthly', '2023-12-12', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.61, 59.00, 'B-', 'GSIS-2026-000011', 'PAGIBIG-2026-000011', 'PHIC-2026-000011', '100000011', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(12, 'EMP2026-0012', 'Almira Mae', 'C.', 'Cainglet', '1984-01-13', 'Barangay 13, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'almira.mae.cainglet@gmail.com', '09700000012', NULL, NULL, 2, 12, 38000.00, 'Monthly', '2012-01-13', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.62, 60.00, 'AB+', 'GSIS-2026-000012', 'PAGIBIG-2026-000012', 'PHIC-2026-000012', '100000012', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(13, 'EMP2026-0013', 'Lazaro IV', 'F.', 'Cajegas', '1985-02-14', 'Barangay 14, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'lazaro.iv.cajegas@gmail.com', '09700000013', NULL, NULL, 6, 34, 28000.00, 'Monthly', '2013-02-14', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.63, 61.00, 'AB-', 'GSIS-2026-000013', 'PAGIBIG-2026-000013', 'PHIC-2026-000013', '100000013', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(14, 'EMP2026-0014', 'Gay', 'P.', 'Callanta', '1986-03-15', 'Barangay 15, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'gay.callanta@gmail.com', '09700000014', NULL, NULL, 2, 4, 29250.00, 'Monthly', '2014-03-15', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.64, 62.00, 'O+', 'GSIS-2026-000014', 'PAGIBIG-2026-000014', 'PHIC-2026-000014', '100000014', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(15, 'EMP2026-0015', 'Krissette Grace', 'F.', 'Campilan-Bahala', '1987-04-16', 'Barangay 16, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'krissette.grace.campilan-bahala@gmail.com', '09700000015', NULL, NULL, 3, 17, 23250.00, 'Semi-monthly', '2025-04-16', 'Active', 0, 'Contract of Service', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.65, 63.00, 'O-', 'GSIS-2026-000015', 'PAGIBIG-2026-000015', 'PHIC-2026-000015', '100000015', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(16, 'EMP2026-0016', 'Ai-let', 'R.', 'Castro', '1988-05-17', 'Barangay 17, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'ai-let.castro@gmail.com', '09700000016', NULL, NULL, 4, 24, 31750.00, 'Monthly', '2016-05-17', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.66, 64.00, 'A+', 'GSIS-2026-000016', 'PAGIBIG-2026-000016', 'PHIC-2026-000016', '100000016', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(17, 'EMP2026-0017', 'Rubelen', 'M.', 'Dadula', '1989-06-18', 'Barangay 18, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'rubelen.dadula@gmail.com', '09700000017', NULL, NULL, 5, 30, 33000.00, 'Monthly', '2017-06-18', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.67, 65.00, 'A-', 'GSIS-2026-000017', 'PAGIBIG-2026-000017', 'PHIC-2026-000017', '100000017', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(18, 'EMP2026-0018', 'Liberty', 'B.', 'Daitia', '1990-07-19', 'Barangay 19, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'liberty.daitia@gmail.com', '09700000018', NULL, NULL, 6, 38, 19500.00, 'Semi-monthly', '2024-07-19', 'Active', 0, 'Contract of Service', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.68, 66.00, 'B+', 'GSIS-2026-000018', 'PAGIBIG-2026-000018', 'PHIC-2026-000018', '100000018', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(19, 'EMP2026-0019', 'Mary Jossel', 'H.', 'Dispo', '1991-08-20', 'Barangay 20, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'mary.jossel.dispo@gmail.com', '09700000019', NULL, NULL, 2, 5, 35500.00, 'Monthly', '2019-08-20', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.69, 67.00, 'B-', 'GSIS-2026-000019', 'PAGIBIG-2026-000019', 'PHIC-2026-000019', '100000019', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(20, 'EMP2026-0020', 'Elvert', 'L.', 'Eludo', '1992-09-21', 'Barangay 21, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'elvert.eludo@gmail.com', '09700000020', NULL, NULL, 4, 22, 75000.00, 'Monthly', '2020-09-21', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.70, 68.00, 'AB+', 'GSIS-2026-000020', 'PAGIBIG-2026-000020', 'PHIC-2026-000020', '100000020', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(21, 'EMP2026-0021', 'Dominic', 'O.', 'Escobal', '1993-10-22', 'Barangay 22, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'dominic.escobal@gmail.com', '09700000021', NULL, NULL, 3, 18, 21750.00, 'Semi-monthly', '2023-10-22', 'Active', 0, 'Contract of Service', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.71, 69.00, 'AB-', 'GSIS-2026-000021', 'PAGIBIG-2026-000021', 'PHIC-2026-000021', '100000021', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(22, 'EMP2026-0022', 'Daryl', 'D.', 'Faciol', '1994-11-23', 'Barangay 23, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'daryl.faciol@gmail.com', '09700000022', NULL, NULL, 4, 25, 39250.00, 'Monthly', '2022-11-23', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.72, 70.00, 'O+', 'GSIS-2026-000022', 'PAGIBIG-2026-000022', 'PHIC-2026-000022', '100000022', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(23, 'EMP2026-0023', 'Rodante', 'B.', 'Felina', '1995-12-24', 'Barangay 24, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'rodante.felina@gmail.com', '09700000023', NULL, NULL, 5, 31, 40500.00, 'Monthly', '2023-12-24', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.73, 71.00, 'O-', 'GSIS-2026-000023', 'PAGIBIG-2026-000023', 'PHIC-2026-000023', '100000023', '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(24, 'EMP2026-0024', 'Janice', 'F.', 'Gadia', '1996-01-25', 'Barangay 25, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'janice.gadia@gmail.com', '09700000024', NULL, NULL, 6, 33, 18000.00, 'Semi-monthly', '2022-01-25', 'Active', 0, 'Contract of Service', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.74, 72.00, 'A+', 'GSIS-2026-000024', 'PAGIBIG-2026-000024', 'PHIC-2026-000024', '100000024', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(25, 'EMP2026-0025', 'Rey', 'E.', 'Gamayon', '1997-02-26', 'Barangay 26, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'rey.gamayon@gmail.com', '09700000025', NULL, NULL, 2, 6, 28000.00, 'Monthly', '2013-02-26', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.50, 73.00, 'A-', 'GSIS-2026-000025', 'PAGIBIG-2026-000025', 'PHIC-2026-000025', '100000025', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(26, 'EMP2026-0026', 'Joven Clar', 'Z.', 'Granada', '1998-03-27', 'Barangay 27, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'joven.clar.granada@gmail.com', '09700000026', NULL, NULL, 6, 37, 95000.00, 'Monthly', '2014-03-27', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.51, 74.00, 'B+', 'GSIS-2026-000026', 'PAGIBIG-2026-000026', 'PHIC-2026-000026', '100000026', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(27, 'EMP2026-0027', 'Dulce', 'A.', 'Gualberto', '1999-04-28', 'Barangay 28, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'dulce.gualberto@gmail.com', '09700000027', NULL, NULL, 3, 19, 20250.00, 'Semi-monthly', '2025-04-28', 'Active', 0, 'Contract of Service', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.52, 75.00, 'B-', 'GSIS-2026-000027', 'PAGIBIG-2026-000027', 'PHIC-2026-000027', '100000027', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(28, 'EMP2026-0028', 'Janeth Faye', 'Z.', 'Hadman', '1972-05-01', 'Barangay 29, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'janeth.faye.hadman@gmail.com', '09700000028', NULL, NULL, 4, 26, 31750.00, 'Monthly', '2016-05-01', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.53, 76.00, 'AB+', 'GSIS-2026-000028', 'PAGIBIG-2026-000028', 'PHIC-2026-000028', '100000028', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(29, 'EMP2026-0029', 'Jovelyn', 'M.', 'Jayme', '1973-06-02', 'Barangay 30, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'jovelyn.jayme@gmail.com', '09700000029', NULL, NULL, 5, 32, 33000.00, 'Monthly', '2017-06-02', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.54, 77.00, 'AB-', 'GSIS-2026-000029', 'PAGIBIG-2026-000029', 'PHIC-2026-000029', '100000029', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(30, 'EMP2026-0030', 'Herman', 'C.', 'Juanico', '1974-07-03', 'Barangay 31, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'herman.juanico@gmail.com', '09700000030', NULL, NULL, 2, 12, 36500.00, 'Monthly', '2018-07-03', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.55, 48.00, 'O+', 'GSIS-2026-000030', 'PAGIBIG-2026-000030', 'PHIC-2026-000030', '100000030', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(31, 'EMP2026-0031', 'Lou Marie France', 'G.', 'Ladao', '1975-08-04', 'Barangay 32, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'lou.marie.france.ladao@gmail.com', '09700000031', NULL, NULL, 6, 34, 35500.00, 'Monthly', '2019-08-04', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.56, 49.00, 'O-', 'GSIS-2026-000031', 'PAGIBIG-2026-000031', 'PHIC-2026-000031', '100000031', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(32, 'EMP2026-0032', 'Sheena Mae', 'O.', 'Lantaca', '1976-09-05', 'Barangay 33, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'sheena.mae.lantaca@gmail.com', '09700000032', NULL, NULL, 2, 7, 36750.00, 'Monthly', '2020-09-05', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.57, 50.00, 'A+', 'GSIS-2026-000032', 'PAGIBIG-2026-000032', 'PHIC-2026-000032', '100000032', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(33, 'EMP2026-0033', 'Ralph John', NULL, 'Ligas', '1977-10-06', 'Barangay 34, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'ralph.john.ligas@gmail.com', '09700000033', NULL, NULL, 3, 20, 18750.00, 'Semi-monthly', '2023-10-06', 'Active', 0, 'Contract of Service', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.58, 51.00, 'A-', 'GSIS-2026-000033', 'PAGIBIG-2026-000033', 'PHIC-2026-000033', '100000033', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(34, 'EMP2026-0034', 'Lariza Amor', 'R.', 'Lucero', '1978-11-07', 'Barangay 35, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'lariza.amor.lucero@gmail.com', '09700000034', NULL, NULL, 4, 21, 39250.00, 'Monthly', '2022-11-07', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.59, 52.00, 'B+', 'GSIS-2026-000034', 'PAGIBIG-2026-000034', 'PHIC-2026-000034', '100000034', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(35, 'EMP2026-0035', 'Neil', 'P.', 'Maata', '1979-12-08', 'Barangay 36, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'neil.maata@gmail.com', '09700000035', NULL, NULL, 5, 27, 40500.00, 'Monthly', '2023-12-08', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.60, 53.00, 'B-', 'GSIS-2026-000035', 'PAGIBIG-2026-000035', 'PHIC-2026-000035', '100000035', '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(36, 'EMP2026-0036', 'Jenisse Dowell', 'N.', 'Medel', '1980-01-09', 'Barangay 37, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'jenisse.dowell.medel@gmail.com', '09700000036', NULL, NULL, 6, 38, 21000.00, 'Semi-monthly', '2022-01-09', 'Active', 0, 'Contract of Service', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.61, 54.00, 'AB+', 'GSIS-2026-000036', 'PAGIBIG-2026-000036', 'PHIC-2026-000036', '100000036', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(37, 'EMP2026-0037', 'Rogin Aron', 'B.', 'Montalan', '1981-02-10', 'Barangay 38, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'rogin.aron.montalan@gmail.com', '09700000037', NULL, NULL, 5, 28, 75000.00, 'Monthly', '2013-02-10', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.62, 55.00, 'AB-', 'GSIS-2026-000037', 'PAGIBIG-2026-000037', 'PHIC-2026-000037', '100000037', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(38, 'EMP2026-0038', 'Glenn Marcelo', 'C.', 'Noble', '1982-03-11', 'Barangay 39, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'glenn.marcelo.noble@gmail.com', '09700000038', NULL, NULL, 2, 8, 29250.00, 'Monthly', '2014-03-11', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.63, 56.00, 'O+', 'GSIS-2026-000038', 'PAGIBIG-2026-000038', 'PHIC-2026-000038', '100000038', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(39, 'EMP2026-0039', 'Maria Raniela', 'P.', 'Orteza', '1983-04-12', 'Barangay 40, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'maria.raniela.orteza@gmail.com', '09700000039', NULL, NULL, 3, 14, 23250.00, 'Semi-monthly', '2025-04-12', 'Active', 0, 'Contract of Service', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.64, 57.00, 'O-', 'GSIS-2026-000039', 'PAGIBIG-2026-000039', 'PHIC-2026-000039', '100000039', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(40, 'EMP2026-0040', 'May Lara Bea', 'A.', 'Paulin', '1984-05-13', 'Barangay 01, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'may.lara.bea.paulin@gmail.com', '09700000040', NULL, NULL, 4, 23, 31750.00, 'Monthly', '2016-05-13', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.65, 58.00, 'A+', 'GSIS-2026-000040', 'PAGIBIG-2026-000040', 'PHIC-2026-000040', '100000040', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(41, 'EMP2026-0041', 'Gaudencio Jr.', 'L.', 'Paulma', '1985-06-14', 'Barangay 02, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'gaudencio.jr.paulma@gmail.com', '09700000041', NULL, NULL, 5, 29, 33000.00, 'Monthly', '2017-06-14', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.66, 59.00, 'A-', 'GSIS-2026-000041', 'PAGIBIG-2026-000041', 'PHIC-2026-000041', '100000041', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(42, 'EMP2026-0042', 'Kayshe Joy', 'F.', 'Pelingon', '1986-07-15', 'Barangay 03, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'kayshe.joy.pelingon@gmail.com', '09700000042', NULL, NULL, 6, 33, 19500.00, 'Semi-monthly', '2024-07-15', 'Active', 0, 'Contract of Service', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.67, 60.00, 'B+', 'GSIS-2026-000042', 'PAGIBIG-2026-000042', 'PHIC-2026-000042', '100000042', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(43, 'EMP2026-0043', 'June Ray', 'P.', 'Penaso', '1987-08-16', 'Barangay 04, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'june.ray.penaso@gmail.com', '09700000043', NULL, NULL, 2, 9, 35500.00, 'Monthly', '2019-08-16', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.68, 61.00, 'B-', 'GSIS-2026-000043', 'PAGIBIG-2026-000043', 'PHIC-2026-000043', '100000043', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(44, 'EMP2026-0044', 'Raymund', 'M.', 'Postrano', '1988-09-17', 'Barangay 05, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'raymund.postrano@gmail.com', '09700000044', NULL, NULL, 2, 10, 72000.00, 'Monthly', '2020-09-17', 'Active', 0, 'Regular', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.69, 62.00, 'AB+', 'GSIS-2026-000044', 'PAGIBIG-2026-000044', 'PHIC-2026-000044', '100000044', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(45, 'EMP2026-0045', 'Ritzielaine Rosse', 'V.', 'Sales', '1989-10-18', 'Barangay 06, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'ritzielaine.rosse.sales@gmail.com', '09700000045', NULL, NULL, 3, 15, 21750.00, 'Semi-monthly', '2023-10-18', 'Active', 0, 'Contract of Service', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.70, 63.00, 'AB-', 'GSIS-2026-000045', 'PAGIBIG-2026-000045', 'PHIC-2026-000045', '100000045', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(46, 'EMP2026-0046', 'Daphne Niccole', 'G.', 'Serojales', '1990-11-19', 'Barangay 07, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'daphne.niccole.serojales@gmail.com', '09700000046', NULL, NULL, 4, 24, 39250.00, 'Monthly', '2022-11-19', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.71, 64.00, 'O+', 'GSIS-2026-000046', 'PAGIBIG-2026-000046', 'PHIC-2026-000046', '100000046', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(47, 'EMP2026-0047', 'Maruel', 'C.', 'Silverio', '1991-12-20', 'Barangay 08, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'maruel.silverio@gmail.com', '09700000047', NULL, NULL, 5, 30, 40500.00, 'Monthly', '2023-12-20', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.72, 65.00, 'O-', 'GSIS-2026-000047', 'PAGIBIG-2026-000047', 'PHIC-2026-000047', '100000047', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(48, 'EMP2026-0048', 'Jay', 'A.', 'Simeon', '1992-01-21', 'Barangay 09, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'jay.simeon@gmail.com', '09700000048', NULL, NULL, 6, 34, 18000.00, 'Semi-monthly', '2022-01-21', 'Active', 0, 'Contract of Service', 0, 'Single', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.73, 66.00, 'A+', 'GSIS-2026-000048', 'PAGIBIG-2026-000048', 'PHIC-2026-000048', '100000048', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(49, 'EMP2026-0049', 'Gladys', 'P.', 'Tupaz', '1993-02-22', 'Barangay 10, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'gladys.tupaz@gmail.com', '09700000049', NULL, NULL, 2, 13, 28000.00, 'Monthly', '2013-02-22', 'Active', 0, 'Regular', 0, 'Married', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.74, 67.00, 'A-', 'GSIS-2026-000049', 'PAGIBIG-2026-000049', 'PHIC-2026-000049', '100000049', '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(50, 'EMP2026-0050', 'Virginia', 'R.', 'Verdejo', '1994-03-23', 'Barangay 11, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Female', 'virginia.verdejo@gmail.com', '09700000050', NULL, NULL, 3, 17, 29250.00, 'Monthly', '2014-03-23', 'Active', 0, 'Regular', 0, 'Widowed', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.50, 68.00, 'B+', 'GSIS-2026-000050', 'PAGIBIG-2026-000050', 'PHIC-2026-000050', '100000050', '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(51, 'EMP2026-0051', 'Alvin', 'M.', 'Villanueva', '1995-04-24', 'Barangay 12, Cagayan de Oro', 'Cagayan de Oro', 'Misamis Oriental', '9000', 'Male', 'alvin.villanueva@gmail.com', '09700000051', NULL, NULL, 6, 35, 80000.00, 'Monthly', '2015-04-24', 'Active', 0, 'Regular', 0, 'Separated', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1.51, 69.00, 'B-', 'GSIS-2026-000051', 'PAGIBIG-2026-000051', 'PHIC-2026-000051', '100000051', '2026-08-06 03:57:25', '2026-08-06 03:57:25');

-- --------------------------------------------------------

--
-- PDS family, children, and educational background
--

CREATE TABLE `employee_family_background` (
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `spouse_last_name` varchar(100) DEFAULT NULL,
  `spouse_first_name` varchar(100) DEFAULT NULL,
  `spouse_middle_name` varchar(100) DEFAULT NULL,
  `spouse_suffix` varchar(20) DEFAULT NULL,
  `spouse_occupation` varchar(150) DEFAULT NULL,
  `spouse_employer` varchar(180) DEFAULT NULL,
  `spouse_business_address` varchar(255) DEFAULT NULL,
  `spouse_telephone` varchar(30) DEFAULT NULL,
  `father_last_name` varchar(100) DEFAULT NULL,
  `father_first_name` varchar(100) DEFAULT NULL,
  `father_middle_name` varchar(100) DEFAULT NULL,
  `father_suffix` varchar(20) DEFAULT NULL,
  `mother_maiden_last_name` varchar(100) DEFAULT NULL,
  `mother_first_name` varchar(100) DEFAULT NULL,
  `mother_middle_name` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`employee_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `employee_children` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `full_name` varchar(180) NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `sort_order` tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_employee_children_employee` (`employee_record_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `employee_education_background` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `education_level` varchar(20) NOT NULL,
  `school_name` varchar(180) DEFAULT NULL,
  `degree_course` varchar(180) DEFAULT NULL,
  `attendance_from` varchar(20) DEFAULT NULL,
  `attendance_to` varchar(20) DEFAULT NULL,
  `highest_level_units` varchar(100) DEFAULT NULL,
  `year_graduated` varchar(20) DEFAULT NULL,
  `honors` varchar(180) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_education_level` (`employee_record_id`,`education_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `gsis_deductions`
--

CREATE TABLE `gsis_deductions` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `calculation_type` enum('fixed','percentage','tiered','bracket') NOT NULL DEFAULT 'fixed',
  `default_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `default_rate` decimal(12,8) NOT NULL DEFAULT 0.00000000,
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `threshold_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `threshold_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`threshold_rules`)),
  `base_floor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_cap` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_payroll` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `gsis_deductions`
--

INSERT INTO `gsis_deductions` (`id`, `code`, `name`, `description`, `calculation_type`, `default_amount`, `default_rate`, `basis`, `threshold_amount`, `threshold_rules`, `base_floor`, `base_cap`, `is_recurring`, `is_active`, `show_in_payroll`, `sort_order`, `created_at`, `updated_at`) VALUES
(3, 'l_r', 'L&R', 'GSIS Loans and Rediscounting. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 30, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(4, 'emergency_loan', 'Emergency Loan', 'GSIS Emergency Loan, available to members in areas under a declared state of calamity. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 40, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(5, 'policy_loan', 'Policy Loan', 'GSIS Policy Loan, drawn against the member’s life insurance policy. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 50, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(6, 'gfal', 'GFAL', 'GSIS Financial Assistance Loan. 6% per annum over a term of up to six years, used to consolidate loans held with other lenders. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 60, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(7, 'mpl', 'MPL', 'GSIS Multi-Purpose Loan. 8% per annum for members with less than three years of paid premiums. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 70, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(8, 'mpl_lite', 'MPL Lite', 'GSIS Multi-Purpose Loan Lite, the shorter-term MPL variant. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 80, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(9, 'cpl', 'CPL', 'GSIS Consolidated Loan, now folded into the Multi-Purpose Loan Plus facility. Amortisation is per-member and comes from the loan itself, not a table default.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 90, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(28, 'gsis', 'GSIS', 'GSIS personal share under RA 8291: 9% of monthly compensation, against a 12% government share. No salary ceiling applies, so the rate runs on the full salary.', 'percentage', 0.00, 9.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 1, 1, 1, 280, '2026-07-29 06:31:28', '2026-07-29 12:38:04');

-- --------------------------------------------------------

--
-- Table structure for table `holidays`
--

CREATE TABLE `holidays` (
  `holidays_id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `holiday_date` date NOT NULL,
  `type` enum('regular','special_non_working','special_working') NOT NULL DEFAULT 'regular',
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ipcr`
--

CREATE TABLE `ipcr` (
  `ipcr_id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `period_from` date NOT NULL,
  `period_to` date NOT NULL,
  `output` text DEFAULT NULL,
  `success_indicator` text DEFAULT NULL,
  `kpi_category` varchar(40) NOT NULL DEFAULT 'Program',
  `actual_accomplishment` text DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `final_rating` decimal(5,2) DEFAULT NULL,
  `q1_rating` decimal(5,2) DEFAULT NULL,
  `e2_rating` decimal(5,2) DEFAULT NULL,
  `t3_rating` decimal(5,2) DEFAULT NULL,
  `a4_rating` decimal(5,2) DEFAULT NULL,
  `mode_of_verification_name` varchar(255) DEFAULT NULL,
  `mode_of_verification_path` varchar(500) DEFAULT NULL,
  `mode_of_verification_size` int(10) UNSIGNED DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'draft',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ipcr_verification_files`
--

CREATE TABLE `ipcr_verification_files` (
  `id` int(10) UNSIGNED NOT NULL,
  `ipcr_id` int(10) UNSIGNED NOT NULL,
  `output_id` varchar(100) DEFAULT NULL,
  `original_name` varchar(255) NOT NULL,
  `stored_path` varchar(500) NOT NULL,
  `file_size` int(10) UNSIGNED NOT NULL,
  `mime_type` varchar(120) DEFAULT NULL,
  `uploaded_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `leave_attachments`
--

CREATE TABLE `leave_attachments` (
  `leave_attachments_id` int(11) NOT NULL,
  `leave_request_id` int(11) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `file_size` int(11) DEFAULT NULL,
  `uploaded_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `leave_credits`
--

CREATE TABLE `leave_credits` (
  `leave_credits_id` int(11) NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `leave_type_id` int(11) NOT NULL,
  `year` year(4) NOT NULL,
  `total_credits` decimal(6,2) NOT NULL DEFAULT 0.00,
  `used_credits` decimal(6,2) NOT NULL DEFAULT 0.00,
  `remaining_credits` decimal(6,2) GENERATED ALWAYS AS (`total_credits` - `used_credits`) STORED,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `leave_credits`
--

INSERT INTO `leave_credits` (`leave_credits_id`, `employee_id`, `leave_type_id`, `year`, `total_credits`, `used_credits`, `created_at`, `updated_at`) VALUES
(1, 1, 1, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 04:28:38'),
(2, 1, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(3, 1, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(4, 1, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(5, 1, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(6, 1, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(7, 1, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(8, 1, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(17, 2, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(18, 2, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(19, 2, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(20, 2, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(21, 2, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(22, 2, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(23, 2, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(24, 2, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(33, 3, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(34, 3, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(35, 3, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(36, 3, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(37, 3, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(38, 3, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(39, 3, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(40, 3, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(49, 4, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(50, 4, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(51, 4, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(52, 4, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(53, 4, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(54, 4, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(55, 4, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(56, 4, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(65, 5, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(66, 5, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(67, 5, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(68, 5, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(69, 5, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(70, 5, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(71, 5, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(72, 5, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(81, 6, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(82, 6, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(83, 6, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(84, 6, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(85, 6, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(86, 6, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(87, 6, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(88, 6, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(97, 7, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(98, 7, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(99, 7, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(100, 7, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(101, 7, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(102, 7, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(103, 7, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(104, 7, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(113, 8, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(114, 8, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(115, 8, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(116, 8, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(117, 8, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(118, 8, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(119, 8, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(120, 8, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:21', '2026-08-06 03:57:21'),
(129, 9, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(130, 9, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(131, 9, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(132, 9, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(133, 9, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(134, 9, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(135, 9, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(136, 9, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(145, 10, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(146, 10, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(147, 10, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(148, 10, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(149, 10, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(150, 10, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(151, 10, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(152, 10, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(161, 11, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(162, 11, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(163, 11, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(164, 11, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(165, 11, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(166, 11, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(167, 11, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(168, 11, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(177, 12, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(178, 12, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(179, 12, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(180, 12, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(181, 12, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(182, 12, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(183, 12, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(184, 12, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(193, 13, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(194, 13, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(195, 13, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(196, 13, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(197, 13, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(198, 13, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(199, 13, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(200, 13, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(209, 14, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(210, 14, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(211, 14, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(212, 14, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(213, 14, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(214, 14, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(215, 14, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(216, 14, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(225, 15, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(226, 15, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(227, 15, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(228, 15, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(229, 15, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(230, 15, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(231, 15, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(232, 15, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(241, 16, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(242, 16, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(243, 16, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(244, 16, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(245, 16, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(246, 16, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(247, 16, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(248, 16, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(257, 17, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(258, 17, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(259, 17, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(260, 17, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(261, 17, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(262, 17, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(263, 17, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(264, 17, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(273, 18, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(274, 18, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(275, 18, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(276, 18, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(277, 18, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(278, 18, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(279, 18, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(280, 18, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(289, 19, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(290, 19, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(291, 19, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(292, 19, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(293, 19, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(294, 19, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(295, 19, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(296, 19, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(305, 20, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(306, 20, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(307, 20, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(308, 20, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(309, 20, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(310, 20, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(311, 20, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(312, 20, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(321, 21, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(322, 21, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(323, 21, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(324, 21, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(325, 21, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(326, 21, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(327, 21, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(328, 21, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(337, 22, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(338, 22, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(339, 22, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(340, 22, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(341, 22, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(342, 22, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(343, 22, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(344, 22, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(353, 23, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(354, 23, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(355, 23, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(356, 23, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(357, 23, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(358, 23, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(359, 23, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(360, 23, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:22', '2026-08-06 03:57:22'),
(369, 24, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(370, 24, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(371, 24, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(372, 24, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(373, 24, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(374, 24, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(375, 24, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(376, 24, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(385, 25, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(386, 25, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(387, 25, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(388, 25, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(389, 25, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(390, 25, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(391, 25, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(392, 25, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(401, 26, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(402, 26, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(403, 26, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(404, 26, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(405, 26, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(406, 26, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(407, 26, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(408, 26, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(417, 27, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(418, 27, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(419, 27, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(420, 27, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(421, 27, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(422, 27, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(423, 27, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(424, 27, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(433, 28, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(434, 28, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(435, 28, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(436, 28, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(437, 28, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(438, 28, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(439, 28, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(440, 28, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(449, 29, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(450, 29, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(451, 29, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(452, 29, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(453, 29, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(454, 29, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(455, 29, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(456, 29, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(465, 30, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(466, 30, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(467, 30, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(468, 30, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(469, 30, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(470, 30, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(471, 30, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(472, 30, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(481, 31, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(482, 31, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(483, 31, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(484, 31, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(485, 31, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(486, 31, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(487, 31, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(488, 31, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(497, 32, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(498, 32, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(499, 32, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(500, 32, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(501, 32, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(502, 32, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(503, 32, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(504, 32, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(513, 33, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(514, 33, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(515, 33, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(516, 33, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(517, 33, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(518, 33, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(519, 33, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(520, 33, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(529, 34, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(530, 34, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(531, 34, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(532, 34, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(533, 34, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(534, 34, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(535, 34, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(536, 34, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(545, 35, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(546, 35, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(547, 35, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(548, 35, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(549, 35, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(550, 35, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(551, 35, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(552, 35, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:23', '2026-08-06 03:57:23'),
(561, 36, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(562, 36, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(563, 36, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(564, 36, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(565, 36, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(566, 36, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(567, 36, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(568, 36, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(577, 37, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(578, 37, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(579, 37, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(580, 37, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(581, 37, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(582, 37, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(583, 37, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(584, 37, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(593, 38, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(594, 38, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(595, 38, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(596, 38, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(597, 38, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(598, 38, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(599, 38, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(600, 38, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(609, 39, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(610, 39, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(611, 39, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(612, 39, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(613, 39, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(614, 39, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(615, 39, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(616, 39, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(625, 40, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(626, 40, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(627, 40, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(628, 40, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(629, 40, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(630, 40, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(631, 40, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(632, 40, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(641, 41, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(642, 41, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(643, 41, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(644, 41, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(645, 41, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(646, 41, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(647, 41, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(648, 41, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(657, 42, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(658, 42, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(659, 42, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(660, 42, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(661, 42, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(662, 42, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(663, 42, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(664, 42, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(673, 43, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(674, 43, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(675, 43, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(676, 43, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(677, 43, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(678, 43, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(679, 43, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(680, 43, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(689, 44, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(690, 44, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(691, 44, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(692, 44, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(693, 44, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(694, 44, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(695, 44, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(696, 44, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(705, 45, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(706, 45, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(707, 45, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(708, 45, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(709, 45, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(710, 45, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(711, 45, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(712, 45, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(721, 46, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(722, 46, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(723, 46, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(724, 46, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(725, 46, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(726, 46, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(727, 46, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(728, 46, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(737, 47, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(738, 47, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(739, 47, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(740, 47, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(741, 47, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(742, 47, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(743, 47, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(744, 47, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(753, 48, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(754, 48, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(755, 48, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(756, 48, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(757, 48, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(758, 48, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(759, 48, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(760, 48, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(769, 49, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(770, 49, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(771, 49, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(772, 49, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(773, 49, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(774, 49, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(775, 49, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(776, 49, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:24', '2026-08-06 03:57:24'),
(785, 50, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(786, 50, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(787, 50, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(788, 50, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(789, 50, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(790, 50, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(791, 50, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(792, 50, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(801, 51, 1, '2026', 15.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(802, 51, 2, '2026', 15.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(803, 51, 3, '2026', 105.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(804, 51, 4, '2026', 7.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(805, 51, 5, '2026', 3.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(806, 51, 6, '2026', 5.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(807, 51, 7, '2026', 0.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25'),
(808, 51, 9, '2026', 7.00, 0.00, '2026-08-06 03:57:25', '2026-08-06 03:57:25');

-- --------------------------------------------------------

--
-- Table structure for table `leave_monetization_requests`
--

CREATE TABLE `leave_monetization_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `leave_type_id` int(11) NOT NULL,
  `number_of_days` decimal(6,2) NOT NULL,
  `date_filed` date NOT NULL,
  `reason` text DEFAULT NULL,
  `daily_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `estimated_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `credits_before` decimal(6,2) NOT NULL DEFAULT 0.00,
  `status` enum('pending','reviewed','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `rejected_note` text DEFAULT NULL,
  `reviewed_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `approved_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `leave_requests`
--

CREATE TABLE `leave_requests` (
  `leave_request_id` int(11) NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `leave_type_id` int(11) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `total_days` decimal(5,2) NOT NULL,
  `paid_days` decimal(5,2) DEFAULT NULL,
  `unpaid_days` decimal(5,2) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `rejected_note` text DEFAULT NULL,
  `reviewed_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `approved_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `status` enum('pending','reviewed','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `current_level` int(11) NOT NULL DEFAULT 1,
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `leave_requests`
--

INSERT INTO `leave_requests` (`leave_request_id`, `employee_id`, `leave_type_id`, `start_date`, `end_date`, `total_days`, `paid_days`, `unpaid_days`, `reason`, `rejected_note`, `reviewed_by_employee_id`, `approved_by_employee_id`, `status`, `current_level`, `requested_at`, `updated_at`) VALUES
(1, 16, 1, '2026-08-06', '2026-08-07', 2.00, 2.00, 0.00, 'asdasd\n\n[HRIS_LEAVE_META]{\"vacationScope\":\"within_philippines\",\"vacationNote\":\"\",\"sickLeaveMode\":\"\",\"sickLeaveIllness\":\"\",\"studyLeavePurpose\":\"\"}', NULL, NULL, NULL, 'pending', 1, '2026-08-06 04:10:08', '2026-08-06 04:10:08');

-- --------------------------------------------------------

--
-- Table structure for table `leave_types`
--

CREATE TABLE `leave_types` (
  `leave_type_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `code` varchar(20) NOT NULL,
  `description` text DEFAULT NULL,
  `max_days_per_year` decimal(5,2) DEFAULT NULL,
  `is_with_pay` tinyint(1) NOT NULL DEFAULT 1,
  `requires_approval` tinyint(1) NOT NULL DEFAULT 1,
  `requires_attachment` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `leave_types`
--

INSERT INTO `leave_types` (`leave_type_id`, `name`, `code`, `description`, `max_days_per_year`, `is_with_pay`, `requires_approval`, `requires_attachment`, `is_active`, `created_at`) VALUES
(1, 'Vacation Leave', 'VL', NULL, 15.00, 1, 1, 0, 1, '2026-07-25 05:36:50'),
(2, 'Sick Leave', 'SL', NULL, 15.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(3, 'Maternity Leave', 'ML', NULL, 105.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(4, 'Paternity Leave', 'PL', NULL, 7.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(5, 'Special Privilege Leave', 'SPL', NULL, 3.00, 1, 1, 0, 1, '2026-07-25 05:36:50'),
(6, 'Forced Leave', 'FL', NULL, 5.00, 1, 1, 0, 1, '2026-07-25 05:36:50'),
(7, 'Study Leave', 'STL', NULL, NULL, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(8, 'Mandatory/Forced Leave', 'MFL', NULL, 5.00, 1, 1, 0, 1, '2026-07-25 05:36:50'),
(9, 'Solo Parent Leave', 'SOPL', NULL, 7.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(10, '10-Day VAWC Leave', 'VAWC', NULL, 10.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(11, 'Rehabilitation Privilege', 'RP', NULL, 180.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(12, 'Special Leave Benefits for Women', 'SLBW', NULL, 60.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(13, 'Special Emergency (Calamity) Leave', 'SECL', NULL, 5.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(14, 'Adoption Leave', 'AL', NULL, 60.00, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(15, 'Rehabilitation Leave', 'RL', NULL, NULL, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(16, 'Leave Without Pay', 'LWOP', NULL, NULL, 0, 1, 0, 1, '2026-07-25 05:36:50'),
(17, 'Terminal Leave', 'TL', NULL, NULL, 1, 1, 1, 1, '2026-07-25 05:36:50'),
(18, 'Wellness Leave', 'WL', NULL, NULL, 1, 1, 0, 1, '2026-07-27 03:14:07');

-- --------------------------------------------------------

--
-- Table structure for table `loan_records`
--

CREATE TABLE `loan_records` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `loan_type` varchar(120) NOT NULL,
  `loan_amount` decimal(12,2) NOT NULL,
  `emergency_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `policy_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `consolidated_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `salary_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `housing_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `pension_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `gsis_financial_assistance_loan_gfal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `enhanced_housing_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `multi_purpose_loan_mpl` decimal(12,2) NOT NULL DEFAULT 0.00,
  `calamity_loan` decimal(12,2) NOT NULL DEFAULT 0.00,
  `repayment_terms` varchar(180) NOT NULL,
  `purpose` text DEFAULT NULL,
  `date_filed` date NOT NULL,
  `status` enum('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  `supporting_document_name` varchar(255) DEFAULT NULL,
  `supporting_document_path` varchar(500) DEFAULT NULL,
  `supporting_document_size` int(10) UNSIGNED DEFAULT NULL,
  `supporting_document_type` varchar(120) DEFAULT NULL,
  `approval_remarks` text DEFAULT NULL,
  `approved_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `reviewed_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `updated_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `messages`
--

CREATE TABLE `messages` (
  `Message_ID` int(10) UNSIGNED NOT NULL,
  `sender_id` int(10) UNSIGNED NOT NULL,
  `receiver_id` int(10) UNSIGNED NOT NULL,
  `message_text` text NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `module_access_requests`
--

CREATE TABLE `module_access_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `module_key` varchar(80) NOT NULL,
  `module_label` varchar(120) NOT NULL,
  `status` enum('pending','granted') NOT NULL DEFAULT 'pending',
  `decided_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(180) NOT NULL,
  `message` text NOT NULL,
  `type` varchar(80) NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `reference_id` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `user_id`, `title`, `message`, `type`, `is_read`, `reference_id`, `created_at`) VALUES
(1, 1, 'Employees Imported', '51 employee records imported from CSV.', 'employee_added', 0, 'employee-import', '2026-08-06 03:57:25'),
(2, 5, 'Employees Imported', '51 employee records imported from CSV.', 'employee_added', 0, 'employee-import', '2026-08-06 03:57:25'),
(3, 13, 'Employees Imported', '51 employee records imported from CSV.', 'employee_added', 0, 'employee-import', '2026-08-06 03:57:25'),
(4, 31, 'Employees Imported', '51 employee records imported from CSV.', 'employee_added', 0, 'employee-import', '2026-08-06 03:57:25'),
(5, 2, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(6, 3, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(7, 4, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(8, 5, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(9, 6, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(10, 7, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(11, 8, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(12, 9, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(13, 10, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(14, 11, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(15, 12, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(16, 13, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(17, 14, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(18, 15, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(19, 16, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(20, 17, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(21, 18, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(22, 19, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(23, 20, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(24, 21, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(25, 22, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(26, 23, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(27, 24, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(28, 25, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(29, 26, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(30, 27, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(31, 28, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(32, 29, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(33, 30, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(34, 31, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(35, 32, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(36, 33, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(37, 34, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(38, 35, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(39, 36, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(40, 37, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(41, 38, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(42, 39, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(43, 40, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(44, 41, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(45, 42, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(46, 43, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(47, 44, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(48, 45, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(49, 46, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(50, 47, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(51, 48, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(52, 49, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(53, 50, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(54, 51, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(55, 52, 'Account Created', 'Your employee profile has been imported. Use your email address and temporary password to sign in.', 'user_created', 0, 'employee-import', '2026-08-06 03:57:25'),
(56, 1, 'New login detected', 'Louisse Kaye P. Aba (louisse.kaye.aba@gmail.com, Employee) signed in.', 'login_detected', 0, '2', '2026-08-06 03:58:14'),
(57, 1, 'New login detected', 'Gerald C. Baclayon (gerald.baclayon@gmail.com, HRHead) signed in.', 'login_detected', 0, '5', '2026-08-06 04:00:25'),
(58, 1, 'New login detected', 'Louisse Kaye P. Aba (louisse.kaye.aba@gmail.com, Employee) signed in.', 'login_detected', 0, '2', '2026-08-06 04:07:23'),
(59, 1, 'Leave Request Submitted', 'Ai-let R. Castro submitted a leave request for 2026-08-06 to 2026-08-07.', 'leave_request_submitted', 0, '1', '2026-08-06 04:10:08'),
(60, 5, 'Leave Request Submitted', 'Ai-let R. Castro submitted a leave request for 2026-08-06 to 2026-08-07.', 'leave_request_submitted', 0, '1', '2026-08-06 04:10:08'),
(61, 13, 'Leave Request Submitted', 'Ai-let R. Castro submitted a leave request for 2026-08-06 to 2026-08-07.', 'leave_request_submitted', 0, '1', '2026-08-06 04:10:08'),
(62, 27, 'Leave Request Submitted', 'Ai-let R. Castro submitted a leave request for 2026-08-06 to 2026-08-07.', 'leave_request_submitted', 0, '1', '2026-08-06 04:10:08'),
(63, 31, 'Leave Request Submitted', 'Ai-let R. Castro submitted a leave request for 2026-08-06 to 2026-08-07.', 'leave_request_submitted', 0, '1', '2026-08-06 04:10:08'),
(64, 2, 'Leave balance updated', 'Your 2026 leave balance was adjusted: -15 Vacation Leave.', 'leave_credit_adjusted', 0, 'leave_credit:1', '2026-08-06 04:17:06'),
(65, 2, 'Leave balance updated', 'Your 2026 leave balance was adjusted: +5 Vacation Leave.', 'leave_credit_adjusted', 0, 'leave_credit:1', '2026-08-06 04:17:20');

-- --------------------------------------------------------

--
-- Table structure for table `opcr_templates`
--

CREATE TABLE `opcr_templates` (
  `template_id` int(10) UNSIGNED NOT NULL,
  `template_name` varchar(150) NOT NULL,
  `category` varchar(150) NOT NULL,
  `office_division` text NOT NULL,
  `year_semester` varchar(100) NOT NULL DEFAULT '',
  `template_status` varchar(50) NOT NULL DEFAULT 'Active',
  `output` text NOT NULL,
  `success_indicator` text NOT NULL,
  `budget` decimal(12,2) DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `opcr_templates`
--

INSERT INTO `opcr_templates` (`template_id`, `template_name`, `category`, `office_division`, `year_semester`, `template_status`, `output`, `success_indicator`, `budget`, `is_archived`, `created_at`, `updated_at`) VALUES
(1, 'sad', 'Program', 'Administration', 'FY 2026 - 1st Semester', 'Active', 'sad', 'asdasd', NULL, 0, '2026-07-25 23:19:23', '2026-07-25 23:19:23');

-- --------------------------------------------------------

--
-- Table structure for table `other_deductions`
--

CREATE TABLE `other_deductions` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `calculation_type` enum('fixed','percentage','tiered','bracket') NOT NULL DEFAULT 'fixed',
  `default_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `default_rate` decimal(12,8) NOT NULL DEFAULT 0.00000000,
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `threshold_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `threshold_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`threshold_rules`)),
  `base_floor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_cap` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_payroll` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `other_deductions`
--

INSERT INTO `other_deductions` (`id`, `code`, `name`, `description`, `calculation_type`, `default_amount`, `default_rate`, `basis`, `threshold_amount`, `threshold_rules`, `base_floor`, `base_cap`, `is_recurring`, `is_active`, `show_in_payroll`, `sort_order`, `created_at`, `updated_at`) VALUES
(17, 'lbp_loan', 'LBP Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 170, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(18, 'disallowance_cola', 'Disallowance (COLA)', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 180, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(19, 'disallowance_praise', 'Disallowance (PRAISE)', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 190, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(20, 'disallowance_maternity_leave', 'Disallowance (Maternity Leave)', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 200, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(21, 'enrp_mowel', 'ENRP MOWEL', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 210, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(22, 'dbp_salary_loan', 'DBP Salary Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 220, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(23, 'ucpb_salary_loan', 'UCPB Salary Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 230, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(24, 'mgbea_x', 'MGBEA-X', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 240, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(25, 'family_support_w_court_order', 'Family Support (w/ Court Order)', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 250, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(27, 'sss', 'SSS', NULL, 'percentage', 0.00, 4.50000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 1, 0, 1, 270, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(34, 'manual_cash_advance_adjustment', 'Manual Cash Advance Adjustment', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 340, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(35, 'laptop_loan', 'Laptop Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 1, 1, 1, 350, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(36, 'other_deductions', 'Other Deductions', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 1, 1, 1, 360, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(37, 'custom_deduction', 'Custom Deduction', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 370, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(38, 'loans_emergency_loan', 'Emergency Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 380, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(39, 'loans_policy_loan', 'Policy Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 390, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(40, 'consolidated_loan', 'Consolidated Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 400, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(41, 'salary_loan', 'Salary Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 410, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(42, 'loans_housing_loan', 'Housing Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 420, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(43, 'pension_loan', 'Pension Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 430, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(44, 'gsis_financial_assistance_loan_gfal', 'GSIS Financial Assistance Loan (GFAL)', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 440, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(45, 'multi_purpose_loan_mpl', 'Multi-Purpose Loan (MPL)', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 450, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(46, 'loans_calamity_loan', 'Calamity Loan', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 460, '2026-07-29 06:31:29', '2026-07-29 06:31:29');

-- --------------------------------------------------------

--
-- Table structure for table `overtime`
--

CREATE TABLE `overtime` (
  `overtime_id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `work_date` date NOT NULL,
  `hour_requested` decimal(5,2) NOT NULL,
  `request_date` datetime NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `status` enum('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
  `duration` decimal(5,2) NOT NULL,
  `source` varchar(40) NOT NULL DEFAULT 'request',
  `approved_by` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pagibig_deductions`
--

CREATE TABLE `pagibig_deductions` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `calculation_type` enum('fixed','percentage','tiered','bracket') NOT NULL DEFAULT 'fixed',
  `default_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `default_rate` decimal(12,8) NOT NULL DEFAULT 0.00000000,
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `threshold_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `threshold_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`threshold_rules`)),
  `base_floor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_cap` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_payroll` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `pagibig_deductions`
--

INSERT INTO `pagibig_deductions` (`id`, `code`, `name`, `description`, `calculation_type`, `default_amount`, `default_rate`, `basis`, `threshold_amount`, `threshold_rules`, `base_floor`, `base_cap`, `is_recurring`, `is_active`, `show_in_payroll`, `sort_order`, `created_at`, `updated_at`) VALUES
(10, 'premium', 'Premium', 'Pag-IBIG membership premium — the same mandatory contribution as HDMF, listed separately on payslips that itemise it under Pag-IBIG.', 'tiered', 200.00, 2.00000000, 'basic_salary', 0.00, '[{\"up_to\":1500,\"rate\":1},{\"up_to\":null,\"rate\":2}]', 0.00, 10000.00, 0, 1, 1, 100, '2026-07-29 06:31:28', '2026-07-29 12:38:04'),
(11, 'pagibig_loans_mpl', 'MPL', NULL, 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 110, '2026-07-29 06:31:29', '2026-07-29 06:31:29'),
(12, 'calamity_loan', 'Calamity Loan', 'Pag-IBIG Calamity Loan. Up to 80% of total accumulated value, 24-month term. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 120, '2026-07-29 06:31:29', '2026-07-29 12:38:04'),
(13, 'housing_loan', 'Housing Loan', 'Pag-IBIG Housing Loan, up to a 30-year term. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 130, '2026-07-29 06:31:29', '2026-07-29 12:38:04'),
(14, 'mp2', 'MP2', 'Pag-IBIG MP2 Savings, a voluntary five-year savings programme with a minimum of ₱500 per month. The amount is whatever the member elected to save.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 140, '2026-07-29 06:31:29', '2026-07-29 12:38:04'),
(15, 'pag_ibig_mpl', 'PAG-IBIG MPL', 'Pag-IBIG Multi-Purpose Loan. Up to 80% of total accumulated value, 24-month term. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 150, '2026-07-29 06:31:29', '2026-07-29 12:38:04'),
(16, 'pag_ibig_home_equity_appreciation_loan_heal', 'PAG-IBIG Home Equity Appreciation Loan (HEAL)', 'Pag-IBIG Home Equity Appreciation Loan, drawn against equity built up in a Pag-IBIG housing loan. Amortisation is per-member.', 'fixed', 0.00, 0.00000000, 'basic_salary', 0.00, NULL, 0.00, NULL, 0, 1, 1, 160, '2026-07-29 06:31:29', '2026-07-29 12:38:04'),
(29, 'hdmf', 'HDMF', 'Pag-IBIG (HDMF) employee share. 1% of the monthly fund salary at ₱1,500 or below and 2% above it, with the fund salary capped at ₱10,000 — so the employee share tops out at ₱200 a month. The employer matches with 2%.', 'tiered', 200.00, 2.00000000, 'basic_salary', 0.00, '[{\"up_to\":1500,\"rate\":1},{\"up_to\":null,\"rate\":2}]', 0.00, 10000.00, 1, 1, 1, 290, '2026-07-29 06:31:29', '2026-07-29 12:38:04'),
(30, 'pag_ibig', 'Pag-IBIG', 'Alternate label for HDMF. Kept inactive so the same contribution is not charged twice; it carries the same 1%/2% split and ₱10,000 fund salary cap.', 'tiered', 200.00, 2.00000000, 'basic_salary', 0.00, '[{\"up_to\":1500,\"rate\":1},{\"up_to\":null,\"rate\":2}]', 0.00, 10000.00, 1, 0, 1, 300, '2026-07-29 06:31:29', '2026-07-29 12:38:04');

-- --------------------------------------------------------

--
-- Table structure for table `pass_slip`
--

CREATE TABLE `pass_slip` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `pass_date` date NOT NULL,
  `departure_time` time NOT NULL,
  `time_returned` time NOT NULL,
  `destination` varchar(255) NOT NULL,
  `purpose` text DEFAULT NULL,
  `approved_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payroll`
--

CREATE TABLE `payroll` (
  `payroll_id` int(11) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `payroll_date` date DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `gross_pay` decimal(10,2) DEFAULT NULL,
  `total_allowance` decimal(10,2) DEFAULT NULL,
  `phic` decimal(10,2) NOT NULL DEFAULT 0.00,
  `l_r` decimal(10,2) NOT NULL DEFAULT 0.00,
  `emergency_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `policy_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `gfal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `mpl` decimal(10,2) NOT NULL DEFAULT 0.00,
  `mpl_lite` decimal(10,2) NOT NULL DEFAULT 0.00,
  `cpl` decimal(10,2) NOT NULL DEFAULT 0.00,
  `premium` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pagibig_loans_mpl` decimal(10,2) NOT NULL DEFAULT 0.00,
  `calamity_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `housing_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `mp2` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pag_ibig_mpl` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pag_ibig_home_equity_appreciation_loan_heal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `lbp_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `disallowance_cola` decimal(10,2) NOT NULL DEFAULT 0.00,
  `disallowance_praise` decimal(10,2) NOT NULL DEFAULT 0.00,
  `disallowance_maternity_leave` decimal(10,2) NOT NULL DEFAULT 0.00,
  `enrp_mowel` decimal(10,2) NOT NULL DEFAULT 0.00,
  `dbp_salary_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `ucpb_salary_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `mgbea_x` decimal(10,2) NOT NULL DEFAULT 0.00,
  `family_support_w_court_order` decimal(10,2) NOT NULL DEFAULT 0.00,
  `withholding_tax` decimal(10,2) NOT NULL DEFAULT 0.00,
  `gsis` decimal(10,2) NOT NULL DEFAULT 0.00,
  `hdmf` decimal(10,2) NOT NULL DEFAULT 0.00,
  `late_deduction` decimal(10,2) NOT NULL DEFAULT 0.00,
  `absence_deduction` decimal(10,2) NOT NULL DEFAULT 0.00,
  `undertime_deduction` decimal(10,2) NOT NULL DEFAULT 0.00,
  `manual_cash_advance_adjustment` decimal(10,2) NOT NULL DEFAULT 0.00,
  `laptop_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `other_deductions` decimal(10,2) NOT NULL DEFAULT 0.00,
  `custom_deduction` decimal(10,2) NOT NULL DEFAULT 0.00,
  `loans_emergency_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `loans_policy_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `consolidated_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `salary_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `loans_housing_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pension_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `gsis_financial_assistance_loan_gfal` decimal(10,2) NOT NULL DEFAULT 0.00,
  `multi_purpose_loan_mpl` decimal(10,2) NOT NULL DEFAULT 0.00,
  `loans_calamity_loan` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_deduction` decimal(10,2) DEFAULT NULL,
  `net_pay` decimal(10,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payrollapproval`
--

CREATE TABLE `payrollapproval` (
  `approval_id` int(11) NOT NULL,
  `payroll_id` int(11) NOT NULL,
  `approver_user_id` int(10) UNSIGNED NOT NULL,
  `approver_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `action` varchar(20) NOT NULL,
  `from_status` varchar(20) DEFAULT NULL,
  `to_status` varchar(20) DEFAULT NULL,
  `action_date` timestamp NOT NULL DEFAULT current_timestamp(),
  `comments` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payrolldeduction`
--

CREATE TABLE `payrolldeduction` (
  `payroll_deduction_id` int(11) NOT NULL,
  `payroll_id` int(11) NOT NULL,
  `deduction_type_id` int(10) UNSIGNED NOT NULL,
  `amount` decimal(10,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payrollmeta`
--

CREATE TABLE `payrollmeta` (
  `payroll_id` int(11) NOT NULL,
  `meta_json` longtext NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `phic_deductions`
--

CREATE TABLE `phic_deductions` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `calculation_type` enum('fixed','percentage','tiered','bracket') NOT NULL DEFAULT 'fixed',
  `default_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `default_rate` decimal(12,8) NOT NULL DEFAULT 0.00000000,
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `threshold_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `threshold_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`threshold_rules`)),
  `base_floor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_cap` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_payroll` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `phic_deductions`
--

INSERT INTO `phic_deductions` (`id`, `code`, `name`, `description`, `calculation_type`, `default_amount`, `default_rate`, `basis`, `threshold_amount`, `threshold_rules`, `base_floor`, `base_cap`, `is_recurring`, `is_active`, `show_in_payroll`, `sort_order`, `created_at`, `updated_at`) VALUES
(1, 'phic', 'PHIC', 'PhilHealth employee share. Premium is 5% of monthly basic salary for CY 2026 and is split equally with the employer, so the employee pays 2.5%. Income floor ₱10,000 and ceiling ₱100,000, giving an employee share between ₱250 and ₱2,500 a month.', 'percentage', 0.00, 2.50000000, 'basic_salary', 0.00, NULL, 10000.00, 100000.00, 1, 1, 1, 10, '2026-07-29 06:31:29', '2026-07-29 12:43:53'),
(2, 'philhealth', 'PhilHealth', 'Alternate label for PHIC. Kept inactive so the same contribution is not charged twice; it carries the same 2.5% employee share, ₱10,000 floor and ₱100,000 ceiling.', 'percentage', 0.00, 2.50000000, 'basic_salary', 0.00, NULL, 10000.00, 100000.00, 1, 0, 1, 20, '2026-07-29 06:31:29', '2026-07-29 12:38:04');

-- --------------------------------------------------------

--
-- Table structure for table `rate_limits`
--

CREATE TABLE `rate_limits` (
  `bucket_key` varchar(120) NOT NULL,
  `rule_key` varchar(40) NOT NULL,
  `identifier` varchar(190) NOT NULL,
  `hit_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `window_started_at` datetime NOT NULL,
  `blocked_until` datetime DEFAULT NULL,
  `blocked_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reward_certificates`
--

CREATE TABLE `reward_certificates` (
  `id` int(10) UNSIGNED NOT NULL,
  `cycle_id` int(10) UNSIGNED NOT NULL,
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `certificate_number` varchar(40) NOT NULL,
  `award_title` varchar(120) NOT NULL,
  `employee_name` varchar(200) NOT NULL,
  `employee_code` varchar(50) DEFAULT NULL,
  `division_name` varchar(180) DEFAULT NULL,
  `designation_title` varchar(180) DEFAULT NULL,
  `votes` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `period_start` date DEFAULT NULL,
  `period_end` date DEFAULT NULL,
  `awarded_on` date NOT NULL,
  `signatory_name` varchar(200) DEFAULT NULL,
  `signatory_title` varchar(180) DEFAULT NULL,
  `template_snapshot` longtext DEFAULT NULL,
  `issued_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `issued_by_name` varchar(180) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reward_certificate_sequence`
--

CREATE TABLE `reward_certificate_sequence` (
  `award_year` smallint(5) UNSIGNED NOT NULL,
  `last_number` int(10) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reward_cycles`
--

CREATE TABLE `reward_cycles` (
  `id` int(10) UNSIGNED NOT NULL,
  `category` varchar(120) NOT NULL,
  `description` text DEFAULT NULL,
  `opens_on` date DEFAULT NULL,
  `closes_on` date DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'ongoing',
  `created_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `created_by_name` varchar(180) DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `certificate_template` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reward_cycle_votes`
--

CREATE TABLE `reward_cycle_votes` (
  `id` int(10) UNSIGNED NOT NULL,
  `cycle_id` int(10) UNSIGNED NOT NULL,
  `voter_user_id` int(10) UNSIGNED NOT NULL,
  `voter_name` varchar(180) DEFAULT NULL,
  `nominee_employee_id` int(10) UNSIGNED NOT NULL,
  `nominee_name` varchar(180) NOT NULL,
  `reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `roles`
--

CREATE TABLE `roles` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(100) NOT NULL,
  `base_role` varchar(40) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `roles`
--

INSERT INTO `roles` (`id`, `name`, `base_role`, `description`, `created_at`) VALUES
(1, 'Admin', NULL, NULL, '2026-07-25 05:36:50'),
(2, 'Regionaldirector', NULL, NULL, '2026-07-25 05:36:50'),
(3, 'HRHead', NULL, NULL, '2026-07-25 05:36:50'),
(4, 'HRStaff', NULL, NULL, '2026-07-25 05:36:50'),
(5, 'Chief', NULL, NULL, '2026-07-25 05:36:50'),
(6, 'Employee', NULL, NULL, '2026-07-25 05:36:50'),
(7, 'PlanningOfficer', NULL, 'Monitors division plans, performance records, and workforce requests.', '2026-08-16 00:00:00'),
(8, 'Cashier', NULL, 'Releases approved payroll and monitors disbursement records.', '2026-08-16 00:00:00');

-- --------------------------------------------------------

--
-- Table structure for table `profile_edit_requests`
--

CREATE TABLE `profile_edit_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `requested_by_user_id` int(10) UNSIGNED NOT NULL,
  `section` varchar(40) NOT NULL DEFAULT 'personal',
  `reason` varchar(500) NOT NULL,
  `status` enum('pending','approved','declined','used') NOT NULL DEFAULT 'pending',
  `decided_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `decision_note` varchar(500) DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `service_record_print_requests`
--

CREATE TABLE `service_record_print_requests` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `requested_by_user_id` int(10) UNSIGNED NOT NULL,
  `status` enum('pending','approved','used') NOT NULL DEFAULT 'pending',
  `approved_by_user_id` int(10) UNSIGNED DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `printed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `service_records`
--

CREATE TABLE `service_records` (
  `id` int(10) UNSIGNED NOT NULL,
  `employee_record_id` int(10) UNSIGNED NOT NULL,
  `service_from` date NOT NULL,
  `service_to` date DEFAULT NULL,
  `designation_title` varchar(180) NOT NULL,
  `employment_status` varchar(50) NOT NULL,
  `monthly_salary` decimal(12,2) DEFAULT NULL,
  `salary_grade` varchar(20) DEFAULT NULL,
  `step_increment` varchar(10) DEFAULT NULL,
  `station` varchar(180) NOT NULL,
  `branch` varchar(180) NOT NULL DEFAULT 'Mines and Geosciences Bureau',
  `separation_date` date DEFAULT NULL,
  `separation_cause` varchar(255) DEFAULT NULL,
  `remarks` varchar(255) DEFAULT NULL,
  `designation_id` int(10) UNSIGNED DEFAULT NULL,
  `division_id` int(10) UNSIGNED DEFAULT NULL,
  `source` varchar(20) NOT NULL DEFAULT 'manual',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `settings`
--

CREATE TABLE `settings` (
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `settings`
--

INSERT INTO `settings` (`setting_key`, `setting_value`, `created_at`, `updated_at`) VALUES
('backup_automatic_enabled', '0', '2026-07-25 05:36:49', '2026-07-27 04:08:02'),
('backup_date_time', '2026-07-27 11:48:00', '2026-07-25 05:36:49', '2026-07-28 03:14:24'),
('backup_file_path', 'C:\\xampp\\htdocs\\Capstone2\\frontend\\backend\\backups', '2026-07-25 05:36:49', '2026-07-27 04:08:02'),
('backup_last_auto_at', '2026-07-27 06:07:48', '2026-07-27 04:07:48', '2026-07-27 04:07:48'),
('backup_schedule', 'daily', '2026-07-25 05:36:49', '2026-07-27 04:08:02'),
('email_domain_policy', '{\"enabled\":false,\"allowListedOnly\":false,\"allowedDomains\":[\"gmail.com\"],\"blockedDomains\":[\"10minutemail.com\",\"guerrillamail.com\",\"mailinator.com\",\"tempmail.com\",\"temp-mail.org\",\"yopmail.com\"]}', '2026-07-29 15:50:22', '2026-07-29 16:03:27'),
('login_captcha_enabled', '1', '2026-07-25 05:36:49', '2026-07-29 15:33:33'),
('role_permissions', '{\"admin\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"delete\"]},\"permissions\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"settings\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"auditLogs\":{\"enabled\":true,\"actions\":[\"view\"]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"delete\"]},\"rewardsRecognition\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\"]},\"attendance\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"payroll\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"export\"]},\"reports\":{\"enabled\":true,\"actions\":[\"view\",\"export\"]},\"payslip\":{\"enabled\":true,\"actions\":[\"view\"]}}},\"hrhead\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"delete\"]},\"permissions\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"settings\":{\"enabled\":false,\"actions\":[]},\"auditLogs\":{\"enabled\":true,\"actions\":[\"view\"]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"delete\"]},\"rewardsRecognition\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\"]},\"attendance\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"payroll\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"export\"]},\"reports\":{\"enabled\":true,\"actions\":[\"view\",\"export\"]},\"payslip\":{\"enabled\":false,\"actions\":[]}}},\"hrstaff\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":false,\"actions\":[]},\"permissions\":{\"enabled\":false,\"actions\":[]},\"settings\":{\"enabled\":false,\"actions\":[]},\"auditLogs\":{\"enabled\":false,\"actions\":[]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"delete\"]},\"rewardsRecognition\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\"]},\"attendance\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"payroll\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"export\"]},\"reports\":{\"enabled\":true,\"actions\":[\"view\",\"export\"]},\"payslip\":{\"enabled\":false,\"actions\":[]}}},\"chief\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":false,\"actions\":[]},\"permissions\":{\"enabled\":false,\"actions\":[]},\"settings\":{\"enabled\":false,\"actions\":[]},\"auditLogs\":{\"enabled\":false,\"actions\":[]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":false,\"actions\":[]},\"rewardsRecognition\":{\"enabled\":false,\"actions\":[]},\"attendance\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":false,\"actions\":[]},\"payroll\":{\"enabled\":true,\"actions\":[\"view\",\"export\"]},\"reports\":{\"enabled\":true,\"actions\":[\"view\",\"export\"]},\"payslip\":{\"enabled\":false,\"actions\":[]}}},\"regionaldirector\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":false,\"actions\":[]},\"permissions\":{\"enabled\":false,\"actions\":[]},\"settings\":{\"enabled\":false,\"actions\":[]},\"auditLogs\":{\"enabled\":true,\"actions\":[\"view\"]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":false,\"actions\":[]},\"rewardsRecognition\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\"]},\"attendance\":{\"enabled\":false,\"actions\":[]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":false,\"actions\":[]},\"payroll\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"export\"]},\"reports\":{\"enabled\":true,\"actions\":[\"view\",\"export\"]},\"payslip\":{\"enabled\":false,\"actions\":[]}}},\"employee\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":false,\"actions\":[]},\"permissions\":{\"enabled\":false,\"actions\":[]},\"settings\":{\"enabled\":false,\"actions\":[]},\"auditLogs\":{\"enabled\":false,\"actions\":[]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":false,\"actions\":[]},\"rewardsRecognition\":{\"enabled\":false,\"actions\":[]},\"attendance\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":false,\"actions\":[]},\"payroll\":{\"enabled\":false,\"actions\":[]},\"reports\":{\"enabled\":false,\"actions\":[]},\"payslip\":{\"enabled\":true,\"actions\":[\"view\"]}}}}', '2026-07-25 05:36:49', '2026-07-31 11:04:00'),
('security_lockout_duration_minutes', '15', '2026-07-25 05:36:49', '2026-07-29 15:57:11'),
('security_lockout_failed_attempts', '3', '2026-07-25 05:36:49', '2026-07-29 15:57:11'),
('security_maximum_password_length', '64', '2026-07-25 05:36:49', '2026-07-29 15:57:10'),
('security_password_expiry_days', '90', '2026-07-25 05:36:49', '2026-07-29 15:57:11'),
('security_session_timeout_minutes', '30', '2026-07-25 05:36:49', '2026-07-29 15:57:11'),
('system_configuration', '{\"companyName\":\"Human Resources Information System\",\"companyAddress\":\"Mines Geosciences Bureau, DENR Region X\",\"systemProfile\":\"Production\",\"developedBy\":\"\",\"workWeek\":[\"Mon\",\"Tue\",\"Wed\",\"Thu\",\"Fri\"],\"totalWorkHoursPerDay\":12,\"overtimeRules\":{\"regularOvertimePercent\":125,\"restDayOvertimePercent\":130,\"specialHolidayOvertimePercent\":150,\"regularHolidayOvertimePercent\":200},\"undertimeRules\":{\"enabled\":true,\"gracePeriodMinutes\":0,\"deductionPerHour\":100}}', '2026-07-25 05:36:49', '2026-07-25 05:36:49'),
('two_factor_enabled', '1', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_max_attempts', '3', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_otp_expiry_minutes', '5', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_require_admins', '0', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_require_all_users', '0', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_require_hr', '0', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_require_managers', '0', '2026-07-25 05:36:49', '2026-07-27 05:14:21'),
('two_factor_resend_delay_seconds', '0', '2026-07-25 05:36:49', '2026-07-31 10:14:29'),
('user_permissions', '{\"7\":{\"enabled\":true,\"modules\":{\"dashboard\":{\"enabled\":true,\"actions\":[\"view\"]},\"profile\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"serviceRecord\":{\"enabled\":true,\"actions\":[\"view\",\"edit\"]},\"users\":{\"enabled\":false,\"actions\":[]},\"permissions\":{\"enabled\":false,\"actions\":[]},\"settings\":{\"enabled\":false,\"actions\":[]},\"auditLogs\":{\"enabled\":false,\"actions\":[]},\"calendar\":{\"enabled\":true,\"actions\":[\"view\"]},\"employees\":{\"enabled\":false,\"actions\":[]},\"rewardsRecognition\":{\"enabled\":false,\"actions\":[]},\"attendance\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leave\":{\"enabled\":true,\"actions\":[\"view\",\"create\",\"edit\",\"approve\",\"reject\",\"export\"]},\"leaveBalance\":{\"enabled\":false,\"actions\":[]},\"payroll\":{\"enabled\":false,\"actions\":[]},\"reports\":{\"enabled\":false,\"actions\":[]},\"payslip\":{\"enabled\":true,\"actions\":[\"view\"]}}}}', '2026-07-28 22:48:20', '2026-07-31 10:32:41');

-- --------------------------------------------------------

--
-- Table structure for table `travel_orders`
--

CREATE TABLE `travel_orders` (
  `travel_order_id` int(10) UNSIGNED NOT NULL,
  `employee_id` int(10) UNSIGNED NOT NULL,
  `destination` varchar(255) NOT NULL,
  `purpose` varchar(255) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `assistance_labor` varchar(255) DEFAULT NULL,
  `appropriations` varchar(255) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `rejected_note` text DEFAULT NULL,
  `approved_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `recommended_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `filed_by_employee_id` int(10) UNSIGNED DEFAULT NULL,
  `recommended_at` datetime DEFAULT NULL,
  `employee_authorized_at` datetime DEFAULT NULL,
  -- `reviewed` is the Planning Officer's recommendation, resting between the desk that filed the
  -- order and the Regional Director's final approval.
  `status` enum('pending','reviewed','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(10) UNSIGNED NOT NULL,
  `username` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `email_updated_at` datetime DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `role_id` int(10) UNSIGNED NOT NULL,
  `status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  `password_changed_at` timestamp NULL DEFAULT current_timestamp(),
  `failed_login_attempts` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `two_factor_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `email_verified_at`, `email_updated_at`, `password_hash`, `role_id`, `status`, `must_change_password`, `password_changed_at`, `failed_login_attempts`, `locked_until`, `two_factor_enabled`, `is_archived`, `created_at`) VALUES
(1, 'admin', 'admin@gmail.com', NULL, NULL, '$2y$10$7L2Iz4v.gLbeF4ky9BL4uuwrKeA9njbuBUzjqutGa89fg2SGz3/AK', 1, 'Active', 0, '2026-07-25 05:36:50', 0, NULL, 0, 0, '2026-07-25 05:36:50'),
(2, 'louisse.kaye.aba@gmail.com', 'louisse.kaye.aba@gmail.com', NULL, NULL, '$2y$10$rhhD.EAzKznt6akFX9idAuGZvP3RJC7fKMseea32hsGFIromFvuwS', 6, 'Active', 0, '2026-08-06 03:58:45', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(3, 'joanne.rose.alvarez@gmail.com', 'joanne.rose.alvarez@gmail.com', NULL, NULL, '$2y$10$fJoOa0UDZT93SBt7cmSylecmOIb0XQ/KaJp0dihML0SN8UNXyx26q', 6, 'Active', 1, '2026-08-06 03:57:21', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(4, 'joy.christine.asis@gmail.com', 'joy.christine.asis@gmail.com', NULL, NULL, '$2y$10$.EQ9joupC0XxOIyirj7ucudj7GzwCGTQYVX/l/Z61WsiTaBW8JBcK', 6, 'Active', 1, '2026-08-06 03:57:21', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(5, 'gerald.baclayon@gmail.com', 'gerald.baclayon@gmail.com', NULL, NULL, '$2y$10$m6YBtjXtZzZtkZuNPcwAWu9tGVWK6puEWRvilq8wKbFdbWQbXnIC6', 3, 'Active', 0, '2026-08-06 04:04:28', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(6, 'anshawer.bara-acal@gmail.com', 'anshawer.bara-acal@gmail.com', NULL, NULL, '$2y$10$KyUYIAC0R7gqJjVNvw2Jd.c60XCmczi6Z897/N9t10sBmHnazz6T.', 6, 'Active', 1, '2026-08-06 03:57:21', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(7, 'brenz.ryan.bautista@gmail.com', 'brenz.ryan.bautista@gmail.com', NULL, NULL, '$2y$10$Z1UtrYF8geckkKLjsXcrU.vAP0rXDehj57mwjX/RF.tVj6VikkKni', 6, 'Active', 1, '2026-08-06 03:57:21', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(8, 'jeaneth.ann.bonavente@gmail.com', 'jeaneth.ann.bonavente@gmail.com', NULL, NULL, '$2y$10$FOiYRDy1kMzk814X05pUfOnDINkLDL9ZyIg4BtBxkh/T5w7bWLIsa', 5, 'Active', 1, '2026-08-06 03:57:21', 0, NULL, 0, 0, '2026-08-06 03:57:21'),
(9, 'lea.therese.bondad@gmail.com', 'lea.therese.bondad@gmail.com', NULL, NULL, '$2y$10$rHY/qMVZdJkIn5JAtyeGMerp33ZCnWYvVHkHqDNxR6WfCFvv1ur4u', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(10, 'earl.ven.kirby.budiongan@gmail.com', 'earl.ven.kirby.budiongan@gmail.com', NULL, NULL, '$2y$10$wq9650Ge3xJIClGyEBwGKeAihd.351UTsoeuDgDTJW4fnPBlJJaW2', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(11, 'quinne.marie.buhawe@gmail.com', 'quinne.marie.buhawe@gmail.com', NULL, NULL, '$2y$10$PxM6Fn55Wz835L0ApJAdHeKiQDn0kYb/7Bd3p6.As.fBod/HhKlNO', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(12, 'lemuel.cabahit@gmail.com', 'lemuel.cabahit@gmail.com', NULL, NULL, '$2y$10$fgiGZX.o3Vhf/zwapzTN0.lPoxPmR5rWyiYZg0ub8dtsTilCtI86O', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(13, 'almira.mae.cainglet@gmail.com', 'almira.mae.cainglet@gmail.com', NULL, NULL, '$2y$10$LrUU1iTNUHOMZ4js8RPOcu7hQ19443tGL/9yQqIHE89.gbZkkwpfy', 4, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(14, 'lazaro.iv.cajegas@gmail.com', 'lazaro.iv.cajegas@gmail.com', NULL, NULL, '$2y$10$Dj7ZKxsFZeIi5bcyxjn.8OQE2jyOrwHDItk1zwMZcBrvFN80BEh7W', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(15, 'gay.callanta@gmail.com', 'gay.callanta@gmail.com', NULL, NULL, '$2y$10$K2gCMSKSQTAxcQ7/jn66JehRpRTOJpEpry/fYfCS4X61ah7vFhli.', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(16, 'krissette.grace.campilan-bahala@gmail.com', 'krissette.grace.campilan-bahala@gmail.com', NULL, NULL, '$2y$10$q5IseKqqZsH.Wn5U3gNKM.ZtPKD7JB2KSFEkBHnp8LTSMLbRbRRoW', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(17, 'ai-let.castro@gmail.com', 'ai-let.castro@gmail.com', NULL, NULL, '$2y$10$QS8X2zdMyzAQ6AavEF0MAOJvUQFVW.5l.KQXwliCrsyxlhO2XLDa6', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(18, 'rubelen.dadula@gmail.com', 'rubelen.dadula@gmail.com', NULL, NULL, '$2y$10$lN1gxJW4dOQ.xGZMqthOCO2/.xBiB4kTI.86EiwIK.TNkOZTJgG1a', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(19, 'liberty.daitia@gmail.com', 'liberty.daitia@gmail.com', NULL, NULL, '$2y$10$XuBALnqNvlb8CVtzb59uL.XUBi0qUZl2THx/xVpl4QTj2czBrUAx2', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(20, 'mary.jossel.dispo@gmail.com', 'mary.jossel.dispo@gmail.com', NULL, NULL, '$2y$10$BCraIIskKXUnVqRxCnQ/HeOJ4.Px8mW7846MM4.i.NU.7Clo/2V5.', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(21, 'elvert.eludo@gmail.com', 'elvert.eludo@gmail.com', NULL, NULL, '$2y$10$zBR49wgWyegkPvzSYpPpt.KpQiwYn2UPnneH.dtcPOzdynzFF6kJa', 5, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(22, 'dominic.escobal@gmail.com', 'dominic.escobal@gmail.com', NULL, NULL, '$2y$10$O71cQFjKbFoKC85kYumzyeIDjNWNYGBu2y.O71cCjrIMaC15axuzm', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(23, 'daryl.faciol@gmail.com', 'daryl.faciol@gmail.com', NULL, NULL, '$2y$10$3l72oKWD1XHzCCfKBqAXYe5xmWtDnsh4wDc4luhFMIbCYzEGLzYQW', 6, 'Active', 1, '2026-08-06 03:57:22', 0, NULL, 0, 0, '2026-08-06 03:57:22'),
(24, 'rodante.felina@gmail.com', 'rodante.felina@gmail.com', NULL, NULL, '$2y$10$efYYrph12oR0zIOyryZTcuax9EEOVOPYCM5eyoc2hP.F9kHnINRe2', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(25, 'janice.gadia@gmail.com', 'janice.gadia@gmail.com', NULL, NULL, '$2y$10$aqgVe04ZHGSDmuJSZoO5Tu6Y9cLtzpGItIdnQrjjDA8ZOyS7bU.Ha', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(26, 'rey.gamayon@gmail.com', 'rey.gamayon@gmail.com', NULL, NULL, '$2y$10$AbCn/qpVaY/.VQNfD/zage0Y7RuVhzVBm3CkDNlZtOmo3QvaWoLQK', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(27, 'joven.clar.granada@gmail.com', 'joven.clar.granada@gmail.com', NULL, NULL, '$2y$10$acd.IGffNUWED0MZQEq6vuuVSRrR1cykuSkt3OnmGkb2kwP5cdpLe', 2, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(28, 'dulce.gualberto@gmail.com', 'dulce.gualberto@gmail.com', NULL, NULL, '$2y$10$EjnJQRfAbqOHsCdsDH2W8.qba0hb.c2hOKnQL17s.N8uqyIRQ41zO', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(29, 'janeth.faye.hadman@gmail.com', 'janeth.faye.hadman@gmail.com', NULL, NULL, '$2y$10$cJz21HInXWrQGK4Jh.voGOEOxmZ9HGYnDfBJKq/fvCqMKzdIZG3G6', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(30, 'jovelyn.jayme@gmail.com', 'jovelyn.jayme@gmail.com', NULL, NULL, '$2y$10$zNr/KccLkMGQjBC4Sj0eD.u5piUSwE.LXXosz2xfG6Z4wXeiFi5fO', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(31, 'herman.juanico@gmail.com', 'herman.juanico@gmail.com', NULL, NULL, '$2y$10$slZ9NjjLIXyCvwB21zmPteu2.64jY4CbkUMEGQ5.JpLdvd/fIBER.', 4, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(32, 'lou.marie.france.ladao@gmail.com', 'lou.marie.france.ladao@gmail.com', NULL, NULL, '$2y$10$Ss9EYi63fgqqeLvloDaUm.NBn9MBhiGjEXyhujfl3.o6LYlb.EWCu', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(33, 'sheena.mae.lantaca@gmail.com', 'sheena.mae.lantaca@gmail.com', NULL, NULL, '$2y$10$HkI/ttTXIiQtVBwB2CQGz.Q20SDxu1EpBuTnSCPeNZlQ2pO20oBE2', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(34, 'ralph.john.ligas@gmail.com', 'ralph.john.ligas@gmail.com', NULL, NULL, '$2y$10$jVOSDL26xIJwirJVY/2WC.K4pGPU6ZvbzYxVlgTicpNPNOq.RXkyO', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(35, 'lariza.amor.lucero@gmail.com', 'lariza.amor.lucero@gmail.com', NULL, NULL, '$2y$10$EUVChFQEZF4WRq80GcNT..qRG.FCdnZWQm5/DZnb6w/FyXQQh/Svm', 6, 'Active', 1, '2026-08-06 03:57:23', 0, NULL, 0, 0, '2026-08-06 03:57:23'),
(36, 'neil.maata@gmail.com', 'neil.maata@gmail.com', NULL, NULL, '$2y$10$veAk3oLuNuwOeft.vuF9Suepe/Ed4rgvbjmKyrL.fjcX2w02EN52a', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(37, 'jenisse.dowell.medel@gmail.com', 'jenisse.dowell.medel@gmail.com', NULL, NULL, '$2y$10$8FfbWwx1dl/ZG6alBDYuCe/e6uOl.KckIAwJW9/MNRQuXxdSGzPC2', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(38, 'rogin.aron.montalan@gmail.com', 'rogin.aron.montalan@gmail.com', NULL, NULL, '$2y$10$B0LzZgc9dKsrh.cAs7pBheyVpwYR8D0oHEnkas9FOO4SMRQOjD/Z6', 5, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(39, 'glenn.marcelo.noble@gmail.com', 'glenn.marcelo.noble@gmail.com', NULL, NULL, '$2y$10$k4KSfkQLhm00kSatojd3bOvLkpoP2x6MhGrRaOLZl0watqvZJfVly', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(40, 'maria.raniela.orteza@gmail.com', 'maria.raniela.orteza@gmail.com', NULL, NULL, '$2y$10$Q0yy7Bl15pp/giTooKrC7e4TVGyeebcg6uaV6DbSMcSLwWr/PKSNC', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(41, 'may.lara.bea.paulin@gmail.com', 'may.lara.bea.paulin@gmail.com', NULL, NULL, '$2y$10$91vVDNJW/ry6fY/m0bBZHeJvZv71KmpzMsL.KJGjp54S5HSdDiZUK', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(42, 'gaudencio.jr.paulma@gmail.com', 'gaudencio.jr.paulma@gmail.com', NULL, NULL, '$2y$10$I3Txvyb4PBFHSG8FN1RW..6fagqHff1JFK8xWcYIjCBB.zjAvz/9K', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(43, 'kayshe.joy.pelingon@gmail.com', 'kayshe.joy.pelingon@gmail.com', NULL, NULL, '$2y$10$3/EZybgVRTI6x.Acsr/f8Og./MskVyycTDGSw7Jsi4qgjLEDi6U3S', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(44, 'june.ray.penaso@gmail.com', 'june.ray.penaso@gmail.com', NULL, NULL, '$2y$10$D.Og9giuQDvRzVxQhshdDuTyVhVyUhxIZ1r9lNZWEE/Sp11rgn3XC', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(45, 'raymund.postrano@gmail.com', 'raymund.postrano@gmail.com', NULL, NULL, '$2y$10$ZzPg5g6O4ToUAuE39t.6/ef04MAbuQCKmE//71NxizZfa2VUSJksy', 5, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(46, 'ritzielaine.rosse.sales@gmail.com', 'ritzielaine.rosse.sales@gmail.com', NULL, NULL, '$2y$10$uehG39LP5MW31nVVTUnu5OtG9kF9m9nPzHGIZRT4.RvE.aKEx1iUu', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(47, 'daphne.niccole.serojales@gmail.com', 'daphne.niccole.serojales@gmail.com', NULL, NULL, '$2y$10$io3tvCFW/jcE02svF9HI0OM0S4iHDYp4IZJSWWdhT8gZ1HRhhhDV6', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(48, 'maruel.silverio@gmail.com', 'maruel.silverio@gmail.com', NULL, NULL, '$2y$10$MHYSZSpV3.gAfLv17dIeKeE1qq2M5Une3LkLrfhsN8BOImOC2.YNW', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(49, 'jay.simeon@gmail.com', 'jay.simeon@gmail.com', NULL, NULL, '$2y$10$/uEIutnGy7XlGxo.KWqmJOro1bYRZFACCMqqo8ySCu2EKyQbnC8n2', 6, 'Active', 1, '2026-08-06 03:57:24', 0, NULL, 0, 0, '2026-08-06 03:57:24'),
(50, 'gladys.tupaz@gmail.com', 'gladys.tupaz@gmail.com', NULL, NULL, '$2y$10$UOpWGadcyBzZCXY7FDNKs.Fyv8Ho/4wFVYOtZU1WHkFyxn5H7E5da', 6, 'Active', 1, '2026-08-06 03:57:25', 0, NULL, 0, 0, '2026-08-06 03:57:25'),
(51, 'virginia.verdejo@gmail.com', 'virginia.verdejo@gmail.com', NULL, NULL, '$2y$10$AcztL5TR9EP9PdJSF9iT8Oe86teAA0X8Uphj3zwbTj39/6bOJIosi', 6, 'Active', 1, '2026-08-06 03:57:25', 0, NULL, 0, 0, '2026-08-06 03:57:25'),
(52, 'alvin.villanueva@gmail.com', 'alvin.villanueva@gmail.com', NULL, NULL, '$2y$10$u/0HefYJ7tDKsqCD3N2c3eS8FktHj7/Og.J4TspX1vd0WOZheQq4q', 5, 'Active', 1, '2026-08-06 03:57:25', 0, NULL, 0, 0, '2026-08-06 03:57:25');

-- --------------------------------------------------------

--
-- Table structure for table `withholding_tax_deductions`
--

CREATE TABLE `withholding_tax_deductions` (
  `id` int(10) UNSIGNED NOT NULL,
  `code` varchar(80) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `calculation_type` enum('fixed','percentage','tiered','bracket') NOT NULL DEFAULT 'fixed',
  `default_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `default_rate` decimal(12,8) NOT NULL DEFAULT 0.00000000,
  `basis` varchar(40) NOT NULL DEFAULT 'basic_salary',
  `threshold_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `threshold_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`threshold_rules`)),
  `base_floor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_cap` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_payroll` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `withholding_tax_deductions`
--

INSERT INTO `withholding_tax_deductions` (`id`, `code`, `name`, `description`, `calculation_type`, `default_amount`, `default_rate`, `basis`, `threshold_amount`, `threshold_rules`, `base_floor`, `base_cap`, `is_recurring`, `is_active`, `show_in_payroll`, `sort_order`, `created_at`, `updated_at`) VALUES
(26, 'withholding_tax', 'Withholding Tax', 'BIR withholding tax on compensation, monthly. TRAIN Law (RA 10963) second-phase table, in force since 1 January 2023: nothing up to ₱20,833, then 15%, 20%, 25%, 30% and 35% on the excess over ₱20,833, ₱33,333, ₱66,667, ₱166,667 and ₱666,667 respectively. Charged on taxable income, which is gross less the mandatory contributions.', 'bracket', 0.00, 0.00000000, 'taxable_income', 0.00, '[{\"up_to\":20833,\"base_tax\":0,\"rate\":0,\"excess_over\":0},{\"up_to\":33332,\"base_tax\":0,\"rate\":15,\"excess_over\":20833},{\"up_to\":66666,\"base_tax\":1875,\"rate\":20,\"excess_over\":33333},{\"up_to\":166666,\"base_tax\":8541.8,\"rate\":25,\"excess_over\":66667},{\"up_to\":666666,\"base_tax\":33541.8,\"rate\":30,\"excess_over\":166667},{\"up_to\":null,\"base_tax\":183541.8,\"rate\":35,\"excess_over\":666667}]', 0.00, NULL, 0, 1, 1, 260, '2026-07-29 06:31:29', '2026-07-29 12:40:33');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `allowance`
--
ALTER TABLE `allowance`
  ADD PRIMARY KEY (`allowance_id`);

--
-- Indexes for table `announcements`
--
ALTER TABLE `announcements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_announcements_start_date` (`start_date`),
  ADD KEY `idx_announcements_end_date` (`end_date`);

--
-- Indexes for table `attendance_adjustments`
--
ALTER TABLE `attendance_adjustments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_attendance_adjustments_employee_date` (`employee_id`,`attendance_date`),
  ADD KEY `idx_attendance_adjustments_status` (`status`),
  ADD KEY `idx_attendance_adjustments_record` (`attendance_daily_record_id`),
  ADD KEY `idx_attendance_adjustments_requested_by` (`requested_by_user_id`),
  ADD KEY `idx_attendance_adjustments_reviewed_by` (`reviewed_by_user_id`);

--
-- Indexes for table `attendance_daily_records`
--
ALTER TABLE `attendance_daily_records`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_attendance_daily_employee_date` (`employee_id`,`attendance_date`),
  ADD KEY `idx_attendance_daily_date` (`attendance_date`),
  ADD KEY `idx_attendance_daily_status` (`status`),
  ADD KEY `idx_attendance_daily_updated_by` (`updated_by_user_id`);

--
-- Indexes for table `attendance_deductions`
--
ALTER TABLE `attendance_deductions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_attendance_code` (`code`),
  ADD UNIQUE KEY `uq_attendance_name` (`name`),
  ADD KEY `idx_attendance_active` (`is_active`);

--
-- Indexes for table `attendance_logs`
--
ALTER TABLE `attendance_logs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_attendance_logs_punch` (`employee_id`,`punch_at`,`punch_type`),
  ADD KEY `idx_attendance_logs_employee_date` (`employee_id`,`punch_at`),
  ADD KEY `idx_attendance_logs_created_by` (`created_by_user_id`);

--
-- Indexes for table `audit_logs`
--
ALTER TABLE `audit_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audit_logs_user_id` (`user_id`),
  ADD KEY `idx_audit_logs_action` (`action`),
  ADD KEY `idx_audit_logs_category` (`category`),
  ADD KEY `idx_audit_logs_created_at` (`created_at`);

--
-- Indexes for table `backup_history`
--
ALTER TABLE `backup_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_backup_history_created_at` (`created_at`),
  ADD KEY `idx_backup_history_type` (`backup_type`),
  ADD KEY `idx_backup_history_status` (`status`),
  ADD KEY `idx_backup_history_created_by` (`created_by_user_id`);

--
-- Indexes for table `cash_advance_requests`
--
ALTER TABLE `cash_advance_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_cash_advance_employee_id` (`employee_id`),
  ADD KEY `idx_cash_advance_status` (`status`),
  ADD KEY `idx_cash_advance_request_date` (`request_date`),
  ADD KEY `idx_cash_advance_archived` (`is_archived`),
  ADD KEY `idx_cash_advance_created_by` (`created_by_user_id`);

--
-- Indexes for table `compensatory`
--
ALTER TABLE `compensatory`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_compensatory_employee_id` (`employee_id`),
  ADD KEY `idx_compensatory_status` (`status`),
  ADD KEY `idx_compensatory_start_date` (`start_date`),
  ADD KEY `idx_compensatory_end_date` (`end_date`),
  ADD KEY `idx_compensatory_approved_by` (`approved_by`),
  ADD KEY `idx_compensatory_endorsed_by_employee_id` (`endorsed_by_employee_id`),
  ADD KEY `idx_compensatory_reviewed_by_employee_id` (`reviewed_by_employee_id`),
  ADD KEY `idx_compensatory_approved_by_employee_id` (`approved_by_employee_id`);

--
-- Indexes for table `designations`
--
ALTER TABLE `designations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_designations_division_id` (`division_id`);

--
-- Indexes for table `divisions`
--
ALTER TABLE `divisions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`),
  ADD UNIQUE KEY `uq_divisions_name` (`name`);

--
-- Indexes for table `division_opcr_assignments`
--
ALTER TABLE `division_opcr_assignments`
  ADD PRIMARY KEY (`assignment_id`),
  ADD UNIQUE KEY `uq_division_opcr_no` (`opcr_no`),
  ADD KEY `idx_division_opcr_template` (`template_id`),
  ADD KEY `idx_division_opcr_employee` (`employee_id`),
  ADD KEY `idx_division_opcr_division` (`division`),
  ADD KEY `idx_division_opcr_status` (`assignment_status`),
  ADD KEY `idx_division_opcr_archived` (`is_archived`);

--
-- Indexes for table `employeededuction`
--
ALTER TABLE `employeededuction`
  ADD PRIMARY KEY (`employee_deduction_id`),
  ADD KEY `idx_employee_deductions_employee` (`employee_id`),
  ADD KEY `idx_employee_deductions_type` (`deduction_type_id`),
  ADD KEY `idx_employee_deductions_active` (`is_active`,`is_recurring`);

--
-- Indexes for table `employees`
--
ALTER TABLE `employees`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_employees_employee_id` (`employee_id`),
  ADD UNIQUE KEY `uq_employees_email` (`email`),
  ADD KEY `idx_employees_division_id` (`division_id`),
  ADD KEY `idx_employees_designation_id` (`designation_id`);

--
-- Indexes for table `gsis_deductions`
--
ALTER TABLE `gsis_deductions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_gsis_code` (`code`),
  ADD UNIQUE KEY `uq_gsis_name` (`name`),
  ADD KEY `idx_gsis_active` (`is_active`);

--
-- Indexes for table `holidays`
--
ALTER TABLE `holidays`
  ADD PRIMARY KEY (`holidays_id`),
  ADD UNIQUE KEY `holiday_date` (`holiday_date`);

--
-- Indexes for table `ipcr`
--
ALTER TABLE `ipcr`
  ADD PRIMARY KEY (`ipcr_id`),
  ADD KEY `idx_ipcr_employee_id` (`employee_id`),
  ADD KEY `idx_ipcr_is_archived` (`is_archived`),
  ADD KEY `idx_ipcr_period` (`period_from`,`period_to`),
  ADD KEY `idx_ipcr_status` (`status`);

--
-- Indexes for table `ipcr_verification_files`
--
ALTER TABLE `ipcr_verification_files`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_ipcr_verification_ipcr_id` (`ipcr_id`),
  ADD KEY `idx_ipcr_verification_output_id` (`output_id`),
  ADD KEY `fk_ipcr_verification_user` (`uploaded_by_user_id`);

--
-- Indexes for table `leave_attachments`
--
ALTER TABLE `leave_attachments`
  ADD PRIMARY KEY (`leave_attachments_id`),
  ADD KEY `fk_attach_request` (`leave_request_id`);

--
-- Indexes for table `leave_credits`
--
ALTER TABLE `leave_credits`
  ADD PRIMARY KEY (`leave_credits_id`),
  ADD UNIQUE KEY `uq_credits` (`employee_id`,`leave_type_id`,`year`),
  ADD KEY `fk_credits_leavetype` (`leave_type_id`);

--
-- Indexes for table `leave_monetization_requests`
--
ALTER TABLE `leave_monetization_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_leave_monetization_employee` (`employee_id`),
  ADD KEY `idx_leave_monetization_status` (`status`),
  ADD KEY `idx_leave_monetization_date_filed` (`date_filed`),
  ADD KEY `fk_leave_monetization_leave_type` (`leave_type_id`);

--
-- Indexes for table `leave_requests`
--
ALTER TABLE `leave_requests`
  ADD PRIMARY KEY (`leave_request_id`),
  ADD KEY `fk_req_employee` (`employee_id`),
  ADD KEY `fk_req_reviewed_by_employee` (`reviewed_by_employee_id`),
  ADD KEY `fk_req_approved_by_employee` (`approved_by_employee_id`),
  ADD KEY `fk_req_leavetype` (`leave_type_id`);

--
-- Indexes for table `leave_types`
--
ALTER TABLE `leave_types`
  ADD PRIMARY KEY (`leave_type_id`),
  ADD UNIQUE KEY `code` (`code`);

--
-- Indexes for table `loan_records`
--
ALTER TABLE `loan_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_loan_records_employee_id` (`employee_id`),
  ADD KEY `idx_loan_records_status` (`status`),
  ADD KEY `idx_loan_records_loan_type` (`loan_type`),
  ADD KEY `idx_loan_records_date_filed` (`date_filed`),
  ADD KEY `idx_loan_records_archived` (`is_archived`);

--
-- Indexes for table `messages`
--
ALTER TABLE `messages`
  ADD PRIMARY KEY (`Message_ID`),
  ADD KEY `idx_messages_sender_receiver` (`sender_id`,`receiver_id`),
  ADD KEY `idx_messages_receiver_read` (`receiver_id`,`is_read`),
  ADD KEY `idx_messages_created_at` (`created_at`);

--
-- Indexes for table `module_access_requests`
--
ALTER TABLE `module_access_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_access_requests_user` (`user_id`),
  ADD KEY `idx_access_requests_status` (`status`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_notifications_user_id` (`user_id`),
  ADD KEY `idx_notifications_user_read` (`user_id`,`is_read`),
  ADD KEY `idx_notifications_type` (`type`),
  ADD KEY `idx_notifications_created_at` (`created_at`);

--
-- Indexes for table `opcr_templates`
--
ALTER TABLE `opcr_templates`
  ADD PRIMARY KEY (`template_id`),
  ADD KEY `idx_opcr_templates_name` (`template_name`),
  ADD KEY `idx_opcr_templates_category` (`category`),
  ADD KEY `idx_opcr_templates_is_archived` (`is_archived`);

--
-- Indexes for table `other_deductions`
--
ALTER TABLE `other_deductions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_other_code` (`code`),
  ADD UNIQUE KEY `uq_other_name` (`name`),
  ADD KEY `idx_other_active` (`is_active`);

--
-- Indexes for table `overtime`
--
ALTER TABLE `overtime`
  ADD PRIMARY KEY (`overtime_id`),
  ADD KEY `idx_overtime_employee_id` (`employee_id`),
  ADD KEY `idx_overtime_status` (`status`),
  ADD KEY `idx_overtime_work_date` (`work_date`),
  ADD KEY `idx_overtime_approved_by` (`approved_by`),
  ADD KEY `idx_overtime_created_by` (`created_by`);

--
-- Indexes for table `pagibig_deductions`
--
ALTER TABLE `pagibig_deductions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_pagibig_code` (`code`),
  ADD UNIQUE KEY `uq_pagibig_name` (`name`),
  ADD KEY `idx_pagibig_active` (`is_active`);

--
-- Indexes for table `pass_slip`
--
ALTER TABLE `pass_slip`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pass_slip_employee_id` (`employee_id`),
  ADD KEY `idx_pass_slip_pass_date` (`pass_date`),
  ADD KEY `idx_pass_slip_approved_by` (`approved_by`);

--
-- Indexes for table `payroll`
--
ALTER TABLE `payroll`
  ADD PRIMARY KEY (`payroll_id`),
  ADD KEY `employee_id` (`employee_id`);

--
-- Indexes for table `payrollapproval`
--
ALTER TABLE `payrollapproval`
  ADD PRIMARY KEY (`approval_id`),
  ADD KEY `idx_payroll_approval_payroll` (`payroll_id`),
  ADD KEY `idx_payroll_approval_employee` (`approver_employee_id`),
  ADD KEY `idx_payroll_approval_user` (`approver_user_id`),
  ADD KEY `idx_payroll_approval_action_date` (`action_date`);

--
-- Indexes for table `payrolldeduction`
--
ALTER TABLE `payrolldeduction`
  ADD PRIMARY KEY (`payroll_deduction_id`),
  ADD KEY `payroll_id` (`payroll_id`),
  ADD KEY `fk_payrolldeduction_type` (`deduction_type_id`);

--
-- Indexes for table `payrollmeta`
--
ALTER TABLE `payrollmeta`
  ADD PRIMARY KEY (`payroll_id`);

--
-- Indexes for table `phic_deductions`
--
ALTER TABLE `phic_deductions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_phic_code` (`code`),
  ADD UNIQUE KEY `uq_phic_name` (`name`),
  ADD KEY `idx_phic_active` (`is_active`);

--
-- Indexes for table `rate_limits`
--
ALTER TABLE `rate_limits`
  ADD PRIMARY KEY (`bucket_key`),
  ADD KEY `idx_rate_limits_rule` (`rule_key`),
  ADD KEY `idx_rate_limits_blocked_until` (`blocked_until`),
  ADD KEY `idx_rate_limits_updated_at` (`updated_at`);

--
-- Indexes for table `reward_certificates`
--
ALTER TABLE `reward_certificates`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_reward_certificates_cycle` (`cycle_id`),
  ADD UNIQUE KEY `uniq_reward_certificates_number` (`certificate_number`),
  ADD KEY `idx_reward_certificates_employee` (`employee_record_id`);

--
-- Indexes for table `reward_certificate_sequence`
--
ALTER TABLE `reward_certificate_sequence`
  ADD PRIMARY KEY (`award_year`);

--
-- Indexes for table `reward_cycles`
--
ALTER TABLE `reward_cycles`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_reward_cycles_status` (`status`),
  ADD KEY `idx_reward_cycles_archived` (`is_archived`),
  ADD KEY `fk_reward_cycles_user` (`created_by_user_id`);

--
-- Indexes for table `reward_cycle_votes`
--
ALTER TABLE `reward_cycle_votes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_reward_cycle_vote_voter` (`cycle_id`,`voter_user_id`),
  ADD KEY `idx_reward_cycle_votes_nominee` (`nominee_employee_id`),
  ADD KEY `fk_reward_cycle_votes_voter` (`voter_user_id`);

--
-- Indexes for table `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_roles_name` (`name`);

--
-- Indexes for table `profile_edit_requests`
--
ALTER TABLE `profile_edit_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_profile_edit_requests_open` (`employee_record_id`,`section`,`status`),
  ADD KEY `idx_profile_edit_requests_user` (`requested_by_user_id`),
  ADD KEY `idx_profile_edit_requests_decider` (`decided_by_user_id`);

--
-- Indexes for table `service_record_print_requests`
--
ALTER TABLE `service_record_print_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_sr_print_employee` (`employee_record_id`),
  ADD KEY `idx_sr_print_requester` (`requested_by_user_id`),
  ADD KEY `idx_sr_print_status` (`status`);

--
-- Indexes for table `service_records`
--
ALTER TABLE `service_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_service_records_employee` (`employee_record_id`,`service_from`),
  ADD KEY `idx_service_records_open` (`employee_record_id`,`service_to`);

--
-- Indexes for table `settings`
--
ALTER TABLE `settings`
  ADD PRIMARY KEY (`setting_key`);

--
-- Indexes for table `travel_orders`
--
ALTER TABLE `travel_orders`
  ADD PRIMARY KEY (`travel_order_id`),
  ADD KEY `idx_travel_orders_employee_id` (`employee_id`),
  ADD KEY `idx_travel_orders_status` (`status`),
  ADD KEY `idx_travel_orders_start_date` (`start_date`),
  ADD KEY `idx_travel_orders_approved_by_employee_id` (`approved_by_employee_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_users_username` (`username`),
  ADD UNIQUE KEY `uq_users_email` (`email`),
  ADD KEY `idx_users_role_id` (`role_id`),
  ADD KEY `idx_users_status` (`status`);

--
-- Indexes for table `withholding_tax_deductions`
--
ALTER TABLE `withholding_tax_deductions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_withholding_tax_code` (`code`),
  ADD UNIQUE KEY `uq_withholding_tax_name` (`name`),
  ADD KEY `idx_withholding_tax_active` (`is_active`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `allowance`
--
ALTER TABLE `allowance`
  MODIFY `allowance_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `announcements`
--
ALTER TABLE `announcements`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `attendance_adjustments`
--
ALTER TABLE `attendance_adjustments`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `attendance_daily_records`
--
ALTER TABLE `attendance_daily_records`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `attendance_deductions`
--
ALTER TABLE `attendance_deductions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1001;

--
-- AUTO_INCREMENT for table `attendance_logs`
--
ALTER TABLE `attendance_logs`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `audit_logs`
--
ALTER TABLE `audit_logs`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT for table `backup_history`
--
ALTER TABLE `backup_history`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `cash_advance_requests`
--
ALTER TABLE `cash_advance_requests`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `compensatory`
--
ALTER TABLE `compensatory`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `designations`
--
ALTER TABLE `designations`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=39;

--
-- AUTO_INCREMENT for table `divisions`
--
ALTER TABLE `divisions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `division_opcr_assignments`
--
ALTER TABLE `division_opcr_assignments`
  MODIFY `assignment_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `employeededuction`
--
ALTER TABLE `employeededuction`
  MODIFY `employee_deduction_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `employees`
--
ALTER TABLE `employees`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=52;

--
-- AUTO_INCREMENT for table `gsis_deductions`
--
ALTER TABLE `gsis_deductions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2007;

--
-- AUTO_INCREMENT for table `holidays`
--
ALTER TABLE `holidays`
  MODIFY `holidays_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ipcr`
--
ALTER TABLE `ipcr`
  MODIFY `ipcr_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ipcr_verification_files`
--
ALTER TABLE `ipcr_verification_files`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `leave_attachments`
--
ALTER TABLE `leave_attachments`
  MODIFY `leave_attachments_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `leave_credits`
--
ALTER TABLE `leave_credits`
  MODIFY `leave_credits_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1209;

--
-- AUTO_INCREMENT for table `leave_monetization_requests`
--
ALTER TABLE `leave_monetization_requests`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `leave_requests`
--
ALTER TABLE `leave_requests`
  MODIFY `leave_request_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `leave_types`
--
ALTER TABLE `leave_types`
  MODIFY `leave_type_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT for table `loan_records`
--
ALTER TABLE `loan_records`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `messages`
--
ALTER TABLE `messages`
  MODIFY `Message_ID` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `module_access_requests`
--
ALTER TABLE `module_access_requests`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=66;

--
-- AUTO_INCREMENT for table `opcr_templates`
--
ALTER TABLE `opcr_templates`
  MODIFY `template_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `other_deductions`
--
ALTER TABLE `other_deductions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6007;

--
-- AUTO_INCREMENT for table `overtime`
--
ALTER TABLE `overtime`
  MODIFY `overtime_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `pagibig_deductions`
--
ALTER TABLE `pagibig_deductions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3001;

--
-- AUTO_INCREMENT for table `pass_slip`
--
ALTER TABLE `pass_slip`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payroll`
--
ALTER TABLE `payroll`
  MODIFY `payroll_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payrollapproval`
--
ALTER TABLE `payrollapproval`
  MODIFY `approval_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `payrolldeduction`
--
ALTER TABLE `payrolldeduction`
  MODIFY `payroll_deduction_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `phic_deductions`
--
ALTER TABLE `phic_deductions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4001;

--
-- AUTO_INCREMENT for table `reward_certificates`
--
ALTER TABLE `reward_certificates`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `reward_cycles`
--
ALTER TABLE `reward_cycles`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `reward_cycle_votes`
--
ALTER TABLE `reward_cycle_votes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `roles`
--
ALTER TABLE `roles`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;

--
-- AUTO_INCREMENT for table `profile_edit_requests`
--
ALTER TABLE `profile_edit_requests`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `service_record_print_requests`
--
ALTER TABLE `service_record_print_requests`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `service_records`
--
ALTER TABLE `service_records`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `travel_orders`
--
ALTER TABLE `travel_orders`
  MODIFY `travel_order_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=53;

--
-- AUTO_INCREMENT for table `withholding_tax_deductions`
--
ALTER TABLE `withholding_tax_deductions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5001;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `attendance_adjustments`
--
ALTER TABLE `attendance_adjustments`
  ADD CONSTRAINT `fk_attendance_adjustments_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_attendance_adjustments_record` FOREIGN KEY (`attendance_daily_record_id`) REFERENCES `attendance_daily_records` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_attendance_adjustments_requested_by` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_attendance_adjustments_reviewed_by` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `attendance_daily_records`
--
ALTER TABLE `attendance_daily_records`
  ADD CONSTRAINT `fk_attendance_daily_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_attendance_daily_updated_by` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `attendance_logs`
--
ALTER TABLE `attendance_logs`
  ADD CONSTRAINT `fk_attendance_logs_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_attendance_logs_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `cash_advance_requests`
--
ALTER TABLE `cash_advance_requests`
  ADD CONSTRAINT `fk_cash_advance_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `compensatory`
--
ALTER TABLE `compensatory`
  ADD CONSTRAINT `fk_compensatory_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_compensatory_approved_by_employee` FOREIGN KEY (`approved_by_employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_compensatory_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_compensatory_endorsed_by_employee` FOREIGN KEY (`endorsed_by_employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_compensatory_reviewed_by_employee` FOREIGN KEY (`reviewed_by_employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `designations`
--
ALTER TABLE `designations`
  ADD CONSTRAINT `fk_designations_division` FOREIGN KEY (`division_id`) REFERENCES `divisions` (`id`);

--
-- Constraints for table `employeededuction`
--
ALTER TABLE `employeededuction`
  ADD CONSTRAINT `fk_employee_deductions_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `employees`
--
ALTER TABLE `employees`
  ADD CONSTRAINT `fk_employees_designation_id` FOREIGN KEY (`designation_id`) REFERENCES `designations` (`id`),
  ADD CONSTRAINT `fk_employees_division_id` FOREIGN KEY (`division_id`) REFERENCES `divisions` (`id`);

--
-- Constraints for PDS profile tables
--
ALTER TABLE `employee_family_background`
  ADD CONSTRAINT `fk_employee_family_background_employee` FOREIGN KEY (`employee_record_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE;

ALTER TABLE `employee_children`
  ADD CONSTRAINT `fk_employee_children_employee` FOREIGN KEY (`employee_record_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE;

ALTER TABLE `employee_education_background`
  ADD CONSTRAINT `fk_employee_education_background_employee` FOREIGN KEY (`employee_record_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `ipcr`
--
ALTER TABLE `ipcr`
  ADD CONSTRAINT `fk_ipcr_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `ipcr_verification_files`
--
ALTER TABLE `ipcr_verification_files`
  ADD CONSTRAINT `fk_ipcr_verification_ipcr` FOREIGN KEY (`ipcr_id`) REFERENCES `ipcr` (`ipcr_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ipcr_verification_user` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `leave_attachments`
--
ALTER TABLE `leave_attachments`
  ADD CONSTRAINT `fk_attach_request` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests` (`leave_request_id`);

--
-- Constraints for table `leave_credits`
--
ALTER TABLE `leave_credits`
  ADD CONSTRAINT `fk_credits_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_credits_leavetype` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`leave_type_id`);

--
-- Constraints for table `leave_monetization_requests`
--
ALTER TABLE `leave_monetization_requests`
  ADD CONSTRAINT `fk_leave_monetization_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_leave_monetization_leave_type` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`leave_type_id`);

--
-- Constraints for table `leave_requests`
--
ALTER TABLE `leave_requests`
  ADD CONSTRAINT `fk_req_approved_by_employee` FOREIGN KEY (`approved_by_employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_req_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`),
  ADD CONSTRAINT `fk_req_leavetype` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`leave_type_id`),
  ADD CONSTRAINT `fk_req_reviewed_by_employee` FOREIGN KEY (`reviewed_by_employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `loan_records`
--
ALTER TABLE `loan_records`
  ADD CONSTRAINT `fk_loan_records_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `module_access_requests`
--
ALTER TABLE `module_access_requests`
  ADD CONSTRAINT `fk_access_requests_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notifications_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `overtime`
--
ALTER TABLE `overtime`
  ADD CONSTRAINT `fk_overtime_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `pass_slip`
--
ALTER TABLE `pass_slip`
  ADD CONSTRAINT `fk_pass_slip_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `fk_pass_slip_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`);

--
-- Constraints for table `payrollapproval`
--
ALTER TABLE `payrollapproval`
  ADD CONSTRAINT `fk_payroll_approval_payroll` FOREIGN KEY (`payroll_id`) REFERENCES `payroll` (`payroll_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_payroll_approval_user` FOREIGN KEY (`approver_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `payrollmeta`
--
ALTER TABLE `payrollmeta`
  ADD CONSTRAINT `fk_payroll_meta_payroll` FOREIGN KEY (`payroll_id`) REFERENCES `payroll` (`payroll_id`) ON DELETE CASCADE;

--
-- Constraints for table `reward_certificates`
--
ALTER TABLE `reward_certificates`
  ADD CONSTRAINT `fk_reward_certificates_cycle` FOREIGN KEY (`cycle_id`) REFERENCES `reward_cycles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_reward_certificates_employee` FOREIGN KEY (`employee_record_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `reward_cycles`
--
ALTER TABLE `reward_cycles`
  ADD CONSTRAINT `fk_reward_cycles_user` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `reward_cycle_votes`
--
ALTER TABLE `reward_cycle_votes`
  ADD CONSTRAINT `fk_reward_cycle_votes_cycle` FOREIGN KEY (`cycle_id`) REFERENCES `reward_cycles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_reward_cycle_votes_employee` FOREIGN KEY (`nominee_employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_reward_cycle_votes_voter` FOREIGN KEY (`voter_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `profile_edit_requests`
--
ALTER TABLE `profile_edit_requests`
  ADD CONSTRAINT `fk_profile_edit_employee` FOREIGN KEY (`employee_record_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_profile_edit_requester` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_profile_edit_decider` FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `service_record_print_requests`
--
ALTER TABLE `service_record_print_requests`
  ADD CONSTRAINT `fk_sr_print_employee` FOREIGN KEY (`employee_record_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_sr_print_requester` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
SET FOREIGN_KEY_CHECKS = 1;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
