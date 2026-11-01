const { env } = require('../../config/env');

const TEMPLATE_DEFINITIONS = Object.freeze({
  email_verification_otp: { category: 'security', subject: 'Verify your SCOVRR email' },
  welcome: { category: 'security', subject: 'Welcome to SCOVRR' },
  password_reset: { category: 'security', subject: 'Reset your SCOVRR password' },
  password_changed: { category: 'security', subject: 'Your SCOVRR password was changed' },
  email_changed: { category: 'security', subject: 'Your SCOVRR email was changed' },
  security_alert: { category: 'security', subject: 'SCOVRR security alert' },
  seller_application_received: { category: 'seller', subject: 'Your SCOVRR seller application was received' },
  seller_activated: { category: 'seller', subject: 'Your SCOVRR seller account is ready' },
  business_verification_approved: { category: 'seller', subject: 'Your SCOVRR business was approved' },
  business_verification_rejected: { category: 'seller', subject: 'Action needed for your SCOVRR business verification' },
  payout_successful: { category: 'payout', subject: 'Your SCOVRR payout was successful' },
  payout_failed: { category: 'payout', subject: 'Your SCOVRR payout needs attention' },
  order_confirmation: { category: 'order', subject: 'Your SCOVRR order is confirmed' },
  order_shipped: { category: 'order', subject: 'Your SCOVRR order has shipped' },
  order_delivered: { category: 'order', subject: 'Your SCOVRR order was delivered' },
  order_cancelled: { category: 'order', subject: 'Your SCOVRR order was cancelled' },
  payment_receipt: { category: 'order', subject: 'Your SCOVRR payment receipt' },
  booking_confirmation: { category: 'booking', subject: 'Your SCOVRR booking is confirmed' },
  booking_reminder: { category: 'booking', subject: 'Reminder: your SCOVRR booking is coming up' },
  booking_cancelled: { category: 'booking', subject: 'Your SCOVRR booking was cancelled' },
  new_seller_review: { category: 'seller', subject: 'You received a new SCOVRR review' },
  platform_announcement: { category: 'marketing', subject: 'An update from SCOVRR' }
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function textValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function brandedLayout({ preheader, title, body, ctaLabel, ctaUrl }) {
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#7627d9;color:#fff;text-decoration:none;border-radius:999px;padding:13px 24px;font-weight:700">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  const publicUrl = env.emailPublicBaseUrl ? escapeHtml(env.emailPublicBaseUrl) : '';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>SCOVRR</title></head><body style="margin:0;background:#faf7ff;color:#171222;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader || title)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf7ff;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #eadcf8;border-radius:24px;overflow:hidden"><tr><td style="background:#180b2b;padding:28px 32px;color:#fff"><div style="font-size:25px;font-weight:800;letter-spacing:-.5px">SCOVRR</div><div style="font-size:12px;color:#d9bfff;margin-top:6px;letter-spacing:1.5px;text-transform:uppercase">Discover. Connect. Grow.</div></td></tr><tr><td style="padding:36px 32px 40px"><h1 style="font-size:25px;line-height:1.2;margin:0 0 16px">${escapeHtml(title)}</h1><div style="font-size:16px;line-height:1.65;color:#625a70">${body}</div>${cta}</td></tr><tr><td style="padding:20px 32px;background:#f4eaff;color:#746a82;font-size:12px;line-height:1.6">This is a transactional message from SCOVRR. Please do not reply to this email.${publicUrl ? ` <a href="${publicUrl}" style="color:#7627d9">Visit SCOVRR</a>.` : ''}</td></tr></table></td></tr></table></body></html>`;
}

function renderEmailTemplate(templateKey, data = {}) {
  const definition = TEMPLATE_DEFINITIONS[templateKey];
  if (!definition) throw new Error(`Unknown email template: ${templateKey}`);
  const firstName = escapeHtml(data.firstName || data.name || 'there');
  const details = escapeHtml(data.details || data.message || '');
  let title = definition.subject;
  let body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">${details || 'Here is an update from SCOVRR.'}</p>`;
  let ctaLabel = data.ctaLabel;
  let ctaUrl = data.ctaUrl;

  if (templateKey === 'email_verification_otp') {
    title = 'Verify your email address';
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0 0 20px">Use this six-digit code to finish creating your SCOVRR account:</p><div style="font-size:34px;letter-spacing:9px;font-weight:800;color:#7627d9;background:#f4eaff;border-radius:16px;padding:18px;text-align:center">${escapeHtml(data.otp)}</div><p style="margin:20px 0 0">This code expires in ${escapeHtml(data.expiresMinutes || 5)} minutes. If you did not request it, you can ignore this message.</p>`;
  } else if (templateKey === 'welcome') {
    title = 'Welcome to SCOVRR';
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">Your email is verified and your SCOVRR account is ready. Discover trusted products, services, and local businesses in one place.</p>`;
    ctaLabel = ctaLabel || 'Open SCOVRR';
    ctaUrl = ctaUrl || env.emailPublicBaseUrl;
  } else if (templateKey === 'password_reset') {
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">${details || 'Use the secure link below to choose a new password. This link expires soon.'}</p>`;
    ctaLabel = ctaLabel || 'Reset password';
    ctaUrl = ctaUrl || data.resetUrl;
  } else if (templateKey === 'seller_application_received') {
    title = 'Seller application received';
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">We received your business application${data.businessName ? ` for <strong>${escapeHtml(data.businessName)}</strong>` : ''}. We will notify you when the review is complete.</p>`;
  } else if (templateKey === 'business_verification_approved' || templateKey === 'seller_activated') {
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">${details || 'Your SCOVRR seller business has been approved. You can now manage your catalogue and serve customers.'}</p>`;
    ctaLabel = ctaLabel || 'Manage your business';
    ctaUrl = ctaUrl || env.emailPublicBaseUrl;
  } else if (templateKey === 'business_verification_rejected') {
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">${details || 'Your business verification needs an update. Please review the feedback and submit the requested information.'}</p>`;
  } else if (templateKey === 'platform_announcement') {
    title = escapeHtml(data.title || definition.subject);
    body = `<p style="margin:0 0 12px">Hello ${firstName},</p><p style="margin:0">${details || 'Here is an important update from SCOVRR.'}</p>`;
  }
  const plainBody = `SCOVRR\n\n${textValue(title)}\n\nHello ${textValue(data.firstName || data.name || 'there')},\n\n${textValue(data.otp ? `Your verification code is ${data.otp}. It expires in ${data.expiresMinutes || 5} minutes.` : (data.details || data.message || 'Here is an update from SCOVRR.'))}`;
  return { subject: definition.subject, category: definition.category, html: brandedLayout({ preheader: definition.subject, title, body, ctaLabel, ctaUrl }), text: plainBody };
}

module.exports = { TEMPLATE_DEFINITIONS, escapeHtml, renderEmailTemplate };
