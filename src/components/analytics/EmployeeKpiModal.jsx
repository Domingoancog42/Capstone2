import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

const ratingStatus = (rating) => rating === null ? 'Pending' : rating >= 4.5 ? 'Outstanding' : rating >= 3.5 ? 'Very Satisfactory' : rating >= 2.5 ? 'Satisfactory' : rating >= 1.5 ? 'Unsatisfactory' : 'Poor';
const fieldClass = 'rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';
const buttonClass = 'inline-flex items-center justify-center gap-1 rounded-lg border border-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-slate-800';

export default function EmployeeKpiModal({ records = [], year, onClose }) {
  const dialog = useRef(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const employees = useMemo(() => {
    const grouped = new Map();
    records.forEach((record) => {
      const key = String(record.employee_id);
      if (!grouped.has(key)) grouped.set(key, { ...record, records: [] });
      grouped.get(key).records.push(record);
    });
    return [...grouped.values()].map((employee) => {
      const ratings = employee.records.filter((record) => record.rating !== null && Number(record.rating) > 0);
      const rating = ratings.length ? ratings.reduce((sum, record) => sum + Number(record.rating), 0) / ratings.length : null;
      return { ...employee, rating, status: ratingStatus(rating) };
    }).sort((a, b) => a.employee_name.localeCompare(b.employee_name));
  }, [records]);
  const departments = [...new Set(records.map((record) => record.department).filter(Boolean))].sort();
  const filtered = employees.filter((employee) => (!department || employee.department === department)
    && (!status || employee.status === status)
    && `${employee.employee_name} ${employee.employee_code} ${employee.department}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 5));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * 5;
  const changeFilter = (setter) => (event) => { setter(event.target.value); setPage(1); setSelected(null); };

  return (
    <dialog ref={dialog} onCancel={onClose} onClick={(event) => { if (event.target === dialog.current) onClose(); }} aria-labelledby="employee-kpi-title" className="w-[calc(100%-2rem)] max-w-4xl rounded-2xl border border-blue-100 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-600 dark:bg-slate-800"><Activity size={24} /></div>
          <div className="flex-1"><h2 id="employee-kpi-title" className="text-xl font-bold">All Employee KPI</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Employee performance from OPCR and IPCR records · {year || 'Current period'}</p></div>
          <button type="button" onClick={onClose} aria-label="Close employee KPI" className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <label className={`${fieldClass} flex items-center gap-2`}><Search size={16} /><input autoFocus aria-label="Search employees" placeholder="Search employee (name, division)..." value={search} onChange={changeFilter(setSearch)} className="min-w-0 flex-1 bg-transparent outline-none" /></label>
          <select aria-label="Division" value={department} onChange={changeFilter(setDepartment)} className={fieldClass}><option value="">All Divisions</option>{departments.map((name) => <option key={name}>{name}</option>)}</select>
          <select aria-label="Rating status" value={status} onChange={changeFilter(setStatus)} className={fieldClass}><option value="">All Rating Status</option>{['Outstanding', 'Very Satisfactory', 'Satisfactory', 'Unsatisfactory', 'Poor', 'Pending'].map((name) => <option key={name}>{name}</option>)}</select>
        </div>
        <div className="overflow-x-auto rounded-lg border border-blue-50 dark:border-slate-700">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-blue-100 text-xs text-blue-950 dark:bg-slate-800 dark:text-blue-100"><tr>{['Employee', 'Division', 'KPI Score', 'Rating Status', 'Action'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
            <tbody>{filtered.slice(start, start + 5).map((employee) => {
              const percent = employee.rating === null ? null : employee.rating / 5 * 100;
              return <tr key={employee.employee_id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-3"><div className="flex items-center gap-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-bold text-blue-600">{employee.employee_name.split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('')}</span><div><div className="font-semibold">{employee.employee_name}</div><div className="text-xs text-slate-500">{employee.employee_code}</div></div></div></td>
                <td className="px-3 py-3">{employee.department}</td>
                <td className="min-w-[120px] px-3 py-3"><span className="text-xs font-semibold">{percent === null ? '—' : `${percent.toFixed(0)}%`}</span><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }} /></div></td>
                <td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${employee.status === 'Pending' ? 'bg-amber-50 text-amber-700' : employee.rating < 2.5 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{employee.status}</span></td>
                <td className="px-3 py-3"><button type="button" className={buttonClass} aria-label={`View ${employee.employee_name} records`} onClick={() => setSelected(employee)}>View</button></td>
              </tr>;
            })}</tbody>
          </table>
          {!filtered.length && <p className="p-8 text-center text-sm text-slate-500">No employee KPI records found for these filters.</p>}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500"><span>Showing {filtered.length ? start + 1 : 0}–{Math.min(start + 5, filtered.length)} of {filtered.length} employees</span><div className="flex items-center gap-2"><button type="button" aria-label="Previous page" className={buttonClass} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span className="rounded-lg bg-blue-600 px-3 py-1.5 text-white">{currentPage} / {pages}</span><button type="button" aria-label="Next page" className={buttonClass} disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></div>
        <p className="mt-3 text-xs text-slate-500">KPI score = average available OPCR/IPCR rating ÷ 5 × 100. Unrated records are excluded from the average.</p>
        {selected && <section className="mt-5 rounded-xl border border-blue-100 p-4 dark:border-slate-700" aria-label="Employee performance records"><div className="mb-3 flex justify-between gap-2"><h3 className="font-semibold">{selected.employee_name} — source records</h3><button type="button" aria-label="Close source records" onClick={() => setSelected(null)}><X size={16} /></button></div><div className="space-y-2">{selected.records.map((record) => <div key={`${record.type}-${record.record_id}`} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm dark:border-slate-800"><span>{record.type} #{record.record_id} · {record.department}</span><span>{record.record_date?.slice(0, 10)} · {record.rating === null ? 'Pending' : `${Number(record.rating).toFixed(2)} / 5 · ${ratingStatus(Number(record.rating))}`}</span></div>)}</div></section>}
      </div>
    </dialog>
  );
}
