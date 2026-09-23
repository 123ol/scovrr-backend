const { AppError } = require('./AppError');
const { env } = require('../../config/env');

function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} was not found`));
}

function errorHandler(error, _req, res, _next) {
  let normalized = error;

  if (error?.name === 'ZodError') {
    const fields = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || 'request';
      fields[field] = issue.message;
    }
    normalized = new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);
  } else if (error?.code === 11000) {
    const fields = Object.keys(error.keyPattern || {});
    normalized = new AppError(409, 'DUPLICATE_RESOURCE', `A resource with the same ${fields.join(', ')} already exists`);
  } else if (!(error instanceof AppError)) {
    normalized = new AppError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }

  if (normalized.statusCode >= 500) {
    console.error(error);
  }

  const response = {
    success: false,
    error: {
      code: normalized.code,
      message: normalized.message
    }
  };

  if (normalized.details) {
    response.error.fields = normalized.details;
  }

  if (env.nodeEnv !== 'production' && error?.stack && normalized.statusCode >= 500) {
    response.error.debug = error.stack;
  }

  res.status(normalized.statusCode || 500).json(response);
}

module.exports = { notFoundHandler, errorHandler };
