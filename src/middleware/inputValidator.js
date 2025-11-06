import { body, param, validationResult } from 'express-validator';

// Middleware to check validation results
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Common validation rules
export const validateRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('first_name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('First name is required (max 100 characters)'),
  body('last_name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Last name is required (max 100 characters)'),
  body('institution')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Institution must be less than 200 characters'),
  validate
];

export const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  validate
];

export const validateGroupCreation = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Group name must be 3-100 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be 10-1000 characters'),
  body('is_private')
    .optional()
    .isBoolean()
    .withMessage('is_private must be a boolean'),
  validate
];

export const validateFeaturedOpportunity = [
  body('type')
    .isIn(['job', 'grant', 'training', 'event'])
    .withMessage('Type must be one of: job, grant, training, event'),
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be 5-200 characters'),
  body('organization')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Organization must be 2-200 characters'),
  body('location')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Location must be 2-200 characters'),
  body('description')
    .trim()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Description must be 20-2000 characters'),
  body('deadline')
    .isISO8601()
    .toDate()
    .withMessage('Valid deadline date is required'),
  body('pricing_tier')
    .isIn(['30day', '60day', '90day'])
    .withMessage('Pricing tier must be 30day, 60day, or 90day'),
  body('salary')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Salary must be less than 100 characters'),
  body('amount')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Amount must be less than 100 characters'),
  body('frameworks')
    .optional()
    .isString()
    .withMessage('Frameworks must be a string'),
  body('remote')
    .optional()
    .isBoolean()
    .withMessage('Remote must be a boolean'),
  validate
];

export const validateUUID = (paramName = 'id') => [
  param(paramName)
    .isUUID()
    .withMessage(`Invalid ${paramName} format`),
  validate
];
