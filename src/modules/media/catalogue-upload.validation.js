const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const mediaMime = z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);

const sessionSchema = z.object({
  body: z.object({ mimeType: mediaMime }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const completeSchema = z.object({
  body: z.object({ publicId: z.string().trim().min(1).max(500), alt: z.string().trim().max(200).optional() }),
  params: z.object({ businessId: objectId, sessionId: objectId }),
  query: z.record(z.never()).default({})
});

module.exports = { sessionSchema, completeSchema };
