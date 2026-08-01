import React, { useEffect, useState } from "react";
import ServiceRecordTable from "../../../module/serviceRecord/ServiceRecordTable";
import { fetchServiceRecord } from "../../../services/api";

/**
 * Service record shown on the employee profile.
 *
 * This used to synthesise a single row from the employee's *current* designation and salary, which
 * looked like a service record but could never show history — `employees` keeps only current state.
 * It now reads the real `service_records` rows.
 */
export default function ServiceRecordSection({ values }) {
  const employeeRecordId = values?.employeeRecordId || values?.id || null;
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadRecord = async () => {
      setLoading(true);

      try {
        const result = await fetchServiceRecord(employeeRecordId);

        if (!active) {
          return;
        }

        setRecords(Array.isArray(result?.records) ? result.records : []);
        setError("");
      } catch (requestError) {
        if (active) {
          setRecords([]);
          setError(requestError.response?.data?.message || "Unable to load the service record.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadRecord();

    return () => {
      active = false;
    };
  }, [employeeRecordId]);

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="border-b border-slate-100 pb-4">
        <h3 className="m-0 text-lg font-semibold text-slate-950">Service Record</h3>
        <p className="m-0 mt-1 text-sm leading-6 text-slate-500">
          Chronological record of appointments, salaries, and separations (CS Form No. 1).
        </p>
      </div>

      <div className="mt-5">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : (
          <ServiceRecordTable records={records} loading={loading} />
        )}
      </div>
    </section>
  );
}
