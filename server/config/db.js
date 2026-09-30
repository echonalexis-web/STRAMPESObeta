const mongoose = require("mongoose");
const logger = require("../utils/logger");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // How long the driver waits to find a usable server before giving up on
      // an operation, instead of hanging indefinitely on a network blip.
      serverSelectionTimeoutMS: 10000,
      // How long an individual socket may sit idle before the driver closes
      // it as dead, so a stalled connection doesn't hang a request forever.
      socketTimeoutMS: 45000,
      // Caps how many concurrent connections this process opens to Atlas —
      // an explicit, intentional limit rather than relying on the driver
      // default, so connection-pool sizing is a known, documented value.
      maxPoolSize: 20,
    });
    logger.info("MongoDB connected");
  } catch (error) {
    logger.error("MongoDB connection failed", { error: error.message });
    process.exit(1);
  }
};

module.exports = connectDB;