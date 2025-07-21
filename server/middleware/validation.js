const Joi = require('joi');

const noteValidation = {
  create: Joi.object({
    text: Joi.string().max(1000).required(),
    position: Joi.object({
      x: Joi.number().required(),
      y: Joi.number().required(),
      z: Joi.number().default(0)
    }).required(),
    color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).default('#ffff88'),
    workspaceId: Joi.string().required()
  }),
  
  update: Joi.object({
    text: Joi.string().max(1000),
    position: Joi.object({
      x: Joi.number(),
      y: Joi.number(),
      z: Joi.number()
    }),
    color: Joi.string().pattern(/^#[0-9A-F]{6}$/i)
  })
};

const workspaceValidation = {
  create: Joi.object({
    name: Joi.string().max(100).required(),
    description: Joi.string().max(500),
    type: Joi.string().valid('2d', '3d', 'mixed').default('3d'),
    settings: Joi.object({
      maxParticipants: Joi.number().min(1).max(100).default(50),
      isPublic: Joi.boolean().default(false),
      allowAnonymous: Joi.boolean().default(true),
      enableVoiceChat: Joi.boolean().default(true),
      enableDrawing: Joi.boolean().default(true)
    })
  }),
  
  update: Joi.object({
    name: Joi.string().max(100),
    description: Joi.string().max(500),
    settings: Joi.object({
      maxParticipants: Joi.number().min(1).max(100),
      isPublic: Joi.boolean(),
      allowAnonymous: Joi.boolean(),
      enableVoiceChat: Joi.boolean(),
      enableDrawing: Joi.boolean()
    })
  })
};

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details.map(d => d.message)
      });
    }
    next();
  };
};

module.exports = {
  noteValidation,
  workspaceValidation,
  validateRequest
};
