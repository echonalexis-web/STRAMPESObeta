const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    category: {
      type: String,
      required: true,
      enum: ["general", "hiring", "training", "event", "advisory"],
      default: "general",
    },
    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

announcementSchema.index({ category: 1, isActive: 1, publishedAt: -1 });
announcementSchema.index({ title: "text", content: "text" });

module.exports = mongoose.model("Announcement", announcementSchema);
