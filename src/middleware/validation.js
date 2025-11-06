const Joi = require('joi');

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      error.name = 'ValidationError';
      return next(error);
    }
    next();
  };
};

const schemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string()
      .min(12)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.min': 'Password must be at least 12 characters long',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character'
      }),
    first_name: Joi.string().max(100),
    last_name: Joi.string().max(100),
    institution: Joi.string().max(255)
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  researchSubmit: Joi.object({
    doi: Joi.string().max(255),
    title: Joi.string().required(),
    abstract: Joi.string(),
    publication_year: Joi.number().integer().min(1900).max(2100),
    journal: Joi.string().max(255),
    authors: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      orcid: Joi.string()
    })),
    compass_metadata: Joi.object({
      framework_alignment: Joi.array().items(Joi.string()).min(1).required(),
      geo_scope: Joi.object({
        type: Joi.string().valid('Point', 'Polygon', 'MultiPolygon').required(),
        coordinates: Joi.array().required()
      }),
      geo_scope_text: Joi.string(),
      taxon_scope: Joi.array().items(Joi.object({
        scientific_name: Joi.string(),
        common_name: Joi.string(),
        taxon_rank: Joi.string()
      })),
      temporal_start: Joi.date(),
      temporal_end: Joi.date(),
      methods: Joi.array().items(Joi.string()),
      ecosystem_type: Joi.string().valid(
        'Marine & Coastal',
        'Tropical Forests',
        'Temperate Forests',
        'Grasslands & Savannas',
        'Wetlands',
        'Mountains & Alpine',
        'Desert & Arid',
        'Freshwater',
        'Urban & Built',
        'Agricultural',
        'Other/Mixed'
      ).optional()
    }).required()
  }),

  metadataSuggestion: Joi.object({
    suggestion_type: Joi.string().valid('framework', 'geography', 'taxon', 'temporal', 'methods').required(),
    suggestion_data: Joi.object().required(),
    note: Joi.string()
  })
};

module.exports = { validateRequest, schemas };