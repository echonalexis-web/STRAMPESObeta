const crypto = require('crypto');
const logger = require('../utils/logger');

// CSRF Protection (if using sessions)
const csrfProtection = (req, res, next) => {
  // For JWT-based auth, CSRF is less critical but we can still add token validation
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    const csrfToken = req.headers['x-csrf-token'];
    const sessionToken = req.session?.csrfToken;
    
    if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
      return res.status(403).json({ message: 'Invalid CSRF token' });
    }
  }
  next();
};

// Generate CSRF token
const generateCsrfToken = (req, res, next) => {
  if (!req.session) return next();
  
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
};

// Check for malicious payloads
const detectMaliciousPayload = (req, res, next) => {
  const suspiciousPatterns = [
    /<\s*script/i,
    /javascript:/i,
    /vbscript:/i,
    /onload\s*=/i,
    /onerror\s*=/i,
    /onclick\s*=/i,
    /data:text\/html/i,
    /\$\{.*\}/,  // Template injection
    /__proto__/,  // Prototype pollution
    /constructor/, // Prototype pollution
  ];
  
  const checkString = (str) => {
    if (typeof str !== 'string') return false;
    return suspiciousPatterns.some(pattern => pattern.test(str));
  };
  
  const checkObject = (obj) => {
    for (const key in obj) {
      if (checkString(key)) return true;
      if (typeof obj[key] === 'string' && checkString(obj[key])) return true;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (checkObject(obj[key])) return true;
      }
    }
    return false;
  };
  
  if (req.body && checkObject(req.body)) {
    return res.status(400).json({ message: 'Suspicious content detected' });
  }
  
  if (req.query && checkObject(req.query)) {
    return res.status(400).json({ message: 'Suspicious query parameters detected' });
  }
  
  next();
};

// Rate limiting for sensitive operations
//
// In-memory and per process: it resets on restart and is not shared between
// instances, so use it for low-stakes limits only. Security-critical limits for
// the username sign-up feature are database-backed (middleware/dbLimiter.js).
//   options.keyFn(req) -> string  optional; defaults to the client IP. Used to
//                                 key by identifier plus IP.
// Idle keys are pruned at most once per window, so the map cannot grow forever.
const sensitiveOperationLimiter = (maxRequests = 5, windowMs = 60 * 60 * 1000, options = {}) => {
  const requests = new Map();
  let lastSweep = Date.now();
  const keyFn = typeof options.keyFn === 'function' ? options.keyFn : (req) => req.ip;

  return (req, res, next) => {
    const ip = keyFn(req);
    const now = Date.now();

    if (now - lastSweep >= windowMs) {
      for (const [key, times] of requests) {
        if (!times.some((time) => now - time < windowMs)) requests.delete(key);
      }
      lastSweep = now;
    }

    const userRequests = requests.get(ip) || [];
    
    // Clean old requests
    const validRequests = userRequests.filter(time => now - time < windowMs);
    
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({ 
        message: `Too many attempts. Please try again after ${windowMs / 60000} minutes.` 
      });
    }
    
    validRequests.push(now);
    requests.set(ip, validRequests);
    next();
  };
};

// Log security events
const securityLogger = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Log suspicious activities
    if (res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 403) {
      logger.warn('security_event', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userId: req.user?._id || 'unauthenticated',
      });
    }
  });
  
  next();
};

module.exports = {
  csrfProtection,
  generateCsrfToken,
  detectMaliciousPayload,
  sensitiveOperationLimiter,
  securityLogger
};