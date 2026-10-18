const { z } = require('zod');

const empty = z.record(z.never()).default({});
const updatePlatformCommissionSchema = z.object({
  body: z.object({
    commissionBps: z.coerce.number().int().min(0).max(10_000),
    reason: z.string().trim().min(5).max(2_000)
  }),
  params: empty,
  query: empty
});

const getPlatformCommissionSchema = z.object({ body: empty, params: empty, query: empty });

module.exports = { updatePlatformCommissionSchema, getPlatformCommissionSchema };
