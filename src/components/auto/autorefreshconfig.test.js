import { shouldPublishAutoRefreshForRequest } from "./autorefreshconfig";

/*
 * Generating payroll posts one create per employee. Each publication makes every listening screen
 * refetch -- the payroll workspace alone costs four requests -- so without `skipAutoRefresh` a batch
 * multiplied itself several times over and ran the account into the API rate limit.
 */
describe("shouldPublishAutoRefreshForRequest", () => {
  const create = (overrides = {}) => ({
    method: "post",
    url: "/payroll.php",
    baseURL: "http://localhost/Capstone2/frontend/backend/api",
    ...overrides,
  });

  it("publishes for an ordinary mutation", () => {
    expect(shouldPublishAutoRefreshForRequest(create())).toBe(true);
  });

  it("stays silent for a batched create", () => {
    expect(shouldPublishAutoRefreshForRequest(create({ skipAutoRefresh: true }))).toBe(false);
  });

  it("still publishes when the flag is explicitly off", () => {
    expect(shouldPublishAutoRefreshForRequest(create({ skipAutoRefresh: false }))).toBe(true);
  });

  it("never publishes for reads, batched or not", () => {
    expect(shouldPublishAutoRefreshForRequest(create({ method: "get" }))).toBe(false);
    expect(shouldPublishAutoRefreshForRequest(create({ method: "get", skipAutoRefresh: true }))).toBe(false);
  });
});
