import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";

export const SocketProvider = ({ children, userId }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    // Don't connect if no userId
    if (!userId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // Get token from localStorage
    const token = localStorage.getItem("token");
    if (!token) {
      console.warn("⚠️ No token found, skipping socket connection");
      setSocket(null);
      setIsConnected(false);
      return;
    }

    // Only create socket if none exists or existing is disconnected
    if (socketRef.current && socketRef.current.connected) {
      console.log("✅ Socket already connected");
      setSocket(socketRef.current);
      setIsConnected(true);
      return;
    }

    console.log("🔌 Connecting to Socket.io server at:", SOCKET_URL);

    // Clear any pending reconnect timeouts
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Create socket connection with auth token
    const newSocket = io(SOCKET_URL, {
      auth: {
        token: token,
      },
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: true,
    });

    socketRef.current = newSocket;

    // Connection event handlers
    newSocket.on("connect", () => {
      console.log("✅ Socket connected with ID:", newSocket.id);
      setIsConnected(true);
      setSocket(newSocket);
      // Clear any pending reconnect attempts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    });

    newSocket.on("connect_error", (error) => {
      console.error("❌ Socket connection error:", error.message);
      setIsConnected(false);
      
      // Don't set socket to null on first error - let reconnection work
      if (error.message === "Authentication required" || error.message === "Invalid token") {
        setSocket(null);
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
      }
    });

    newSocket.on("disconnect", (reason) => {
      console.log("🔌 Socket disconnected:", reason);
      setIsConnected(false);
      
      // Only clear socket if not reconnecting
      if (reason === "io server disconnect" || reason === "transport close") {
        setSocket(null);
      }
    });

    newSocket.on("reconnect", (attemptNumber) => {
      console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
      setSocket(newSocket);
    });

    newSocket.on("reconnect_attempt", (attemptNumber) => {
      console.log(`🔄 Socket reconnection attempt ${attemptNumber}`);
    });

    newSocket.on("reconnect_failed", () => {
      console.error("❌ Socket reconnection failed");
      setIsConnected(false);
      setSocket(null);
      
      // Attempt a fresh connection after a delay
      reconnectTimeoutRef.current = setTimeout(() => {
        if (userId && !socketRef.current?.connected) {
          console.log("🔄 Attempting fresh socket connection");
          if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
          }
          // Trigger reconnection by re-running the effect
          // This will create a new socket
          window.dispatchEvent(new Event('socket-reconnect'));
        }
      }, 5000);
    });

    newSocket.on("error", (error) => {
      console.error("❌ Socket error:", error);
    });

    // Cleanup on unmount
    return () => {
      console.log("🔌 Cleaning up socket connection");
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      setSocket(null);
      setIsConnected(false);
    };
  }, [userId]);

  // Listen for reconnect events
  useEffect(() => {
    const handleReconnect = () => {
      if (userId && !socketRef.current?.connected) {
        // Trigger reconnection
        const token = localStorage.getItem("token");
        if (token && socketRef.current) {
          socketRef.current.auth = { token };
          socketRef.current.connect();
        }
      }
    };

    window.addEventListener('socket-reconnect', handleReconnect);
    return () => {
      window.removeEventListener('socket-reconnect', handleReconnect);
    };
  }, [userId]);

  // Memoize the value to prevent unnecessary re-renders
  const value = useMemo(() => ({ socket, isConnected }), [socket, isConnected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (context === null) {
    console.warn("useSocket must be used within a SocketProvider");
    return { socket: null, isConnected: false };
  }
  return context;
};