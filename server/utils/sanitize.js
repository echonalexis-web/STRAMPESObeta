const xss = require('xss');
const validator = require('validator');

// Sanitize object recursively
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // Remove dangerous keys
    if (key.startsWith('$') || key === '__proto__' || key === 'constructor') {
      continue;
    }
    
    if (typeof value === 'string') {
      sanitized[key] = xss(value.trim());
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? xss(item.trim()) : sanitizeObject(item)
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

// Sanitize email
const sanitizeEmail = (email) => {
  if (!email) return '';
  return validator.normalizeEmail(email, {
    gmail_remove_dots: false,
    gmail_remove_subaddress: true,
    outlook_remove_subaddress: true,
    yahoo_remove_subaddress: true
  });
};

// Sanitize phone number
const sanitizePhone = (phone) => {
  if (!phone) return '';
  return phone.replace(/[^0-9+]/g, '');
};

// Sanitize URL
const sanitizeUrl = (url) => {
  if (!url) return '';
  return validator.trim(url);
};

// Check for dangerous content
const hasDangerousContent = (text) => {
  if (!text) return false;
  
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /onerror\s*=/i,
    /onload\s*=/i,
    /data:text\/html/i,
    /vbscript:/i,
    /expression\s*\(/i,
    /url\s*\(/i,
  ];
  
  return dangerousPatterns.some(pattern => pattern.test(text));
};

// Validate and sanitize filename
const sanitizeFilename = (filename) => {
  if (!filename) return '';
  // Remove path traversal attempts
  let safe = filename.replace(/\.\./g, '');
  safe = safe.replace(/[\\/:*?"<>|]/g, '');
  // Limit length
  safe = safe.slice(0, 100);
  return safe;
};

// Sanitize HTML (allow safe tags)
const sanitizeHtml = (html) => {
  if (!html) return '';
  // Use xss with custom options to allow some safe tags
  return xss(html, {
    whiteList: {
      'b': [],
      'i': [],
      'u': [],
      'strong': [],
      'em': [],
      'p': ['style'],
      'br': [],
      'ul': [],
      'ol': [],
      'li': [],
      'a': ['href', 'target'],
      'span': ['style']
    },
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed']
  });
};

module.exports = {
  sanitizeObject,
  sanitizeEmail,
  sanitizePhone,
  sanitizeUrl,
  hasDangerousContent,
  sanitizeFilename,
  sanitizeHtml
};