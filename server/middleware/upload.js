const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Allowed file types with MIME types
const ALLOWED_FILE_TYPES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Custom file filter
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = Object.keys(ALLOWED_FILE_TYPES);
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    // Sanitize filename
    const sanitizedName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '');
    file.originalname = sanitizedName;
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedMimeTypes.join(', ')}`), false);
  }
};

// Generate secure filename
const generateSecureFilename = (file) => {
  const extension = ALLOWED_FILE_TYPES[file.mimetype] || path.extname(file.originalname);
  const sanitizedBase = path.basename(file.originalname, extension)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 30);
  return `${uuidv4()}_${sanitizedBase}${extension}`;
};

// Configure storage
const createStorage = (uploadPath) => {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const fullPath = path.join(__dirname, '..', uploadPath);
      // Ensure directory exists with proper permissions
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true, mode: 0o755 });
      }
      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      const secureFilename = generateSecureFilename(file);
      // Store original filename in req for potential use
      req.uploadedFiles = req.uploadedFiles || [];
      req.uploadedFiles.push({
        original: file.originalname,
        secure: secureFilename,
        mimetype: file.mimetype,
        size: file.size
      });
      cb(null, secureFilename);
    }
  });
};

// Profile picture upload configuration
const profileUpload = multer({
  storage: createStorage('uploads/profiles'),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: fileFilter
});

// Job attachment upload configuration
const jobAttachmentUpload = multer({
  storage: createStorage('uploads/jobs'),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5
  },
  fileFilter: fileFilter
});

// Generic single file upload with validation
const singleFileUpload = (fieldName, uploadPath = 'uploads/temp') => {
  return multer({
    storage: createStorage(uploadPath),
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1
    },
    fileFilter: fileFilter
  }).single(fieldName);
};

// Clean up uploaded files on error
const cleanupUploadedFiles = (req, res, next) => {
  const originalJson = res.json;
  res.json = function(data) {
    // If response has error, delete uploaded files
    if (data && (data.message?.includes('error') || data.error)) {
      if (req.uploadedFiles) {
        req.uploadedFiles.forEach(file => {
          const filePath = path.join(__dirname, '..', 'uploads', 'temp', file.secure);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        });
      }
    }
    originalJson.call(this, data);
  };
  next();
};

// Validate file before upload
const validateFile = (req, res, next) => {
  if (!req.file && !req.files) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  
  const files = req.file ? [req.file] : (req.files?.length ? req.files : []);
  
  for (const file of files) {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ message: `File ${file.originalname} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` });
    }
    
    // Check MIME type
    if (!ALLOWED_FILE_TYPES[file.mimetype]) {
      return res.status(400).json({ message: `File ${file.originalname} has invalid type` });
    }
    
    // Check for malicious content
    const dangerousExtensions = ['.exe', '.bat', '.sh', '.php', '.asp', '.js', '.html', '.htm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (dangerousExtensions.includes(ext)) {
      return res.status(400).json({ message: `File type ${ext} is not allowed` });
    }
  }
  
  next();
};

module.exports = {
  profileUpload,
  jobAttachmentUpload,
  singleFileUpload,
  validateFile,
  cleanupUploadedFiles,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE
};