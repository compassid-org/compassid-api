const jwt = require('jsonwebtoken');

const getTokenFromRequest = (req) => {
  // Check for token in cookies first (preferred)
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  // Fallback to Authorization header for API compatibility
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
};

const authenticateToken = (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const optionalAuth = (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      req.user = null;
    } else {
      req.user = user;
    }
    next();
  });
};

module.exports = { authenticateToken, optionalAuth };