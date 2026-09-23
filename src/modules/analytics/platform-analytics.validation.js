const { z } = require('zod');
const query = z.object({ range: z.enum(['today', '7d', '30d', 'custom']).optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }).strict();
const schema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query });
module.exports = { schema };
