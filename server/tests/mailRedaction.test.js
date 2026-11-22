// mailService console fallback: a one-time link passed as `redact` never reaches
// the console, whether no transport is configured or the transport fails.

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

const LINK = "https://app.example/activate-account#token=" + "cd".repeat(32);

describe("mailService.sendMail redaction", () => {
  let logSpy;
  beforeEach(() => {
    jest.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_SERVICE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  test("with no mail transport configured the link is hidden in the console fallback", async () => {
    const mail = require("../services/mailService");
    const result = await mail.sendMail({
      to: "staff@example.com",
      subject: "Activate",
      text: `Open this: ${LINK}`,
      html: `<a href="${LINK}">go</a>`,
      redact: [LINK],
    });
    expect(result.channel).toBe("console");
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).not.toContain(LINK);
    expect(printed).not.toContain("cd".repeat(32));
    expect(printed).toContain("[link hidden]");
    expect(printed).toContain("staff@example.com");
  });

  test("when the transport fails the link is hidden in the error line and the text", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASS = "p";
    const nodemailer = require("nodemailer");
    nodemailer.createTransport.mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error(`rejected body ${LINK}`)),
    });
    const mail = require("../services/mailService");
    const result = await mail.sendMail({ to: "staff@example.com", subject: "Activate", text: `Open ${LINK}`, html: "x", redact: [LINK] });
    expect(result.channel).toBe("error");
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).not.toContain("cd".repeat(32));
  });

  test("without `redact` the existing behaviour is unchanged", async () => {
    const mail = require("../services/mailService");
    await mail.sendMail({ to: "a@example.com", subject: "Hi", text: `see ${LINK}`, html: "x" });
    expect(logSpy.mock.calls.flat().join("\n")).toContain(LINK);
  });
});
