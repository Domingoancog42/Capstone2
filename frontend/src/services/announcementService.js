import api from "./api";

/**
 * Calendar announcements live on the server, not in the publisher's browser: every role's calendar
 * reads the same list, so an announcement HR publishes shows up for employees too.
 *
 * The api client publishes the `announcement` auto-refresh topic for every mutation below, which is
 * what re-renders the other open calendars in this browser; changes.php carries it to other machines.
 */
export async function fetchAnnouncements() {
  const response = await api.get("/announcement.php");
  return response.data;
}

export async function createAnnouncement(payload) {
  const response = await api.post("/announcement.php", payload);
  return response.data;
}

export async function updateAnnouncement(payload) {
  const response = await api.put("/announcement.php", payload);
  return response.data;
}

export async function deleteAnnouncement(announcementId) {
  const response = await api.delete("/announcement.php", {
    data: { id: announcementId },
  });
  return response.data;
}
