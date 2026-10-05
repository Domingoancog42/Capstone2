import api from "./api";

/**
 * Philippine holidays for the calendar.
 *
 * holiday.php generates the national list for whatever year is asked for and lays the stored rows
 * over the top, so a caller gets a complete year back without anything having been seeded first.
 *
 * The api client publishes the `holiday` auto-refresh topic for every mutation below, which is what
 * re-renders the other open calendars in this browser; changes.php carries it to other machines.
 */
export async function fetchHolidays(params = {}) {
  const response = await api.get("/holiday.php", { params });
  return response.data;
}

export async function createHoliday(payload) {
  const response = await api.post("/holiday.php", payload);
  return response.data;
}

export async function updateHoliday(payload) {
  const response = await api.put("/holiday.php", payload);
  return response.data;
}

export async function deleteHoliday(holidayId) {
  const response = await api.delete("/holiday.php", {
    data: { id: holidayId },
  });
  return response.data;
}
