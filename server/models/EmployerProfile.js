const mongoose = require("mongoose");

const employerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Business Identity
    tradeName: { type: String, default: "" },
    acronym: { type: String, default: "" },
    tin: { type: String, default: "" },
    // Office Type
    officeType: {
      type: String,
      enum: ["main", "branch"],
      default: null,
    },
    // Classification
    employerClassification: {
      type: {
        type: String,
        enum: ["public", "private"],
        default: null,
      },
      subtype: {
        type: String,
        enum: [
          "NGA",
          "LGU",
          "GOCC",
          "SUC/LUC",
          "Direct Hire",
          "Local Recruitment Agency",
          "Overseas Recruitment Agency",
          "D.O. 174 Contractor",
        ],
        default: null,
      },
    },
    // Firm Metrics
    totalWorkforceSize: {
      type: String,
      enum: ["micro", "small", "medium", "large"],
      default: null,
    },
    // Business Address (structured). Every field the frontend's
    // businessAddressStructured sends must be declared here — Mongoose
    // silently drops any key not in the schema on save (both on
    // `.save()` and on `findOneAndUpdate` with `$set`), so a field missing
    // here doesn't error, it just quietly never persists. `region` was
    // missing for a long time: the LocationSelect cascade needs it to
    // resolve which provinces/cities/barangays are even valid options, so
    // losing it on save made province/city/barangay look wiped too, even
    // though (for barangay/city/province) they may have still round-tripped
    // correctly underneath — nothing in the UI had a region to rebuild the
    // rest of the cascade from.
    businessAddress: {
      street: { type: String, default: "" },
      barangay: { type: String, default: "" },
      municipality: { type: String, default: "" },
      province: { type: String, default: "" },
      region: { type: String, default: "" },
    },
    // Corporate Contacts
    ownerName: { type: String, default: "" },
    contactPersonName: { type: String, default: "" },
    contactPersonPosition: { type: String, default: "" },
    fax: { type: String, default: "" },
  },
  { timestamps: true }
);

employerProfileSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model("EmployerProfile", employerProfileSchema);