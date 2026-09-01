/*
 * modules/orders/services/order-notifications.service.js — telling a customer
 * ============================================================================
 *
 * WHATSAPP FIRST, EMAIL AS THE FALLBACK — for two separate reasons, not one:
 * a guest checkout may have no phone at all, and WhatsApp delivery can fail
 * (an unapproved template, an expired token) on an order that has one. Either
 * way the customer must still hear something if an email address exists, so
 * every event tries WhatsApp when there is a number and falls through to
 * email whenever WhatsApp did not actually send — not only when there is no
 * number to try.
 *
 * This file owns the CONTENT (what four events say, and to whom); core/
 * notifications/{whatsapp,email}-client.js own the TRANSPORT (how to say it).
 * Neither client ever throws for "not configured yet" — every environment
 * starts with no provider credentials — so this file never crashes an order
 * update over a notification. Every attempt, successful or not, is written to
 * order_notifications (migration 008) rather than left to be inferred.
 *
 * CALLED AND AWAITED, NOT FIRED-AND-FORGOTTEN. admin-orders.controller.js
 * awaits every one of these before answering the admin's request. On a
 * platform that can freeze a function the instant it responds (this app
 * deploys to Vercel — see AGENTS.md), a promise nobody awaited is a coin flip
 * on whether it ever ran to completion. The cost is a few hundred
 * milliseconds on an admin click, which is cheap next to a customer who was
 * silently never told their order shipped.
 *
 * WHATSAPP TEMPLATES MUST ALREADY EXIST AND BE APPROVED. The body text below
 * is not sent as free text — see whatsapp-client.js — it is the wording this
 * project's WHATSAPP_TEMPLATE_* templates must be registered with in Meta
 * Business Manager, in this exact placeholder order, before a send here can
 * succeed rather than 400.
 */
const { supabase } = require('../../../core/database/supabase');
const { sendWhatsAppTemplate } = require('../../../core/notifications/whatsapp-client');
const { sendEmail } = require('../../../core/notifications/email-client');
const { escapeHtmlText } = require('../../../shared/text');
const { errorTag } = require('../../../shared/error-tag');

// INDIA-ONLY NORMALIZATION, DELIBERATELY NARROW, AND NOT OPTIONAL.
//
// orders.buyer_phone is NOT a clean 10-digit value — confirmed against the
// storefront repo's checkout, which stores it exactly as the customer typed
// it (checkout.controller.js passes `buyer.phone` straight through, never
// the digits-only value it separately computes to validate length) and
// carries no format CHECK constraint at all. A real row can read
// "+91 90500 09442", "090500 09442", "9050009442", or worse. Every one of
// those has to resolve to the same WhatsApp-addressable number, or an
// order's own owner never hears about it.
//
// Mirrors the storefront's own identifier.js normalizePhone() rule (strip to
// digits, unwrap a leading 0 or a leading country code) rather than
// reinventing one, since that is the shape this project's phone numbers are
// already known to take. If this business ever ships outside India, this is
// the one place that has to learn a second rule — not a config value buried
// three files away.
function whatsappNumber(rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10) return `91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
    if (digits.length === 12 && digits.startsWith('91')) return digits;
    if (digits.length > 10) return digits; // some other country code, already dialable as-is
    return null; // too short to be a real number
}

function formatRupees(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return String(amount);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

// The one courier this business ships through today. Case 1 of the feature
// this file exists for was explicit: no per-order courier picker, because
// there is only ever one courier to name. `{trackingId}` is replaced with the
// AWB an admin enters; leave SHIPPING_TRACKING_URL_TEMPLATE unset and the
// message still names the tracking id, just without a clickable link.
function trackingUrl(trackingId) {
    const template = process.env.SHIPPING_TRACKING_URL_TEMPLATE;
    if (!template) return null;
    return template.replace('{trackingId}', encodeURIComponent(trackingId));
}

function courierName() {
    return process.env.SHIPPING_COURIER_NAME || 'our courier partner';
}

function emailShell(title, bodyHtml) {
    return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#12170f;">
        <h2 style="margin:0 0 16px;">${escapeHtmlText(title)}</h2>
        ${bodyHtml}
        <p style="margin-top:32px;font-size:12px;color:#1f271b99;">SRK Team Star</p>
    </div>`;
}

async function logNotification({ orderId, event, channel, recipient, status, error }) {
    try {
        await supabase.from('order_notifications').insert({
            order_id: orderId, event, channel, recipient: recipient || null, status,
            error: error ? String(error).slice(0, 2000) : null
        });
    } catch (logError) {
        // The log is diagnostic, not load-bearing. Losing a log row must never
        // be the reason an order update fails.
        console.error('Failed to record order notification:', errorTag(logError));
    }
}

