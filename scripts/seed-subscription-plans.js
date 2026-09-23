const { env } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { SubscriptionPlan } = require('../src/modules/subscriptions/subscription-plan.model');
const { PlanVersion } = require('../src/modules/subscriptions/plan-version.model');
const { INITIAL_PLAN_ENTITLEMENTS } = require('../src/modules/subscriptions/entitlement-registry');

const plans = [
  { code: 'FREE', name: 'Free', description: 'A practical starting plan for every SCOVRR business.', displayOrder: 1, trialEligible: false, monthly: 0, yearly: 0 },
  { code: 'PRO', name: 'Pro', description: 'More capacity and growth tools for an active business.', displayOrder: 2, trialEligible: true, monthly: env.subscriptionProMonthlyAmountMinor, yearly: env.subscriptionProYearlyAmountMinor },
  { code: 'BUSINESS_PLUS', name: 'Business+', description: 'Expanded capacity for growing multi-location operations.', displayOrder: 3, trialEligible: true, monthly: env.subscriptionBusinessPlusMonthlyAmountMinor, yearly: env.subscriptionBusinessPlusYearlyAmountMinor }
];

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

async function seed({ dryRun = false } = {}) {
  if (dryRun) return { dryRun: true, plans: plans.map((item) => ({ code: item.code, action: 'would_create_or_keep_version_1' })) };
  const report = [];
  for (const item of plans) {
    const plan = await SubscriptionPlan.findOneAndUpdate({ code: item.code }, { $setOnInsert: { code: item.code }, $set: { name: item.name, description: item.description, status: 'active', displayOrder: item.displayOrder, public: true, trialEligible: item.trialEligible } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    let version = await PlanVersion.findOne({ planId: plan._id, version: 1 });
    let action = 'kept_existing_version_1';
    if (!version) {
      version = await PlanVersion.create({ planId: plan._id, version: 1, status: 'active', effectiveFrom: new Date(), prices: [{ billingInterval: 'monthly', amountMinor: item.monthly, currency: env.subscriptionCurrency }, { billingInterval: 'yearly', amountMinor: item.yearly, currency: env.subscriptionCurrency }], entitlements: INITIAL_PLAN_ENTITLEMENTS[item.code], metadata: { seeded: true, commercialPolicy: 'development_default' }, publishedAt: new Date() });
      action = 'created_version_1';
    }
    report.push({ plan: item.code, version: version.version, action });
  }
  return { dryRun: false, report };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) { console.info(JSON.stringify(await seed(options), null, 2)); return; }
  await connectDatabase();
  console.info(JSON.stringify(await seed(options), null, 2));
}

run().catch((error) => { console.error('Unable to seed subscription plans:', error.message); process.exitCode = 1; }).finally(async () => { if (env.mongodbUri) await disconnectDatabase().catch(() => undefined); });

module.exports = { plans, parseArgs, seed };
