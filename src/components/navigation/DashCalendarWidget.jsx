import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./DashCalendarWidget.module.css";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );
}

function buildCalendarCells(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    if (index < firstDay) {
      const dateNumber = daysInPreviousMonth - firstDay + index + 1;
      cells.push({
        key: `prev-${dateNumber}`,
        date: new Date(year, month - 1, dateNumber),
        dayNumber: dateNumber,
        isCurrentMonth: false,
      });
      continue;
    }

    const currentMonthDate = index - firstDay + 1;

    if (currentMonthDate <= daysInMonth) {
      cells.push({
        key: `current-${currentMonthDate}`,
        date: new Date(year, month, currentMonthDate),
        dayNumber: currentMonthDate,
        isCurrentMonth: true,
      });
      continue;
    }

    const nextMonthDate = currentMonthDate - daysInMonth;
    cells.push({
      key: `next-${nextMonthDate}`,
      date: new Date(year, month + 1, nextMonthDate),
      dayNumber: nextMonthDate,
      isCurrentMonth: false,
    });
  }

  return cells;
}

export function DashCalendarWidget() {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => today);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(viewDate),
    [viewDate]
  );
  const selectedDateLabel = useMemo(
    () => new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(selectedDate),
    [selectedDate]
  );
  const calendarCells = useMemo(() => buildCalendarCells(viewDate), [viewDate]);

  const changeMonth = (offset) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handleSelectDate = (cellDate) => {
    setSelectedDate(cellDate);
    setViewDate(startOfMonth(cellDate));
  };

  return (
    <div className={styles.calendarWidget}>
      <div className={styles.calHeader}>
        <span className={styles.calMonth}>{monthLabel}</span>
        <div className={styles.calNav}>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => changeMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => changeMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className={styles.calGrid}>
        {dayLabels.map((day) => (
          <span key={day} className={styles.dayHeader}>
            {day}
          </span>
        ))}

        {calendarCells.map((cell) => {
          const isToday = isSameDay(cell.date, today);
          const isSelected = isSameDay(cell.date, selectedDate);
          const classNames = [
            styles.dayCell,
            !cell.isCurrentMonth ? styles.dayMuted : "",
            isToday ? styles.dayToday : "",
            isSelected ? styles.daySelected : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={cell.key}
              type="button"
              className={classNames}
              onClick={() => handleSelectDate(cell.date)}
              aria-pressed={isSelected}
              aria-label={new Intl.DateTimeFormat("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              }).format(cell.date)}
            >
              {cell.dayNumber}
            </button>
          );
        })}
      </div>

      <div className={styles.calFooter}>
        <span className={styles.footerLabel}>Selected Date</span>
        <span className={styles.footerValue}>{selectedDateLabel}</span>
      </div>
    </div>
  );
}

export default DashCalendarWidget;
