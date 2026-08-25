import api from "./api";
import { notifyLeaveRequestsChanged } from "./leaveService";

export async function fetchPassSlips({ archived = false } = {}) {
  const response = await api.get("/pass_slip.php", {
    params: archived ? { archived: 1 } : {},
  });
  return response.data;
}

export async function filePassSlip(payload) {
  const response = await api.post("/pass_slip.php", payload);
  notifyLeaveRequestsChanged({ broadcast: true });
  return response.data;
}

/*
 * There is no updatePassSlipStatus() here any more. A pass slip has no status to move: it is filed,
 * printed, and signed on paper. The PUT endpoint it used to call now only handles archive/restore,
 * which goes through confirmArchiveRecord() in utils/archiveActions.
 */

export async function deletePassSlip(id) {
  const response = await api.delete("/pass_slip.php", { data: { id } });
  notifyLeaveRequestsChanged();
  return response.data;
}
