const mongoose = require("mongoose");

const jobLikeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JobVacancy",
      required: true,
    }
  },
  { timestamps: true }
);

// Unique compound index to prevent duplicate likes
jobLikeSchema.index({ userId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model("JobLike", jobLikeSchema);
