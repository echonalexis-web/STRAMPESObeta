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
      enum: ["general", "hiring", "training", "event", "advisory", "spes"],
      default: "general",
    },
    // Extra configuration for SPES program announcements (category === "spes").
    spes: {
      applicationDeadline: { type: Date, default: null },
      slots: { type: Number, default: null },
      requirements: { type: [String], default: [] },
      resultsUrl: { type: String, default: "" },
      resultsStatus: { type: String, enum: ["pending", "published"], default: "pending" },
      resultsPublishedAt: { type: Date, default: null },
      resultsPublishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      resultsSummary: { type: String, default: "" },
      publishAcceptedList: { type: Boolean, default: false },
      exposeScores: { type: Boolean, default: false },
      resultsAnnouncementId: { type: mongoose.Schema.Types.ObjectId, ref: "Announcement", default: null },
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
    commentsEnabled: {
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
