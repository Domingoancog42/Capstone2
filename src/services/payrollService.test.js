import api from "./api";
import { publishAutoRefresh } from "../components/auto/autorefreshconfig";
import { notifyNotificationsChanged } from "./notificationService";
import { createPayroll, notifyPayrollBatchFinished } from "./payrollService";

jest.mock("./api", () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock("./notificationService", () => ({ notifyNotificationsChanged: jest.fn() }));
jest.mock("../components/auto/autorefreshconfig", () => ({ publishAutoRefresh: jest.fn() }));

/*
 * The bug this covers: generating payroll for a division posted one create per employee, and every
 * create broadcast a change that made the notification bell and the payroll workspace refetch. The
 * workspace's refetch alone is four requests, so a fifty-employee batch cost about six requests per
 * employee -- three hundred, exactly the default API rate limit -- and the run died partway through
 * with "Too many requests from this account."
 */
describe("createPayroll", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.post.mockResolvedValue({ data: { success: true, record: { id: 1 } } });
  });

  it("broadcasts once for a single create", async () => {
    await createPayroll({ employeeRecordId: 1 });

    expect(notifyNotificationsChanged).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][2]).toMatchObject({ skipAutoRefresh: false });
  });

  it("broadcasts nothing per employee during a batch", async () => {
    for (let index = 0; index < 50; index += 1) {
      await createPayroll({ employeeRecordId: index }, { batched: true });
    }

    expect(api.post).toHaveBeenCalledTimes(50);
    expect(notifyNotificationsChanged).not.toHaveBeenCalled();
    expect(api.post.mock.calls.every(([, , config]) => config.skipAutoRefresh === true)).toBe(true);
  });

  it("catches every listener up with one refresh when the batch ends", () => {
    notifyPayrollBatchFinished();

    expect(publishAutoRefresh).toHaveBeenCalledTimes(1);
    expect(publishAutoRefresh).toHaveBeenCalledWith({ source: "payroll-batch", topic: "payroll" });
    expect(notifyNotificationsChanged).toHaveBeenCalledTimes(1);
  });

  it("still sends the payload and the long timeout a create needs", async () => {
    await createPayroll({ employeeRecordId: 7, payPeriod: "1st Half" }, { batched: true });

    const [url, payload, config] = api.post.mock.calls[0];
    expect(url).toBe("/payroll.php");
    expect(payload).toEqual({ employeeRecordId: 7, payPeriod: "1st Half" });
    expect(config.timeout).toBe(120000);
  });
});
