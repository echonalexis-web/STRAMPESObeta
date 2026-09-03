require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");
const compression = require("compression");
const connectDB = require("./config/db");
const { fileFilter, generateSecureFilename, MAX_FILE_SIZE } = require("./middleware/upload");
const { sanitizeRequestBody, sanitizeQueryParams } = require("./middleware/validation");
const { detectMaliciousPayload, securityLogger } = require("./middleware/security");

const app = express();
const server = http.createServer(app);

// ============ CONFIGURATION ============

// Allow multiple origins
const allowedOrigins = (process.env.CLIENT_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS === "true";

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (origin.match(/^http:\/\/localhost:\d+$/)) return true;
  if (origin.match(/^http:\/\/127\.0\.0\.1:\d+$/)) return true;
  return allowVercelPreviews && origin.endsWith(".vercel.app");
};

// ============ SECURITY MIDDLEWARE ============

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: process.env.NODE_ENV === "production" ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws://localhost:3000", "ws://localhost:5173"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  } : false,
}));

// ============ RATE LIMITING ============

// Disable request limits locally so development does not get blocked by 429s.
const disableRateLimits = process.env.DISABLE_RATE_LIMITS === "true" || process.env.NODE_ENV !== "production";

const rateLimitHandler = (req, res, next, options) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(options.statusCode).json(options.message);
};

const createLimiter = (options) => {
  if (disableRateLimits) {
    return (req, res, next) => next();
  }

  return rateLimit({
    ...options,
    handler: rateLimitHandler,
  });
};

// Global limiter
const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { message: "Too many requests from this IP, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth limiter
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { message: "Too many authentication attempts, please try again later." },
  skipSuccessfulRequests: true,
});

// Admin limiter
const adminLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { message: "Too many admin requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Upload limiter
const uploadLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { message: "Too many upload attempts. Please try again later." },
});

app.use(mongoSanitize());
app.use(hpp());
app.use(compression());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(sanitizeRequestBody);
app.use(sanitizeQueryParams);
app.use(detectMaliciousPayload);
app.use(securityLogger);

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error("CORS blocked for this origin"));
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

app.options("*", cors());

app.use("/api", globalLimiter);
app.use("/api/v1/admin", adminLimiter);
app.use("/api/admin", adminLimiter);
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/register", authLimiter);

// ============ FILE UPLOAD CONFIGURATION ============

const fs = require("fs");
const uploadDirs = ["uploads/profiles", "uploads/jobs", "uploads/resumes", "uploads/news", "uploads/temp"];
uploadDirs.forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true, mode: 0o755 });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "uploads/temp";
    if (req.uploadType === "profile") uploadPath = "uploads/profiles";
    if (req.uploadType === "job") uploadPath = "uploads/jobs";
    if (req.uploadType === "resume") uploadPath = "uploads/resumes";
    cb(null, path.join(__dirname, uploadPath));
  },
  filename: (req, file, cb) => {
    const secureFilename = generateSecureFilename(file);
    req.uploadedFiles = req.uploadedFiles || [];
    req.uploadedFiles.push({
      original: file.originalname,
      secure: secureFilename,
      mimetype: file.mimetype,
      size: file.size,
    });
    cb(null, secureFilename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: fileFilter,
});

app.post("/api/v1/users/upload-profile-image", uploadLimiter, (req, res, next) => {
  req.uploadType = "profile";
  next();
});

app.post("/api/v1/jobs/:id/attachment", uploadLimiter, (req, res, next) => {
  req.uploadType = "job";
  next();
});

app.post("/api/v1/users/upload-resume", uploadLimiter, (req, res, next) => {
  req.uploadType = "resume";
  next();
});

app.use("/uploads", (req, res, next) => {
  const authHeader = req.headers.authorization;
  // Profile pictures and news announcement images are public assets
  const isPublicImage = req.path.includes("/profiles/") || req.path.includes("/news/");

  if (!isPublicImage && !authHeader) {
    return res.status(403).json({ message: "Access denied" });
  }
  
  const requestedPath = path.normalize(req.path);
  if (requestedPath.includes("..")) {
    return res.status(403).json({ message: "Invalid file path" });
  }
  
  next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  maxAge: "7d",
  setHeaders: (res, filePath) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!filePath.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      res.setHeader("Content-Disposition", "attachment");
    }
  },
}));

// ============ DATABASE CONNECTION ============

