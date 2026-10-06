const mongoose = require("mongoose");

// Separate documents keep concurrent replacements of the two forms independent.
const nsrpTemplateSchema = new mongoose.Schema({
  form: { type: String, enum: ["form1", "form2"], required: true, unique: true },
  data: { type: Buffer, required: true },
  filename: { type: String, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("NsrpTemplate", nsrpTemplateSchema);
