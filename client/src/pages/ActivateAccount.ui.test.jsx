import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/api", () => ({
  authAPI: { checkActivation: vi.fn(), activateAccount: vi.fn() },
}));

const { authAPI } = await import("../services/api");
const { default: ActivateAccount } = await import("./ActivateAccount");

const TOKEN = "cd".repeat(32);
const STRONG = "Tr0ub4dor&Horse9";

function LoginProbe() {
  const location = useLocation();
  return <div data-testid="login-page">{JSON.stringify(location.state)}</div>;
}

const open = (hash = `#token=${TOKEN}`) => {
  window.history.pushState({}, "", `/activate-account${hash}`);
  return render(
    <MemoryRouter initialEntries={["/activate-account"]}>
      <Routes>
        <Route path="/activate-account" element={<ActivateAccount />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>
  );
};

const field = (container, id) => container.querySelector(`#${id}`);
const badLink = () => Object.assign(new Error("bad"), { response: { status: 400, data: { code: "INVITE_INVALID" } } });
const failure = (status, data) => Object.assign(new Error("fail"), { response: { status, data } });

beforeEach(() => {
  // jsdom has no scrollIntoView; the shared field-error hook calls it before focusing.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  authAPI.checkActivation.mockResolvedValue({ data: { valid: true } });
  authAPI.activateAccount.mockResolvedValue({ data: { message: "ok" } });
});

describe("the link", () => {
  test("the token is removed from the address bar and the page asks for no referrer", async () => {
    const { unmount } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
    unmount();
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });

  test("the token is checked once, sent in the request body only", async () => {
    open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    expect(authAPI.checkActivation).toHaveBeenCalledTimes(1);
    expect(authAPI.checkActivation).toHaveBeenCalledWith(TOKEN);
  });

  test("a bad, expired, used or revoked link shows one neutral message and no form", async () => {
    authAPI.checkActivation.mockRejectedValue(badLink());
    const { container } = open();
    expect(await screen.findByRole("heading", { name: "This link can't be used" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("This activation link is not valid. Ask your superadmin to send you a new one.");
    expect(field(container, "password")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to login" }).getAttribute("href")).toBe("/login");
  });

  test("no token at all gets the same neutral message without calling the server", async () => {
    open("");
    expect(await screen.findByRole("heading", { name: "This link can't be used" })).toBeTruthy();
    expect(authAPI.checkActivation).not.toHaveBeenCalled();
  });

  test("a malformed token is treated like no token", async () => {
    open("#token=not-a-real-token");
    expect(await screen.findByRole("heading", { name: "This link can't be used" })).toBeTruthy();
    expect(authAPI.checkActivation).not.toHaveBeenCalled();
  });

  test("a server hiccup on the check still shows the form (the server checks again on submit)", async () => {
    authAPI.checkActivation.mockRejectedValue(failure(503, {}));
    const { container } = open();
    await waitFor(() => expect(field(container, "password")).toBeTruthy());
  });
});

describe("choosing a password", () => {
  test("the requirement list is visible and each rule turns to Done with a mark and text, not colour alone", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    for (const item of items) expect(item.textContent).toContain("Not yet");

    await user.type(field(container, "password"), STRONG);
    for (const item of within(screen.getByRole("list")).getAllByRole("listitem")) {
      expect(item.textContent).toContain("Done");
      expect(item.textContent).toContain("✓");
    }
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("5");
  });

  test("the show-password toggle has an accessible name and switches both fields", async () => {
    const user = userEvent.setup();
    const { container } = open();
    const toggle = await screen.findByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(field(container, "password").getAttribute("type")).toBe("password");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
    expect(field(container, "password").getAttribute("type")).toBe("text");
    expect(field(container, "confirmPassword").getAttribute("type")).toBe("text");
  });

  test("a weak password shows a linked message and focus moves to the field", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await user.type(field(container, "password"), "short");
    await user.type(field(container, "confirmPassword"), "short");
    await user.click(screen.getByRole("button", { name: "Activate account" }));

    const password = field(container, "password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    const describedBy = password.getAttribute("aria-describedby").split(" ");
    expect(describedBy).toContain("password-error");
    expect(document.getElementById("password-error").textContent).toContain("at least 8 characters");
    expect(document.activeElement).toBe(password);
    expect(authAPI.activateAccount).not.toHaveBeenCalled();
  });

  test("a mismatch puts the error on the confirmation field and focuses it", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await user.type(field(container, "password"), STRONG);
    await user.type(field(container, "confirmPassword"), STRONG + "x");
    await user.click(screen.getByRole("button", { name: "Activate account" }));
    expect(document.getElementById("confirmPassword-error").textContent).toBe("The two passwords do not match.");
    expect(document.activeElement).toBe(field(container, "confirmPassword"));
    expect(field(container, "password").getAttribute("aria-invalid")).toBeNull();
    expect(authAPI.activateAccount).not.toHaveBeenCalled();
  });

  test("empty fields name what is missing, in visual order", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await user.click(screen.getByRole("button", { name: "Activate account" }));
    expect(document.getElementById("password-error").textContent).toBe("Enter a new password.");
    expect(document.getElementById("confirmPassword-error").textContent).toBe("Enter the password again to confirm it.");
    expect(document.activeElement).toBe(field(container, "password"));
  });

  test("editing a field clears its error", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await user.click(screen.getByRole("button", { name: "Activate account" }));
    expect(document.getElementById("password-error")).toBeTruthy();
    await user.type(field(container, "password"), "a");
    expect(document.getElementById("password-error")).toBeNull();
  });
});

describe("submitting", () => {
  const fillAndSubmit = async (container, user) => {
    await user.type(field(container, "password"), STRONG);
    await user.type(field(container, "confirmPassword"), STRONG);
    await user.click(screen.getByRole("button", { name: "Activate account" }));
  };

  test("success sends the token and password in the body and goes to login without signing in", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await fillAndSubmit(container, user);
    await waitFor(() => expect(screen.getByTestId("login-page")).toBeTruthy());
    expect(authAPI.activateAccount).toHaveBeenCalledWith({ token: TOKEN, password: STRONG, confirmPassword: STRONG });
    expect(JSON.parse(screen.getByTestId("login-page").textContent)).toEqual({ activated: true });
    expect(localStorage.getItem("token")).toBeNull();
  });

  test("the button is disabled while sending, so a double click sends once", async () => {
    const user = userEvent.setup();
    let release;
    authAPI.activateAccount.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await fillAndSubmit(container, user);
    const busy = await screen.findByRole("button", { name: "Activating…" });
    expect(busy.disabled).toBe(true);
    await user.click(busy);
    expect(authAPI.activateAccount).toHaveBeenCalledTimes(1);
    release({ data: {} });
  });

  test("a link that was used or replaced in the meantime shows the same neutral message", async () => {
    const user = userEvent.setup();
    authAPI.activateAccount.mockRejectedValue(badLink());
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await fillAndSubmit(container, user);
    expect(await screen.findByRole("heading", { name: "This link can't be used" })).toBeTruthy();
    expect(field(container, "password")).toBeNull();
  });

  test("a server password rule shows on the password field", async () => {
    const user = userEvent.setup();
    authAPI.activateAccount.mockRejectedValue(failure(400, { code: "PASSWORD_TOO_COMMON", message: "x" }));
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await fillAndSubmit(container, user);
    await waitFor(() => expect(document.getElementById("password-error")).toBeTruthy());
    expect(document.getElementById("password-error").textContent).toContain("too common");
    expect(document.activeElement).toBe(field(container, "password"));
  });

  test("too many attempts and unexpected errors each show their own plain message", async () => {
    const user = userEvent.setup();
    authAPI.activateAccount.mockRejectedValueOnce(failure(429, { message: "slow down" }));
    const { container } = open();
    await screen.findByRole("heading", { name: "Activate your staff account" });
    await fillAndSubmit(container, user);
    expect((await screen.findByRole("alert")).textContent).toBe("Too many attempts. Please try again later.");
    authAPI.activateAccount.mockRejectedValueOnce(failure(500, {}));
    await user.click(screen.getByRole("button", { name: "Activate account" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We could not activate the account. Please try again."));
  });
});