(async () => {
  await connectDB();

  // ============ ROUTES ============
  console.log("📁 Loading route files...");
  
  const authRoutes = require("./routes/authRoutes");
  console.log("✅ Auth routes loaded");
  
  const jobRoutes = require("./routes/jobRoutes");
  console.log("✅ Job routes loaded");
  
  const employerRoutes = require("./routes/employerRoutes");
  console.log("✅ Employer routes loaded");
  
  const adminRoutes = require("./routes/adminRoutes");
  console.log("✅ Admin routes loaded");
  
  const messageRoutes = require("./routes/messageRoutes");
  console.log("✅ Message routes loaded");
  
  const userRoutes = require("./routes/userRoutes");
  console.log("✅ User routes loaded");

  // --- NEW: Recommendation routes ---
  const recommendationRoutes = require("./routes/recommendationRoutes");
  console.log("✅ Recommendation routes loaded");

  const notificationRoutes = require("./routes/notificationRoutes");
  console.log("✅ Notification routes loaded");

  const followRoutes = require("./routes/followRoutes");
  console.log("✅ Follow routes loaded");

  const jobLikeRoutes = require("./routes/jobLikeRoutes");
  console.log("✅ Job Like routes loaded");

  const newsRoutes = require("./routes/newsRoutes");
  console.log("✅ News routes loaded");

  const newsLikeRoutes = require("./routes/newsLikeRoutes");
  console.log("✅ News Like routes loaded");

  const mountApiRoutes = (basePath) => {
    console.log(`📁 Mounting routes at ${basePath}...`);
    
    app.use(`${basePath}/auth/login`, authLimiter);
    app.use(`${basePath}/auth/register`, authLimiter);
    
    try {
      app.use(`${basePath}/auth`, authRoutes);
      console.log(`✅ ${basePath}/auth mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/auth:`, e.message);
    }
    
    try {
      app.use(`${basePath}/jobs`, jobRoutes);
      console.log(`✅ ${basePath}/jobs mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/jobs:`, e.message);
    }
    
    try {
      app.use(`${basePath}/employer`, employerRoutes);
      console.log(`✅ ${basePath}/employer mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/employer:`, e.message);
    }
    
    try {
      app.use(`${basePath}/admin`, adminRoutes);
      console.log(`✅ ${basePath}/admin mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/admin:`, e.message);
    }
    
    try {
      app.use(`${basePath}/messages`, messageRoutes);
      console.log(`✅ ${basePath}/messages mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/messages:`, e.message);
    }
    
    try {
      app.use(`${basePath}/users`, userRoutes);
      console.log(`✅ ${basePath}/users mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/users:`, e.message);
    }

    try {
      app.use(`${basePath}/notifications`, notificationRoutes);
      console.log(`✅ ${basePath}/notifications mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/notifications:`, e.message);
    }

    // --- NEW: Mount recommendation routes ---
    try {
      app.use(`${basePath}/recommendations`, recommendationRoutes);
      console.log(`✅ ${basePath}/recommendations mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/recommendations:`, e.message);
    }

    // --- NEW: Mount follow routes ---
    try {
      app.use(`${basePath}/follows`, followRoutes);
      console.log(`✅ ${basePath}/follows mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/follows:`, e.message);
    }

    // --- NEW: Mount job like routes ---
    try {
      app.use(`${basePath}/job-likes`, jobLikeRoutes);
      console.log(`✅ ${basePath}/job-likes mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/job-likes:`, e.message);
    }

    try {
      app.use(`${basePath}/news`, newsRoutes);
      console.log(`✅ ${basePath}/news mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/news:`, e.message);
    }

    try {
      app.use(`${basePath}/news-likes`, newsLikeRoutes);
      console.log(`✅ ${basePath}/news-likes mounted`);
    } catch (e) {
      console.error(`❌ Failed to mount ${basePath}/news-likes:`, e.message);
    }

    console.log(`✅ All routes mounted at ${basePath}`);
  };

  mountApiRoutes("/api/v1");
  mountApiRoutes("/api");

  app.locals.upload = upload;

  app.get("/health", (req, res) => {
    res.status(200).json({ 
      status: "ok", 
      timestamp: new Date(),
      uptime: process.uptime()
    });
  });

  // ============ SOCKET.IO ============
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error("CORS blocked for this origin"));
        }
      },
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
    allowEIO3: true,
  });

  app.set("io", io);

  // Socket authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      console.warn("⚠️ Socket connection attempt without token");
      return next(new Error("Authentication required"));
    }

    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      console.log(`✅ Socket authenticated for user: ${socket.userId}`);
      next();
    } catch (err) {
      console.error("❌ Socket authentication error:", err.message);
      next(new Error("Invalid token"));
    }
  });

  // Track user connections and rate limiting
  const userConnections = new Map();
  const messageCounts = new Map();

  io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.userId}`);

    // Join a user-specific room for real-time notifications.
    socket.join(`user:${String(socket.userId)}`);

    // Track user's active sockets
    if (!userConnections.has(socket.userId)) {
      userConnections.set(socket.userId, new Set());
    }
    userConnections.get(socket.userId).add(socket.id);

    // Initialize message count for rate limiting
    if (!messageCounts.has(socket.userId)) {
      messageCounts.set(socket.userId, 0);
    }

    // Reset message count every minute
    const rateLimitInterval = setInterval(() => {
      messageCounts.set(socket.userId, 0);
    }, 60000);

    socket.on("join_conversation", (conversationId) => {
      if (!conversationId || !/^[a-fA-F0-9]{24}$/.test(conversationId)) {
        return socket.emit("error", { message: "Invalid conversation ID" });
      }
      
      socket.rooms = socket.rooms || new Set();
      socket.rooms.add(conversationId);
      socket.join(String(conversationId));
      console.log(`📩 User ${socket.userId} joined conversation: ${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId) => {
      if (!conversationId || !/^[a-fA-F0-9]{24}$/.test(conversationId)) return;
      socket.leave(String(conversationId));
      if (socket.rooms) {
        socket.rooms.delete(conversationId);
      }
      console.log(`📤 User ${socket.userId} left conversation: ${conversationId}`);
    });

    socket.on("send_message", async (data = {}) => {
      const { conversationId, content } = data;
      
      if (!conversationId || !/^[a-fA-F0-9]{24}$/.test(conversationId)) {
        return socket.emit("error", { message: "Invalid conversation ID" });
      }
      
      const sanitizedContent = String(content || "").trim();
      if (!sanitizedContent || sanitizedContent.length > 2000) {
        return socket.emit("error", { message: "Invalid message content" });
      }

      const userMessageCount = messageCounts.get(socket.userId) || 0;
      if (userMessageCount > 30) {
        return socket.emit("error", { message: "Rate limit exceeded. Please wait a moment before sending more messages." });
      }
      messageCounts.set(socket.userId, userMessageCount + 1);
      
      try {
        const Message = require("./models/Message");
        const Conversation = require("./models/Conversation");

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          return socket.emit("error", { message: "Conversation not found" });
        }

        const isParticipant = conversation.participants.some(
          p => String(p) === String(socket.userId)
        );
        if (!isParticipant) {
          return socket.emit("error", { message: "You are not a participant in this conversation" });
        }

        const newMessage = await Message.create({
          conversationId: conversationId,
          sender: socket.userId,
          content: sanitizedContent,
          isRead: false,
        });

        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: sanitizedContent,
          lastMessageAt: newMessage.createdAt,
        });

        const populatedMessage = await Message.findById(newMessage._id)
          .populate("sender", "name email");

        io.to(String(conversationId)).emit("receive_message", {
          ...populatedMessage.toObject(),
          conversationId: conversationId,
        });
      } catch (error) {
        console.error("Error saving message:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("typing", (data = {}) => {
      if (!data.conversationId || !/^[a-fA-F0-9]{24}$/.test(data.conversationId)) return;
      socket.to(String(data.conversationId)).emit("user_typing", {
        conversationId: data.conversationId,
        senderId: socket.userId,
      });
    });

    socket.on("stop_typing", (data = {}) => {
      if (!data.conversationId || !/^[a-fA-F0-9]{24}$/.test(data.conversationId)) return;
      socket.to(String(data.conversationId)).emit("user_stop_typing", {
        conversationId: data.conversationId,
      });
    });

    socket.on("disconnect", () => {
      console.log(`❌ User disconnected: ${socket.userId}`);
      clearInterval(rateLimitInterval);
      if (userConnections.has(socket.userId)) {
        userConnections.get(socket.userId).delete(socket.id);
        if (userConnections.get(socket.userId).size === 0) {
          userConnections.delete(socket.userId);
          messageCounts.delete(socket.userId);
        }
      }
      if (socket.rooms) {
        socket.rooms.forEach((room) => {
          if (room !== socket.id) {
            socket.to(room).emit("user_disconnected", { 
              userId: socket.userId,
              socketId: socket.id 
            });
          }
        });
        socket.rooms.clear();
      }
    });
  });

  // ============ ERROR HANDLING ============
  
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ 
          message: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB` 
        });
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ message: "Unexpected file field" });
      }
      return res.status(400).json({ message: err.message });
    }
    next(err);
  });

  app.use((err, req, res, next) => {
    console.error("Server error:", err);
    
    if (req.uploadedFiles) {
      req.uploadedFiles.forEach((file) => {
        const filePath = path.join(__dirname, "uploads", "temp", file.secure);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }
    
    res.status(err.status || 500).json({
      message: process.env.NODE_ENV === "production" 
        ? "Something went wrong" 
        : err.message,
    });
  });

  app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
  });

  // ============ START SERVER ============
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📡 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🔗 API Base URL: http://localhost:${PORT}/api/v1`);
    console.log(`📝 Allowed origins: ${allowedOrigins.join(", ")}`);
    console.log(`\n✅ All systems ready!\n`);
  });
})();