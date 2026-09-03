const mongoose = require("mongoose");

const newsLikeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    newsId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
    },
  },
  { timestamps: true }
);

// Unique compound index to prevent duplicate likes
newsLikeSchema.index({ userId: 1, newsId: 1 }, { unique: true });

module.exports = mongoose.model("NewsLike", newsLikeSchema);
