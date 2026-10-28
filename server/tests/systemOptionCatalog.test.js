jest.mock("../models/SystemOption", () => ({
  find: jest.fn(),
  exists: jest.fn(),
}));

const SystemOption = require("../models/SystemOption");
const { listByCategory } = require("../controllers/systemOptionController");

const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });

describe("system option catalog configuration", () => {
  beforeEach(() => jest.clearAllMocks());

  test("marks an unseeded industry catalog as unconfigured", async () => {
    SystemOption.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
    SystemOption.exists.mockResolvedValue(null);
    const res = response();

    await listByCategory({ params: { category: "industry" }, query: {}, user: { role: "jobseeker" } }, res);

    expect(SystemOption.find).toHaveBeenCalledWith({ category: "industry", isActive: true });
    expect(res.json).toHaveBeenCalledWith({ options: [], configured: false });
  });

  test("keeps a deliberately disabled catalog distinct from an unseeded one", async () => {
    SystemOption.find.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
    SystemOption.exists.mockResolvedValue({ _id: "inactive-industry" });
    const res = response();

    await listByCategory({ params: { category: "industry" }, query: {}, user: { role: "jobseeker" } }, res);

    expect(res.json).toHaveBeenCalledWith({ options: [], configured: true });
  });

  test("returns active choices without an extra existence query", async () => {
    const options = [{ value: "Agriculture", isActive: true }];
    SystemOption.find.mockReturnValue({ sort: () => ({ lean: async () => options }) });
    const res = response();

    await listByCategory({ params: { category: "industry" }, query: {}, user: { role: "jobseeker" } }, res);

    expect(res.json).toHaveBeenCalledWith({ options, configured: true });
    expect(SystemOption.exists).not.toHaveBeenCalled();
  });
});
