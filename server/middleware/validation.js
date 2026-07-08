const xss = require('xss');

// Sanitize input
const sanitizeInput = (value) => {
  if (typeof value === 'string') {
    return xss(value.trim());
  }
  return value;
};

// Sanitize all request inputs
const sanitizeRequestBody = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeInput(req.body[key]);
      } else if (Array.isArray(req.body[key])) {
        req.body[key] = req.body[key].map(item => 
          typeof item === 'string' ? sanitizeInput(item) : item
        );
      } else if (typeof req.body[key] === 'object' && req.body[key] !== null) {
        // Recursively sanitize nested objects
        const sanitizeObject = (obj) => {
          if (!obj || typeof obj !== 'object') return obj;
          const sanitized = {};
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string') {
              sanitized[k] = sanitizeInput(v);
            } else if (Array.isArray(v)) {
              sanitized[k] = v.map(item => typeof item === 'string' ? sanitizeInput(item) : item);
            } else if (typeof v === 'object' && v !== null) {
              sanitized[k] = sanitizeObject(v);
            } else {
              sanitized[k] = v;
            }
          }
          return sanitized;
        };
        req.body[key] = sanitizeObject(req.body[key]);
      }
    });
  }
  next();
};

// Sanitize query parameters
const sanitizeQueryParams = (req, res, next) => {
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        // Remove MongoDB operators
        req.query[key] = req.query[key].replace(/[\[\]{}()$]/g, '');
        req.query[key] = sanitizeInput(req.query[key]);
      }
    });
  }
  next();
};

// Manual validation functions
const validateUserUpdate = (req, res, next) => {
  const { name, email, phone, address, bio } = req.body;
  const errors = [];

  if (name !== undefined) {
    if (name.length < 2 || name.length > 50) {
      errors.push('Name must be between 2 and 50 characters');
    }
    if (!/^[a-zA-Z\s\-']+$/.test(name)) {
      errors.push('Name can only contain letters, spaces, hyphens, and apostrophes');
    }
  }
  
  if (email !== undefined && !/^\S+@\S+\.\S+$/.test(email)) {
    errors.push('Please provide a valid email');
  }
  
  if (phone !== undefined && phone && !/^[0-9+\-\s()]{10,20}$/.test(phone)) {
    errors.push('Invalid phone number format');
  }
  
  if (address !== undefined && address && address.length > 200) {
    errors.push('Address is too long');
  }
  
  if (bio !== undefined && bio && bio.length > 500) {
    errors.push('Bio cannot exceed 500 characters');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

const validatePasswordChange = (req, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const errors = [];

  if (!currentPassword) {
    errors.push('Current password is required');
  }
  
  if (!newPassword || newPassword.length < 8) {
    errors.push('New password must be at least 8 characters');
  }
  
  if (newPassword && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(newPassword)) {
    errors.push('Password must contain uppercase, lowercase, number, and special character');
  }
  
  if (newPassword !== confirmPassword) {
    errors.push('Passwords do not match');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

const validateMongoId = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!id || !/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({ message: `Invalid ${paramName} format` });
    }
    next();
  };
};

const validateRequest = (req, res, next) => {
  next();
};

const validateUserRegistration = (req, res, next) => {
  const { name, email, password, phone } = req.body;
  const errors = [];

  if (!name || name.length < 2 || name.length > 50) {
    errors.push('Name must be between 2 and 50 characters');
  }
  
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    errors.push('Please provide a valid email');
  }
  
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  
  if (password && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(password)) {
    errors.push('Password must contain uppercase, lowercase, number, and special character');
  }
  
  if (phone && !/^[0-9+\-\s()]{10,20}$/.test(phone)) {
    errors.push('Invalid phone number format');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

const validateUserLogin = (req, res, next) => {
  const { email, password } = req.body;
  const errors = [];

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    errors.push('Please provide a valid email');
  }
  
  if (!password) {
    errors.push('Password is required');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

const validateJobPosting = (req, res, next) => {
  const { title, description, location, jobType, requirements, salary } = req.body;
  const errors = [];

  if (!title || title.length < 5 || title.length > 100) {
    errors.push('Title must be between 5 and 100 characters');
  }
  
  if (!description || description.length < 20 || description.length > 5000) {
    errors.push('Description must be between 20 and 5000 characters');
  }
  
  if (!location || location.length < 2 || location.length > 100) {
    errors.push('Location is required and must be between 2 and 100 characters');
  }
  
  const validJobTypes = ['Full-time', 'Part-time', 'Contract', 'Temporary', 'Internship', 'Remote'];
  if (!jobType || !validJobTypes.includes(jobType)) {
    errors.push('Invalid job type');
  }
  
  if (salary && salary.length > 50) {
    errors.push('Salary format too long');
  }
  
  if (requirements && requirements.length > 2000) {
    errors.push('Requirements too long');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

// ============================================
// UPDATED: Validate Job Application with better security
// ============================================
const validateJobApplication = (req, res, next) => {
  const { coverLetter } = req.body;
  const errors = [];

  // Only validate if coverLetter is provided
  if (coverLetter !== undefined && coverLetter !== null) {
    const trimmed = coverLetter.trim();
    const length = trimmed.length;
    
    // Maximum length check - 1000 characters (reduced from 2000)
    if (length > 1000) {
      errors.push(`Cover letter cannot exceed 1000 characters (currently ${length})`);
    }
    
    // Minimum length check (optional - only if content is provided)
    if (length > 0 && length < 10) {
      errors.push('Cover letter must be at least 10 characters');
    }
    
    // Check for suspicious patterns (XSS protection)
    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /onerror\s*=/i,
      /onload\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /data:text\/html/i,
      /vbscript:/i,
      /expression\s*\(/i,
      /onclick\s*=/i,
      /onmouseover\s*=/i,
      /alert\s*\(/i,
      /eval\s*\(/i,
      /document\./i,
      /window\./i
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(trimmed)) {
        errors.push('Cover letter contains suspicious or malicious content');
        break;
      }
    }
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

const validateMessage = (req, res, next) => {
  const { content, receiverId } = req.body;
  const errors = [];

  if (!content || content.trim().length === 0) {
    errors.push('Message content is required');
  }
  
  if (content && content.length > 2000) {
    errors.push('Message too long');
  }
  
  if (!receiverId || !/^[a-fA-F0-9]{24}$/.test(receiverId)) {
    errors.push('Invalid receiver ID');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

const validateNotificationRead = (req, res, next) => {
  const { notificationId } = req.params;
  if (!notificationId || !/^[a-fA-F0-9]{24}$/.test(notificationId)) {
    return res.status(400).json({ message: 'Invalid notification ID' });
  }
  next();
};

module.exports = {
  sanitizeRequestBody,
  sanitizeQueryParams,
  validateUserUpdate,
  validatePasswordChange,
  validateMongoId,
  validateRequest,
  validateUserRegistration,
  validateUserLogin,
  validateJobPosting,
  validateJobApplication,
  validateMessage,
  validateNotificationRead
};