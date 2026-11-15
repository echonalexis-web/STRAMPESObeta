const { registerConversationHandlers } = require("../sockets/conversationRooms");

const CONV = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbb";

const makeSocket = (userId = "user-1") => {
  const handlers = {};
  const roomEmit = jest.fn();
  const socket = {
    id: "sock-1",
    userId,
    rooms: new Set(["sock-1", `user:${userId}`]),
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
    emit: jest.fn(),
    join: jest.fn((room) => socket.rooms.add(room)),
    leave: jest.fn((room) => socket.rooms.delete(room)),
    to: jest.fn(() => ({ emit: roomEmit })),
  };
  return { socket, handlers, roomEmit };
};

let Conversation, presenceService, logger;
beforeEach(() => {
  Conversation = { exists: jest.fn() };
  presenceService = { markConversationActive: jest.fn(), markConversationInactive: jest.fn() };
  logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
});

const setup = (userId) => {
  const s = makeSocket(userId);
  registerConversationHandlers(s.socket, { Conversation, presenceService, logger });
  return s;
};

describe("join_conversation", () => {
  test("a participant joins the room", async () => {
    Conversation.exists.mockResolvedValue({ _id: CONV });
    const { socket, handlers } = setup("user-1");
    await handlers.join_conversation(CONV);
    expect(Conversation.exists).toHaveBeenCalledWith({ _id: CONV, participants: "user-1" });
    expect(socket.join).toHaveBeenCalledWith(CONV);
    expect(presenceService.markConversationActive).toHaveBeenCalledWith("user-1", CONV);
  });

  test("a non-participant is refused and not joined", async () => {
    Conversation.exists.mockResolvedValue(null);
    const { socket, handlers } = setup("intruder");
    await handlers.join_conversation(CONV);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.rooms.has(CONV)).toBe(false);
    expect(presenceService.markConversationActive).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("error", { message: "Conversation not found" });
  });

  test("a database error refuses the join", async () => {
    Conversation.exists.mockRejectedValue(new Error("db down"));
    const { socket, handlers } = setup();
    await handlers.join_conversation(CONV);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("error", { message: "Conversation not found" });
  });

  test.each([undefined, "", "not-an-id", { $ne: null }, `${CONV}0`])("invalid id %p is rejected without a lookup", async (id) => {
    const { socket, handlers } = setup();
    await handlers.join_conversation(id);
    expect(Conversation.exists).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("error", { message: "Invalid conversation ID" });
  });
});

describe("typing relays", () => {
  test("a socket outside the room cannot send typing events into it", () => {
    const { socket, handlers, roomEmit } = setup();
    handlers.typing({ conversationId: OTHER });
    handlers.stop_typing({ conversationId: OTHER });
    expect(socket.to).not.toHaveBeenCalled();
    expect(roomEmit).not.toHaveBeenCalled();
  });

  test("a member's typing events reach the room", async () => {
    Conversation.exists.mockResolvedValue({ _id: CONV });
    const { socket, handlers, roomEmit } = setup("user-1");
    await handlers.join_conversation(CONV);
    handlers.typing({ conversationId: CONV });
    handlers.stop_typing({ conversationId: CONV });
    expect(socket.to).toHaveBeenCalledWith(CONV);
    expect(roomEmit).toHaveBeenCalledWith("user_typing", { conversationId: CONV, senderId: "user-1" });
    expect(roomEmit).toHaveBeenCalledWith("user_stop_typing", { conversationId: CONV });
  });
});

describe("leave_conversation", () => {
  test("leaves the room and clears presence", async () => {
    Conversation.exists.mockResolvedValue({ _id: CONV });
    const { socket, handlers } = setup("user-1");
    await handlers.join_conversation(CONV);
    handlers.leave_conversation(CONV);
    expect(socket.leave).toHaveBeenCalledWith(CONV);
    expect(socket.rooms.has(CONV)).toBe(false);
    expect(presenceService.markConversationInactive).toHaveBeenCalledWith("user-1", CONV);
  });
});
