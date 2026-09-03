const xss = require('xss');

// ============ SANITIZATION ============
const sanitizeInput = (value) => {
  if (typeof value === 'string') {
    return xss(value.trim());
  }
  return value;
};

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

const sanitizeQueryParams = (req, res, next) => {
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key].replace(/[\[\]{}()$]/g, '');
        req.query[key] = sanitizeInput(req.query[key]);
      }
    });
  }
  next();
};

// ============ USER VALIDATIONS ============
const validateUserUpdate = (req, res, next) => {
  const { 
    name, email, phone, address, bio,
    civilStatus, placeOfBirth, citizenship, height, weight,
    landline, mobileSecondary,
    presentAddress, permanentAddress,
    disability, is4psBeneficiary, _4psHouseholdId,
    isOfw, isRepatriated, repatriationIntent,
    employmentStatus, employmentType, unemploymentReason, laidoffCountry,
    tradeName, acronym, tin, officeType, employerClassification,
    totalWorkforceSize, ownerName, contactPersonName, contactPersonPosition, fax
  } = req.body;
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

  if (req.user?.role === 'resident' || !req.user) {
    if (civilStatus !== undefined && !["Single", "Married", "Widowed", "Separated", "Divorced"].includes(civilStatus)) {
      errors.push('Invalid civil status');
    }
    if (placeOfBirth !== undefined && placeOfBirth && placeOfBirth.length > 100) {
      errors.push('Place of birth too long');
    }
    if (citizenship !== undefined && citizenship && citizenship.length > 50) {
      errors.push('Citizenship too long');
    }
    if (height !== undefined && height && (isNaN(parseFloat(height)) || parseFloat(height) < 50 || parseFloat(height) > 300)) {
      errors.push('Height must be a number between 50 and 300 cm');
    }
    if (weight !== undefined && weight && (isNaN(parseFloat(weight)) || parseFloat(weight) < 10 || parseFloat(weight) > 500)) {
      errors.push('Weight must be a number between 10 and 500 kg');
    }
    if (landline !== undefined && landline && !/^[0-9+\-\s()]{7,15}$/.test(landline)) {
      errors.push('Invalid landline format');
    }
    if (mobileSecondary !== undefined && mobileSecondary && !/^[0-9+\-\s()]{10,20}$/.test(mobileSecondary)) {
      errors.push('Invalid secondary mobile format');
    }
    if (disability !== undefined && !Array.isArray(disability)) {
      errors.push('Disability must be an array');
    } else if (disability) {
      const validDisabilities = ["Visual", "Hearing", "Speech", "Physical", "Others"];
      for (const d of disability) {
        if (!validDisabilities.includes(d)) {
          errors.push('Invalid disability type');
          break;
        }
      }
    }
    if (is4psBeneficiary !== undefined && typeof is4psBeneficiary !== 'boolean' && is4psBeneficiary !== 'true' && is4psBeneficiary !== 'false') {
      errors.push('4Ps beneficiary must be a boolean');
    }
    if (_4psHouseholdId !== undefined && _4psHouseholdId && _4psHouseholdId.length > 20) {
      errors.push('4Ps household ID too long');
    }
    if (isOfw !== undefined && typeof isOfw !== 'boolean' && isOfw !== 'true' && isOfw !== 'false') {
      errors.push('OFW status must be a boolean');
    }
    if (isRepatriated !== undefined && typeof isRepatriated !== 'boolean' && isRepatriated !== 'true' && isRepatriated !== 'false') {
      errors.push('Repatriated status must be a boolean');
    }
    if (repatriationIntent !== undefined && repatriationIntent && repatriationIntent.length > 200) {
      errors.push('Repatriation intent too long');
    }
    if (employmentStatus !== undefined && !["employed", "unemployed"].includes(employmentStatus)) {
      errors.push('Invalid employment status');
    }
    if (employmentType !== undefined && employmentType && !["wage", "self"].includes(employmentType)) {
      errors.push('Invalid employment type');
    }
    if (unemploymentReason !== undefined && unemploymentReason) {
      const reasons = ["fresh_grad", "finished_contract", "resigned", "retired", "laidoff_local", "laidoff_abroad"];
      if (!reasons.includes(unemploymentReason)) {
        errors.push('Invalid unemployment reason');
      }
    }
    if (laidoffCountry !== undefined && laidoffCountry && laidoffCountry.length > 50) {
      errors.push('Laid off country too long');
    }
  }

  if (req.user?.role === 'employer' || !req.user) {
    if (tradeName !== undefined && tradeName && tradeName.length > 100) {
      errors.push('Trade name too long');
    }
    if (acronym !== undefined && acronym && acronym.length > 20) {
      errors.push('Acronym too long');
    }
    if (tin !== undefined && tin && !/^\d{9,12}$/.test(tin.replace(/-/g, ''))) {
      errors.push('Invalid TIN format (should be 9-12 digits)');
    }
    if (officeType !== undefined && officeType && !["main", "branch"].includes(officeType)) {
      errors.push('Invalid office type');
    }
    if (employerClassification !== undefined && employerClassification) {
      if (typeof employerClassification !== 'object') {
        errors.push('Employer classification must be an object');
      } else {
        const { type, subtype } = employerClassification;
        if (type && !["public", "private"].includes(type)) {
          errors.push('Invalid employer classification type');
        }
        const validPublicSubtypes = ["NGA", "LGU", "GOCC", "SUC/LUC"];
        const validPrivateSubtypes = ["Direct Hire", "Local Recruitment Agency", "Overseas Recruitment Agency", "D.O. 174 Contractor"];
        if (subtype) {
          if (type === 'public' && !validPublicSubtypes.includes(subtype)) {
            errors.push('Invalid public subtype');
          } else if (type === 'private' && !validPrivateSubtypes.includes(subtype)) {
            errors.push('Invalid private subtype');
          } else if (!type) {
            errors.push('Classification type required when subtype provided');
          }
        }
      }
    }
    if (totalWorkforceSize !== undefined && totalWorkforceSize && !["micro", "small", "medium", "large"].includes(totalWorkforceSize)) {
      errors.push('Invalid workforce size');
    }
    if (ownerName !== undefined && ownerName && ownerName.length > 100) {
      errors.push('Owner name too long');
    }
    if (contactPersonName !== undefined && contactPersonName && contactPersonName.length > 100) {
      errors.push('Contact person name too long');
    }
    if (contactPersonPosition !== undefined && contactPersonPosition && contactPersonPosition.length > 100) {
      errors.push('Contact person position too long');
    }
    if (fax !== undefined && fax && !/^[0-9+\-\s()]{7,15}$/.test(fax)) {
      errors.push('Invalid fax format');
    }
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
  
  if (password && !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/.test(password)) {
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

const validateJobApplication = (req, res, next) => {
  const { coverLetter } = req.body;
  const errors = [];

  if (coverLetter !== undefined && coverLetter !== null) {
    const trimmed = coverLetter.trim();
    const length = trimmed.length;
    
    if (length > 1000) {
      errors.push(`Cover letter cannot exceed 1000 characters (currently ${length})`);
    }
    
    if (length > 0 && length < 10) {
      errors.push('Cover letter must be at least 10 characters');
    }
    
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

// ============ JOB VALIDATIONS (UNIFIED) ============
const validateJobPosting = (req, res, next) => {
  const { title, description, location, jobType, requirements, salary, qualifications } = req.body;
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

  // --- NEW VALIDATIONS for filter fields ---
  if (req.body.industry !== undefined && typeof req.body.industry !== 'string') {
    errors.push('Industry must be a string');
  }
  if (req.body.workNature !== undefined && !['remote','onsite','hybrid'].includes(req.body.workNature)) {
    errors.push('Invalid work nature');
  }
  if (req.body.salaryMin !== undefined && isNaN(Number(req.body.salaryMin))) {
    errors.push('Salary minimum must be a number');
  }
  if (req.body.salaryMax !== undefined && isNaN(Number(req.body.salaryMax))) {
    errors.push('Salary maximum must be a number');
  }

  // Validate qualifications if provided
  if (qualifications !== undefined) {
    if (!Array.isArray(qualifications)) {
      errors.push('Qualifications must be an array');
    } else {
      const allowedTypes = ["education", "experience", "skill", "certification", "license", "other"];
      qualifications.forEach((q, index) => {
        if (!q.type || !allowedTypes.includes(q.type)) {
          errors.push(`Qualification at index ${index}: invalid or missing type`);
        }
        if (!q.value || typeof q.value !== "string" || q.value.trim().length === 0) {
          errors.push(`Qualification at index ${index}: value is required`);
        }
      });
    }
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  
  next();
};

// ============ QUALIFICATIONS VALIDATION (used separately) ============
const validateQualifications = (req, res, next) => {
  const { qualifications } = req.body;
  const errors = [];

  if (qualifications === undefined) {
    return next();
  }

  if (!Array.isArray(qualifications)) {
    return res.status(400).json({ 
      message: "Qualifications must be an array",
      field: "qualifications"
    });
  }

  const allowedTypes = ["education", "experience", "skill", "certification", "license", "other"];

  qualifications.forEach((q, index) => {
    if (!q.type) {
      errors.push(`Qualification at index ${index}: "type" is required`);
    } else if (!allowedTypes.includes(q.type)) {
      errors.push(`Qualification at index ${index}: invalid type "${q.type}" – allowed: ${allowedTypes.join(", ")}`);
    }

    if (!q.value || typeof q.value !== "string" || q.value.trim().length === 0) {
      errors.push(`Qualification at index ${index}: "value" is required and must be a non-empty string`);
    }

    if (q.value && q.value.trim().length > 500) {
      errors.push(`Qualification at index ${index}: "value" exceeds 500 characters`);
    }

    if (q.optional !== undefined && typeof q.optional !== "boolean") {
      errors.push(`Qualification at index ${index}: "optional" must be a boolean`);
    }

    if (q.order !== undefined && typeof q.order !== "number") {
      errors.push(`Qualification at index ${index}: "order" must be a number`);
    }
  });

  if (errors.length > 0) {
    return res.status(400).json({ 
      message: "Invalid qualifications",
      errors 
    });
  }

  next();
};

const validateAnnouncementPayload = (req, res, next) => {
  const { title, content, category, imageUrl, publishedAt, isActive } = req.body;
  const errors = [];

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length < 5 || title.trim().length > 180) {
      errors.push("Title must be between 5 and 180 characters");
    }
  }

  if (content !== undefined) {
    if (typeof content !== "string" || content.trim().length < 20 || content.trim().length > 4000) {
      errors.push("Content must be between 20 and 4000 characters");
    }
  }

  if (category !== undefined) {
    const validCategories = ["general", "hiring", "training", "event", "advisory"];
    if (!validCategories.includes(category)) {
      errors.push("Invalid category");
    }
  }

  if (imageUrl !== undefined && imageUrl !== null && imageUrl !== "") {
    if (typeof imageUrl !== "string" || imageUrl.length > 1000) {
      errors.push("Image URL is invalid");
    }
  }

  if (publishedAt !== undefined && publishedAt !== null && publishedAt !== "") {
    const parsed = new Date(publishedAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.push("Published date is invalid");
    }
  }

  if (isActive !== undefined && typeof isActive !== "boolean") {
    errors.push("isActive must be a boolean");
  }

  const isCreate = req.method === "POST";
  if (isCreate) {
    if (title === undefined) errors.push("Title is required");
    if (content === undefined) errors.push("Content is required");
    if (category === undefined) errors.push("Category is required");
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  return next();
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
  validateNotificationRead,
  validateQualifications,
  validateAnnouncementPayload,
};