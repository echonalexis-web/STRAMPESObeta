// Shared helpers for the white-box controller tests (server/tests/*.whitebox.test.js).
// Lives outside server/tests/ on purpose: jest's testMatch is "**/tests/**/*.js",
// so a helper inside tests/ would be run as an (empty) suite and fail.

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  res.sendFile = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides = {}) => ({
  user: { id: "507f1f77bcf86cd799439011", _id: "507f1f77bcf86cd799439011", role: "admin" },
  body: {},
  query: {},
  params: {},
  headers: {},
  files: undefined,
  file: undefined,
  ip: "127.0.0.1",
  method: "GET",
  originalUrl: "/x",
  get: jest.fn(),
  app: { get: jest.fn().mockReturnValue("io") },
  ...overrides,
});

const CHAIN_METHODS = [
  "select", "sort", "skip", "limit", "populate", "lean", "where", "equals", "in", "distinct",
  "collation", "hint", "session", "exec", "allowDiskUse", "maxTimeMS", "projection", "slice",
];

// A chainable, awaitable stand-in for a Mongoose query: every chain method returns
// the same object and awaiting it (or calling .exec()) yields `value`.
const query = (value) => {
  const q = {};
  CHAIN_METHODS.forEach((m) => {
    q[m] = jest.fn(() => q);
  });
  q.exec = jest.fn(() => Promise.resolve(value));
  q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  q.catch = (reject) => Promise.resolve(value).catch(reject);
  return q;
};

const failingQuery = (error = new Error("db down")) => {
  const q = {};
  CHAIN_METHODS.forEach((m) => {
    q[m] = jest.fn(() => q);
  });
  q.exec = jest.fn(() => Promise.reject(error));
  q.then = (resolve, reject) => Promise.reject(error).then(resolve, reject);
  q.catch = (reject) => Promise.reject(error).catch(reject);
  return q;
};

// Runs a controller and returns { res, status, body } where status defaults to 200.
const call = async (handler, req = makeReq(), res = makeRes()) => {
  await handler(req, res);
  const statusCall = res.status.mock.calls[0];
  const jsonCall = res.json.mock.calls[0];
  return { res, status: statusCall ? statusCall[0] : 200, body: jsonCall ? jsonCall[0] : undefined };
};

module.exports = { makeRes, makeReq, query, failingQuery, call };
