const JobseekerDocument = require("../models/JobseekerDocument");
const JobApplication = require("../models/JobApplication");
const storageService = require("../services/storageService");

// Keeps the library from growing without bound; well above what any real
// jobseeker needs (a handful of resume variants and a few cover letters).
const MAX_DOCUMENTS_PER_KIND = 10;

const KIND_LABELS = {
  resume: "resume",
  coverLetter: "cover letter",
};

const CATEGORY_BY_KIND = {
  resume: "jobseekerResume",
  coverLetter: "jobseekerCoverLetter",
};

// ---------------------------------------------------------------------
// List the current jobseeker's saved resumes / cover letters.
// ---------------------------------------------------------------------
exports.listMyDocuments = async (req, res) => {
  try {
    const kind = String(req.query.kind || "").trim();
    const filter = { owner: req.user.id };
    if (["resume", "coverLetter"].includes(kind)) {
      filter.kind = kind;
    }

    const documents = await JobseekerDocument.find(filter).sort({ createdAt: -1 });
    return res.json(documents);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load your documents" });
  }
};

// ---------------------------------------------------------------------
// Save a new resume / cover letter to the library (file upload, or a
// builder-generated PDF blob posted the same way).
// ---------------------------------------------------------------------
exports.uploadMyDocument = async (req, res) => {
  try {
    const kind = String(req.body.kind || "").trim();
    if (!CATEGORY_BY_KIND[kind]) {
      return res.status(400).json({ message: "kind must be 'resume' or 'coverLetter'" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const existingCount = await JobseekerDocument.countDocuments({ owner: req.user.id, kind });
    if (existingCount >= MAX_DOCUMENTS_PER_KIND) {
      return res.status(400).json({
        message: `You can save up to ${MAX_DOCUMENTS_PER_KIND} ${KIND_LABELS[kind]}s. Delete one before adding another.`,
      });
    }

    const uploadResult = await storageService.upload(req.file, {
      category: CATEGORY_BY_KIND[kind],
      ownerId: req.user.id,
    });

    const title =
      String(req.body.title || "").trim().slice(0, 120) ||
      req.file.originalname ||
      (kind === "resume" ? "Resume" : "Cover letter");
    const source = req.body.source === "builder" ? "builder" : "upload";

    // The first document saved for a kind becomes primary automatically, so
    // the "Primary" badge and ApplyModal's default selection are meaningful
    // even before the jobseeker ever visits the "Set as Primary" action.
    const hasPrimary = await JobseekerDocument.exists({ owner: req.user.id, kind, isPrimary: true });

    const document = await JobseekerDocument.create({
      owner: req.user.id,
      kind,
      title,
      storedValue: uploadResult.storedValue,
      mimeType: req.file.mimetype || "",
      sizeBytes: req.file.size || 0,
      source,
      isPrimary: !hasPrimary,
    });

    return res.status(201).json(document);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to save document" });
  }
};

// ---------------------------------------------------------------------
// Mark one document as the primary resume/cover letter — unsets any other
// primary of the same kind for this owner first, so at most one stays true.
// ---------------------------------------------------------------------
exports.setPrimaryDocument = async (req, res) => {
  try {
    const document = await JobseekerDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
    if (String(document.owner) !== req.user.id) {
      return res.status(403).json({ message: "You can only manage your own documents" });
    }

    await JobseekerDocument.updateMany(
      { owner: req.user.id, kind: document.kind, _id: { $ne: document._id } },
      { $set: { isPrimary: false } }
    );
    document.isPrimary = true;
    await document.save();

    return res.json(document);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to update primary document" });
  }
};

// ---------------------------------------------------------------------
// Remove a document from the library. If no past application ever used it,
// its storage is purged too; otherwise it's left in place so applications
// that already reference it keep working, and only the library listing
// entry is removed.
// ---------------------------------------------------------------------
exports.deleteMyDocument = async (req, res) => {
  try {
    const document = await JobseekerDocument.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
    if (String(document.owner) !== req.user.id) {
      return res.status(403).json({ message: "You can only delete your own documents" });
    }

    const isReferencedByApplication = await JobApplication.exists({
      $or: [{ resumeDocumentId: document._id }, { coverLetterDocumentId: document._id }],
    });

    await JobseekerDocument.findByIdAndDelete(document._id);

    if (!isReferencedByApplication) {
      Promise.resolve(storageService.remove(document.storedValue)).catch(() => {});
    }

    // Deleting the primary document leaves the kind without one — promote
    // the most recently saved remaining document so the badge doesn't just
    // vanish for jobseekers who keep more than one on file.
    if (document.isPrimary) {
      const nextPrimary = await JobseekerDocument.findOne({ owner: req.user.id, kind: document.kind }).sort({
        createdAt: -1,
      });
      if (nextPrimary) {
        nextPrimary.isPrimary = true;
        await nextPrimary.save();
      }
    }

    return res.json({ message: "Document deleted", id: document._id });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to delete document" });
  }
};
