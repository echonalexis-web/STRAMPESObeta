require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

const createUser = async () => {
  await connectDB();

  try {
    const name = process.argv[2];
    const email = process.argv[3];
    const password = process.argv[4];
    const role = process.argv[5] || "jobseeker"; // Default to 'jobseeker'

    if (!name || !email || !password) {
      console.log(
        "Please provide name, email, and password as arguments."
      );
      console.log(
        "Usage: node createUser.js <name> <email> <password> [role]"
      );
      return;
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("A user with this email already exists.");
      // Optionally, you could update the existing user here
      // For now, we'll just exit.
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
    });

    console.log(`User with role '${role}' created successfully:`, user);
  } catch (error) {
    console.error("Error creating user:", error);
  } finally {
    mongoose.disconnect();
    console.log("MongoDB Disconnected");
  }
};

createUser();
