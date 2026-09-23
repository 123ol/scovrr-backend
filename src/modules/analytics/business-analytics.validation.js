const { z } = require('zod');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const query = z.object({ range: z.enum(['today', '7d', '30d', 'custom']).optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), locationId: objectId.optional() }).strict();
const schema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query });
module.exports = { schema };
