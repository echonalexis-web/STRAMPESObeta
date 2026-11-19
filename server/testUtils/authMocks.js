// Shared jest mocks for the authController white-box tests.
// Each test file wires them with, e.g.:
//   jest.mock("../models/User", () => require("../testUtils/authMocks").User);
// and calls `resetAuthMocks()` in beforeEach (jest.resetAllMocks() clears every
// implementation, so defaults are re-applied here).

const { query } = require("./httpMocks");

const googleVerify = jest.fn();

const User = Object.assign(jest.fn(), {
  findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), updateOne: jest.fn(), find: jest.fn(),
  findByIdAndUpdate: jest.fn(), exists: jest.fn(), deleteOne: jest.fn(), normalizeCompanySize: jest.fn(),
});

const m = {
  User,
  JobseekerProfile: { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  EmployerProfile: { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  SystemSettings: { getSingleton: jest.fn() },
  ReservedUsername: { create: jest.fn() },
  bcrypt: { hash: jest.fn(), compare: jest.fn() },
  systemOptionService: { getActiveValues: jest.fn() },
  bannerTemplateService: { resolveCover: jest.fn() },
  avatarPresetService: { resolveAvatarPreset: jest.fn() },
  storageService: { remove: jest.fn() },
  auditService: { logAuditEvent: jest.fn() },
  notificationService: { notifyManyUsers: jest.fn() },
  sessionService: { forceLogout: jest.fn() },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  mailService: {
    sendPasswordResetEmail: jest.fn(), sendPasswordChangedEmail: jest.fn(), sendPasswordAddedEmail: jest.fn(),
    sendEmailVerification: jest.fn(), sendEmailChangeVerification: jest.fn(), sendEmailChangeAlert: jest.fn(),
    sendRecoveryEmailVerification: jest.fn(), sendRecoveryEmailAlert: jest.fn(),
    sendBackupCodesGeneratedEmail: jest.fn(), sendBackupCodeRedeemedEmail: jest.fn(),
  },
  google: { OAuth2Client: jest.fn() },
  age: { validateDobInput: jest.fn(), parseDateOnly: jest.fn(), getAgeTier: jest.fn() },
  usernameSignup: { isUsernameSignupEnabled: jest.fn(), hasVerifiedEmail: jest.fn() },
  sessionUser: { sessionUserPayload: jest.fn() },
  loginLock: { isLocked: jest.fn(), recordFailure: jest.fn(), recordFailureDummy: jest.fn(), clearLock: jest.fn(), checkPasswordWithLock: jest.fn() },
  accountAlerts: { notifyFailedAttempts: jest.fn(), checkNewDevice: jest.fn(), notifyPasswordChanged: jest.fn() },
  passwordPolicy: { enforce: jest.fn() },
  // Real parser/helpers; only phoneProblem is a mock so tests can force its answer.
  phone: { ...jest.requireActual("../utils/phone"), phoneProblem: jest.fn() },
  usernameUtil: { validateFormat: jest.fn(), isAvailable: jest.fn(), suggestFromEmailLocalPart: jest.fn(), getChangeCooldown: jest.fn() },
  idOcr: { scheduleIdOcr: jest.fn() },
  clientUrl: { clientBaseUrl: jest.fn() },
  googleVerify,
};

const resolved = (...fns) => fns.forEach((f) => f.mockResolvedValue());

m.resetAuthMocks = () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  delete process.env.EXPOSE_DEV_LINKS;

  User.findOne.mockImplementation(() => query(null));
  User.findById.mockImplementation(() => query(null));
  User.find.mockImplementation(() => query([]));
  User.exists.mockResolvedValue(true);
  User.updateOne.mockResolvedValue();
  User.deleteOne.mockResolvedValue({ deletedCount: 1 });
  User.findByIdAndUpdate.mockImplementation(() => query({}));
  User.normalizeCompanySize.mockImplementation((v) => v);

  m.JobseekerProfile.create.mockResolvedValue({});
  m.EmployerProfile.create.mockResolvedValue({});
  m.JobseekerProfile.findOne.mockResolvedValue(null);
  m.EmployerProfile.findOne.mockResolvedValue(null);
  m.JobseekerProfile.findOneAndUpdate.mockResolvedValue({ updated: "jobseeker" });
  m.EmployerProfile.findOneAndUpdate.mockResolvedValue({ updated: "employer" });
  m.JobseekerProfile.deleteOne.mockResolvedValue();
  m.EmployerProfile.deleteOne.mockResolvedValue();

  m.SystemSettings.getSingleton.mockResolvedValue({ appealWindowDays: 14 });
  m.ReservedUsername.create.mockResolvedValue();

  // "h:<plain>" is the fake hash of <plain>.
  m.bcrypt.hash.mockImplementation(async (p) => `h:${p}`);
  m.bcrypt.compare.mockImplementation(async (plain, hash) => hash === `h:${plain}`);

  m.systemOptionService.getActiveValues.mockResolvedValue(new Set());
  m.bannerTemplateService.resolveCover.mockResolvedValue("cover");
  m.avatarPresetService.resolveAvatarPreset.mockResolvedValue("preset");
  m.storageService.remove.mockResolvedValue();
  m.auditService.logAuditEvent.mockResolvedValue();
  m.notificationService.notifyManyUsers.mockResolvedValue();

  Object.values(m.mailService).forEach((f) => f.mockResolvedValue());
  resolved(m.loginLock.recordFailure, m.loginLock.recordFailureDummy, m.loginLock.clearLock);
  m.loginLock.isLocked.mockReturnValue(false);
  m.loginLock.checkPasswordWithLock.mockResolvedValue(true);
  Object.values(m.accountAlerts).forEach((f) => f.mockResolvedValue());

  m.passwordPolicy.enforce.mockReturnValue({ ok: true });
  m.phone.phoneProblem.mockReturnValue(null);
  m.usernameSignup.isUsernameSignupEnabled.mockReturnValue(false);
  m.usernameSignup.hasVerifiedEmail.mockReturnValue(true);
  m.sessionUser.sessionUserPayload.mockImplementation((u) => ({ id: u._id, role: u.role }));
  m.age.validateDobInput.mockReturnValue({ ok: true, date: new Date("2000-01-01") });
  m.age.parseDateOnly.mockImplementation((v) => (v ? new Date(v) : null));
  m.age.getAgeTier.mockReturnValue("adult");

  m.usernameUtil.validateFormat.mockImplementation((u) =>
    u ? { ok: true, normalized: String(u).toLowerCase() } : { ok: false, error: "Enter a username." }
  );
  m.usernameUtil.isAvailable.mockResolvedValue(true);
  m.usernameUtil.suggestFromEmailLocalPart.mockResolvedValue("suggested");
  m.usernameUtil.getChangeCooldown.mockReturnValue({ ok: true });
  m.idOcr.scheduleIdOcr.mockReturnValue();
  m.clientUrl.clientBaseUrl.mockReturnValue("http://client");

  m.google.OAuth2Client.mockImplementation(() => ({ verifyIdToken: googleVerify }));
  googleVerify.mockReset();
};

module.exports = m;
