jest.mock("../models/User", () => ({ findById: jest.fn() }));
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const { changePassword } = require("../controllers/userController");

let originalHash, user, req, res;
beforeAll(async () => { originalHash = await bcrypt.hash("OriginalDummy1!", 4); });
beforeEach(() => {
  jest.clearAllMocks();
  user = { password: originalHash, tokenVersion: 2, save: jest.fn().mockResolvedValue(null) };
  User.findById.mockImplementation(async () => user);
  req = { user: { id: "dummy-user" }, body: { currentPassword: "OriginalDummy1!", newPassword: "ReplacementDummy2!" } };
  res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
});

test("legacy password change hashes the replacement and preserves its response/revocation contract", async () => {
  await changePassword(req, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ message: "Password changed successfully" });
  expect(user.password).not.toBe(req.body.newPassword);
  expect(await bcrypt.compare(req.body.newPassword, user.password)).toBe(true);
  expect(await bcrypt.compare(req.body.currentPassword, user.password)).toBe(false);
  expect(user.tokenVersion).toBe(3);
  expect(user.save).toHaveBeenCalledWith({ validateModifiedOnly: true });
});

test("wrong current password cannot update the hash or version", async () => {
  req.body.currentPassword = "WrongDummy1!";
  await changePassword(req, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(user.password).toBe(originalHash);
  expect(user.tokenVersion).toBe(2);
  expect(user.save).not.toHaveBeenCalled();
});

test.each([null, undefined, ""])("Google-only password state (%s) fails safely without saving", async password => {
  user.password = password;
  await changePassword(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(user.save).not.toHaveBeenCalled();
});

test("missing user returns 404", async () => {
  user = null;
  await changePassword(req, res);
  expect(res.status).toHaveBeenCalledWith(404);
});

test("save failure returns a controlled error", async () => {
  user.save.mockRejectedValue(new Error("dummy write failure"));
  await changePassword(req, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).not.toHaveBeenCalledWith({ message: "Password changed successfully" });
});
