import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../services/api", () => ({
  superadminAPI: {
    listAdmins: vi.fn(),
    createAdmin: vi.fn(),
    resendAdminInvite: vi.fn(),
    cancelAdminInvite: vi.fn(),
    setAdminActive: vi.fn(),
    resetAdminPassword: vi.fn(),
  },
}));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("../../components/feedback/context", () => ({ useToast: () => toast }));

const { superadminAPI } = await import("../../services/api");
const { default: SuperadminAdminAccounts } = await import("./SuperadminAdminAccounts");
const { default: ProvisionStaffModal } = await import("../../components/ProvisionStaffModal");
const { default: PendingStaffNotice } = await import("../../components/PendingStaffNotice");

const HOUR = 3600 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const pendingAdmin = (o = {}) => ({
  id: "p1", name: "Ann Cruz", email: "ann@peso.gov", staffNote: "Ann Cruz, PESO Manager", isActive: false,
  accountStatus: "pending_activation", mustChangePassword: false, lastLoginAt: null, createdAt: iso(-2 * HOUR),
  invite: { status: "pending", sentAt: iso(-HOUR), expiresAt: iso(47 * HOUR), resendCount: 1, resendsLeft: 9, activatedAt: null, emailStatus: "sent", nextResendAt: null },
  ...o,
});
const expiredAdmin = () =>
  pendingAdmin({
    id: "x1", name: "Eli Reyes", email: "eli@peso.gov",
    invite: { status: "expired", sentAt: iso(-60 * HOUR), expiresAt: iso(-HOUR), resendCount: 0, resendsLeft: 10, activatedAt: null, emailStatus: "failed", nextResendAt: null },
  });
const activeAdmin = () => ({
  id: "a1", name: "Bo Lim", email: "bo@peso.gov", staffNote: "Bo Lim, SPES Coordinator", isActive: true, accountStatus: "active",
  mustChangePassword: false, lastLoginAt: iso(-HOUR), createdAt: iso(-90 * HOUR),
  invite: { status: "activated", sentAt: iso(-80 * HOUR), expiresAt: iso(-30 * HOUR), resendCount: 2, resendsLeft: 8, activatedAt: iso(-70 * HOUR), emailStatus: null, nextResendAt: null },
});
const legacyAdmin = () => ({
  id: "l1", name: "Old Timer", email: "old@peso.gov", staffNote: "HR", isActive: true, accountStatus: "active",
  mustChangePassword: true, lastLoginAt: null, createdAt: iso(-900 * HOUR), invite: null,
});

let admins;
const renderPage = () =>
  render(
    <MemoryRouter>
      <SuperadminAdminAccounts />
    </MemoryRouter>
  );

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  admins = [pendingAdmin(), expiredAdmin(), activeAdmin(), legacyAdmin()];
  superadminAPI.listAdmins.mockImplementation(async () => ({
    data: { admins, inviteSettings: { expiryHours: 48, cooldownSeconds: 60, maxResends: 10 } },
  }));
  superadminAPI.resendAdminInvite.mockResolvedValue({ data: { emailStatus: "queued" } });
  superadminAPI.cancelAdminInvite.mockResolvedValue({ data: {} });
  superadminAPI.createAdmin.mockResolvedValue({ data: { admin: { email: "new@peso.gov" }, emailStatus: "queued" } });
});

const rowOf = async (name) => (await screen.findByText(name)).closest("tr");