// WhatsApp first (when there is a number), email whenever WhatsApp did not
// actually send — not only when there was no number. Every branch logs
// exactly once with the channel it actually used, or 'none' when nothing was
// reachable at all.
async function sendCustomerNotification({ order, event, whatsapp, email }) {
    const orderId = order.id;
    const phone = whatsappNumber(order.buyer_phone);
    const emailAddress = order.buyer_email || null;

    if (phone) {
        try {
            const result = await sendWhatsAppTemplate({ to: phone, ...whatsapp });
            if (result.sent) {
                await logNotification({ orderId, event, channel: 'whatsapp', recipient: phone, status: 'sent' });
                return;
            }
            // Skipped (not configured) falls through to email silently; that
            // is the expected state of every environment before setup.
        } catch (error) {
            console.error(`WhatsApp send failed for order ${orderId} (${event}):`, errorTag(error));
            await logNotification({ orderId, event, channel: 'whatsapp', recipient: phone, status: 'failed', error });
        }
    }

    if (emailAddress) {
        try {
            const result = await sendEmail({ to: emailAddress, ...email });
            if (result.sent) {
                await logNotification({ orderId, event, channel: 'email', recipient: emailAddress, status: 'sent' });
                return;
            }
            await logNotification({ orderId, event, channel: 'email', recipient: emailAddress, status: 'skipped', error: result.reason });
        } catch (error) {
            console.error(`Email send failed for order ${orderId} (${event}):`, errorTag(error));
            await logNotification({ orderId, event, channel: 'email', recipient: emailAddress, status: 'failed', error });
        }
        return;
    }

    await logNotification({ orderId, event, channel: 'none', recipient: null, status: 'skipped', error: 'Order has neither a phone number nor an email address.' });
}

async function notifyOrderConfirmed(order) {
    const name = order.buyer_name || 'there';
    const amount = formatRupees(order.net_amount);

    await sendCustomerNotification({
        order,
        event: 'confirmed',
        whatsapp: {
            templateName: process.env.WHATSAPP_TEMPLATE_CONFIRMED || 'order_confirmed',
            bodyParams: [name, order.order_number, amount]
        },
        email: {
            subject: `Your order #${order.order_number} is confirmed`,
            html: emailShell(`Order #${order.order_number} confirmed`, `
                <p>Hi ${escapeHtmlText(name)},</p>
                <p>Your order has been confirmed and is now being prepared. Total: <strong>${escapeHtmlText(amount)}</strong>.</p>
                <p>We'll email you again the moment it ships.</p>`)
        }
    });
}

async function notifyOrderShipped(order) {
    const name = order.buyer_name || 'there';
    const url = trackingUrl(order.tracking);

    await sendCustomerNotification({
        order,
        event: 'shipped',
        whatsapp: {
            templateName: process.env.WHATSAPP_TEMPLATE_SHIPPED || 'order_shipped',
            bodyParams: [name, order.order_number, courierName(), order.tracking, url || 'ask our support team for the tracking link']
        },
        email: {
            subject: `Your order #${order.order_number} has shipped`,
            html: emailShell(`Order #${order.order_number} shipped`, `
                <p>Hi ${escapeHtmlText(name)},</p>
                <p>Your order has shipped via <strong>${escapeHtmlText(courierName())}</strong>.</p>
                <p>Tracking ID: <strong>${escapeHtmlText(order.tracking)}</strong></p>
                ${url ? `<p><a href="${escapeHtmlText(url)}">Track your shipment</a></p>` : ''}`)
        }
    });
}

async function notifyOrderCancelled(order, reason) {
    const name = order.buyer_name || 'there';

    await sendCustomerNotification({
        order,
        event: 'cancelled',
        whatsapp: {
            templateName: process.env.WHATSAPP_TEMPLATE_CANCELLED || 'order_cancelled',
            bodyParams: [name, order.order_number, reason]
        },
        email: {
            subject: `Your order #${order.order_number} has been cancelled`,
            html: emailShell(`Order #${order.order_number} cancelled`, `
                <p>Hi ${escapeHtmlText(name)},</p>
                <p>Your order has been cancelled. Reason: <strong>${escapeHtmlText(reason)}</strong>.</p>
                <p>If you have questions, please contact our support team.</p>`)
        }
    });
}

async function notifyRefundCompleted(order, payment) {
    const name = order.buyer_name || 'there';
    const amount = formatRupees(payment ? payment.amount : order.net_amount);

    await sendCustomerNotification({
        order,
        event: 'refunded',
        whatsapp: {
            templateName: process.env.WHATSAPP_TEMPLATE_REFUNDED || 'refund_completed',
            bodyParams: [name, order.order_number, amount]
        },
        email: {
            subject: `Refund processed for order #${order.order_number}`,
            html: emailShell(`Refund processed`, `
                <p>Hi ${escapeHtmlText(name)},</p>
                <p>The refund for your cancelled order #${order.order_number} (<strong>${escapeHtmlText(amount)}</strong>) has been processed.</p>
                <p>It may take a few business days to reflect in your account.</p>`)
        }
    });
}

module.exports = { notifyOrderConfirmed, notifyOrderShipped, notifyOrderCancelled, notifyRefundCompleted };