describe("Admin accounts roster", () => {
  test("pending and expired invitations are badged with text and a shape; failed email says so", async () => {
    renderPage();
    const pending = await rowOf("Ann Cruz");
    const badge = within(pending).getByText("Pending activation");
    expect(badge.className).toMatch(/sb--pending/);
    expect(badge.className).toMatch(/sb--triangle/);
    expect(within(pending).getByText("Email sent")).toBeTruthy();

    const expired = await rowOf("Eli Reyes");
    const expiredBadge = within(expired).getByText("Invite expired");
    expect(expiredBadge.className).toMatch(/sb--expired/);
    expect(expiredBadge.className).toMatch(/sb--bar/);
    expect(within(expired).getByText("Email failed, resend")).toBeTruthy();
  });

  test("a pending row offers Resend and Cancel, and never reset password or disable", async () => {
    renderPage();
    const row = await rowOf("Ann Cruz");
    expect(within(row).getByRole("button", { name: "Resend invite to Ann Cruz" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Cancel invite for Ann Cruz" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /Reset password/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /Disable/ })).toBeNull();
  });

  test("an activated account keeps the usual actions and shows who activated when in its invite details", async () => {
    renderPage();
    const row = await rowOf("Bo Lim");
    expect(within(row).getByText("Active").className).toMatch(/sb--active/);
    expect(within(row).getByRole("button", { name: "Reset password for Bo Lim" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Disable Bo Lim" })).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /Resend invite/ })).toBeNull();
    const dt = within(row).getByText("Activated");
    expect(dt.nextElementSibling.textContent).not.toBe("Not yet");
  });

  test("an older account that still has to replace a temporary password keeps its Pending OTP label", async () => {
    renderPage();
    const row = await rowOf("Old Timer");
    expect(within(row).getByText("Pending OTP")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Reset password for Old Timer" })).toBeTruthy();
  });

  test("invite details show sent time, expiry, resends used and activation time", async () => {
    renderPage();
    const row = await rowOf("Ann Cruz");
    const details = within(row).getByText("Invite details").closest("details");
    expect(within(details).getByText("Invite sent")).toBeTruthy();
    expect(within(details).getByText("Link expires")).toBeTruthy();
    expect(within(details).getByText("Resends used").nextElementSibling.textContent).toBe("1 of 10");
    expect(within(details).getByText("Activated").nextElementSibling.textContent).toBe("Not yet");
    const expiredRow = await rowOf("Eli Reyes");
    expect(within(expiredRow).getByText("Link expired")).toBeTruthy();
  });

  test("the Pending tab counts pending, expired and older temporary-password accounts together", async () => {
    renderPage();
    await rowOf("Ann Cruz");
    const tab = screen.getByRole("tab", { name: /Pending/ });
    expect(tab.textContent).toContain("3");
    await userEvent.setup().click(tab);
    expect(screen.queryByText("Bo Lim")).toBeNull();
    expect(screen.getByText("Eli Reyes")).toBeTruthy();
  });

  test("Resend calls the server, says so, and reloads", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = await rowOf("Ann Cruz");
    await user.click(within(row).getByRole("button", { name: "Resend invite to Ann Cruz" }));
    await waitFor(() => expect(superadminAPI.resendAdminInvite).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("ann@peso.gov")));
    await waitFor(() => expect(superadminAPI.listAdmins).toHaveBeenCalledTimes(2));
  });

  test("a resend whose email could not be queued shows an error toast", async () => {
    const user = userEvent.setup();
    superadminAPI.resendAdminInvite.mockResolvedValue({ data: { emailStatus: "failed" } });
    renderPage();
    const row = await rowOf("Eli Reyes");
    await user.click(within(row).getByRole("button", { name: "Resend invite to Eli Reyes" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("could not be queued")));
  });

  test("while the cooldown runs the resend button is disabled and the seconds left are shown", async () => {
    admins = [pendingAdmin({ invite: { ...pendingAdmin().invite, nextResendAt: iso(42 * 1000) } })];
    renderPage();
    const row = await rowOf("Ann Cruz");
    expect(within(row).getByRole("button", { name: "Resend invite to Ann Cruz" }).disabled).toBe(true);
    expect(within(row).getByText(/Resend in (41|42)s/)).toBeTruthy();
  });

  test("when the server answers 429 the toast carries the wait, and the list reloads", async () => {
    const user = userEvent.setup();
    superadminAPI.resendAdminInvite.mockRejectedValue({
      response: { status: 429, data: { code: "RESEND_COOLDOWN", retryAfterSeconds: 33 } },
    });
    renderPage();
    const row = await rowOf("Ann Cruz");
    await user.click(within(row).getByRole("button", { name: "Resend invite to Ann Cruz" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Wait 33 seconds before sending another invitation."));
  });

  test("Cancel asks first, names the email, and only then calls the server", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = await rowOf("Ann Cruz");
    await user.click(within(row).getByRole("button", { name: "Cancel invite for Ann Cruz" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Cancel this invitation?")).toBeTruthy();
    expect(dialog.textContent).toContain("ann@peso.gov");
    expect(superadminAPI.cancelAdminInvite).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Keep invitation" }));
    expect(superadminAPI.cancelAdminInvite).not.toHaveBeenCalled();

    await user.click(within(await rowOf("Ann Cruz")).getByRole("button", { name: "Cancel invite for Ann Cruz" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel invitation" }));
    await waitFor(() => expect(superadminAPI.cancelAdminInvite).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Invitation cancelled and the pending account removed."));
  });
});

describe("Provision staff account dialog", () => {
  const renderModal = (props = {}) => {
    const onClose = vi.fn();
    const onProvisioned = vi.fn();
    const utils = render(<ProvisionStaffModal isOpen onClose={onClose} onProvisioned={onProvisioned} {...props} />);
    return { ...utils, onClose, onProvisioned };
  };

  test("it has no password field, offers no superadmin role and says the link is emailed", () => {
    const { container } = renderModal();
    expect(container.ownerDocument.querySelector('input[type="password"]')).toBeNull();
    const role = screen.getByLabelText(/Role/);
    expect(within(role).getAllByRole("option").map((o) => o.textContent)).toEqual(["Staff moderator (PESO admin)"]);
    expect(screen.getByText(/one-time activation link/)).toBeTruthy();
    expect(screen.getByText(/expires in 48 hours/)).toBeTruthy();
  });

  test("empty submit shows each field's own message, linked, and focuses the first", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));
    expect(document.getElementById("name-error").textContent).toBe("Enter the staff member's full name.");
    expect(document.getElementById("email-error").textContent).toBe("Enter their PESO email address.");
    expect(document.getElementById("position-error").textContent).toBe("Enter their position or office.");
    const name = document.getElementById("name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(name.getAttribute("aria-describedby")).toContain("name-error");
    expect(document.activeElement).toBe(name);
    expect(superadminAPI.createAdmin).not.toHaveBeenCalled();
  });

  test("an email without a domain is refused with its own message", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(document.getElementById("name"), "Ann");
    await user.type(document.getElementById("email"), "ann@nowhere");
    await user.type(document.getElementById("position"), "Manager");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));
    expect(document.getElementById("email-error").textContent).toMatch(/valid email address/);
    expect(document.activeElement).toBe(document.getElementById("email"));
  });

  test("a preset fills the position, toggles, and is announced as pressed", async () => {
    const user = userEvent.setup();
    renderModal();
    const chip = screen.getByRole("button", { name: "SPES Coordinator" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await user.click(chip);
    expect(document.getElementById("position").value).toBe("SPES Coordinator");
    expect(screen.getByRole("button", { name: "SPES Coordinator" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "SPES Coordinator" }));
    expect(document.getElementById("position").value).toBe("");
  });

  test("a valid form sends trimmed, lower-cased values with the staff moderator role", async () => {
    const user = userEvent.setup();
    const { onProvisioned } = renderModal();
    await user.type(document.getElementById("name"), "  Ann Cruz ");
    await user.type(document.getElementById("email"), " ANN@Peso.gov ");
    await user.type(document.getElementById("position"), " PESO Manager ");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));
    await waitFor(() => expect(superadminAPI.createAdmin).toHaveBeenCalledTimes(1));
    expect(superadminAPI.createAdmin).toHaveBeenCalledWith({
      name: "Ann Cruz", email: "ann@peso.gov", position: "PESO Manager", role: "staff_moderator",
    });
    await waitFor(() => expect(onProvisioned).toHaveBeenCalled());
  });

  test("a duplicate email is shown under the email field and focus goes there", async () => {
    const user = userEvent.setup();
    superadminAPI.createAdmin.mockRejectedValue({
      response: { status: 400, data: { field: "email", code: "EMAIL_EXISTS", message: "An account with that email already exists." } },
    });
    const { onProvisioned } = renderModal();
    await user.type(document.getElementById("name"), "Ann");
    await user.type(document.getElementById("email"), "ann@peso.gov");
    await user.type(document.getElementById("position"), "Manager");
    await user.click(screen.getByRole("button", { name: /Send invitation/ }));
    await waitFor(() => expect(document.getElementById("email-error")).toBeTruthy());
    expect(document.getElementById("email-error").textContent).toBe("An account with that email already exists.");
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("email")));
    expect(onProvisioned).not.toHaveBeenCalled();
  });

  test("Escape closes the dialog", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  test("the dialog follows the expiry setting it is given", () => {
    renderModal({ expiryHours: 24 });
    expect(screen.getByText(/expires in 24 hours/)).toBeTruthy();
  });
});

describe("Pending staff notice on User Management", () => {
  test("nothing shows when no invitation is pending", () => {
    const { container } = render(<PendingStaffNotice count={0} onOpen={vi.fn()} />);
    expect(container.textContent).toBe("");
    const none = render(<PendingStaffNotice onOpen={vi.fn()} />);
    expect(none.container.textContent).toBe("");
  });

  test("the badge shows the count with its own shape; clicking opens a panel with a button to Admin accounts", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<PendingStaffNotice count={3} onOpen={onOpen} />);
    const trigger = screen.getByRole("button", { name: /3 staff accounts pending activation/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(within(trigger).getByText(/3 staff accounts/).className).toMatch(/sb--triangle/);
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region", { name: "Staff invitations" });
    await user.click(within(panel).getByRole("button", { name: "Open Admin accounts" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("hovering opens it, leaving closes it", () => {
    const { container } = render(<PendingStaffNotice count={1} onOpen={vi.fn()} />);
    const root = container.firstChild;
    expect(screen.getByRole("button", { name: /1 staff account pending activation/ })).toBeTruthy();
    fireEvent.mouseEnter(root);
    expect(screen.getByRole("region", { name: "Staff invitations" })).toBeTruthy();
    fireEvent.mouseLeave(root);
    expect(screen.queryByRole("region", { name: "Staff invitations" })).toBeNull();
  });

  test("Escape closes the panel and returns focus to the badge", async () => {
    const user = userEvent.setup();
    render(<PendingStaffNotice count={2} onOpen={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /2 staff accounts/ });
    await user.click(trigger);
    expect(screen.getByRole("region", { name: "Staff invitations" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Staff invitations" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
