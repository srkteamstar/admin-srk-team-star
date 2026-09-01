/*
 * core/notifications/email-client.js — the one HTTP call that sends an email
 * ============================================================================
 *
 * TRANSPORT ONLY, same split as whatsapp-client.js: given a recipient, a
 * subject and an HTML body, this calls the configured provider and reports
 * whether it went out. It knows nothing about orders.
 *
 * Provider: Resend (resend.com) — a bare HTTP API and a free tier that sends
 * from onboarding@resend.dev with no domain verification, so a fresh
 * deployment can send its first real email before anyone has touched DNS.
 * Move `NOTIFICATIONS_FROM_EMAIL` to a verified address on your own domain
 * once SPF/DKIM are set up; deliverability to inboxes rather than spam
 * folders depends on that, not on this file. Swapping providers entirely
 * (SES, SendGrid, Postmark) means rewriting only this file.
 *
 * Unconfigured (no API key yet) is not an error, for the same reason it isn't
 * in whatsapp-client.js: every environment starts this way.
 */
const RESEND_API_URL = 'https://api.resend.com/emails';

function emailConfigured() {
    return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATIONS_FROM_EMAIL);
}

/**
 * @param {{ to: string, subject: string, html: string }} message
 */
async function sendEmail({ to, subject, html }) {
    if (!emailConfigured()) {
        return { sent: false, skipped: true, reason: 'RESEND_API_KEY / NOTIFICATIONS_FROM_EMAIL is not set.' };
    }
    if (!to) {
        return { sent: false, skipped: true, reason: 'No email address on this order.' };
    }

    const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from: process.env.NOTIFICATIONS_FROM_EMAIL, to, subject, html })
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Resend responded ${response.status}: ${body.slice(0, 300)}`);
    }

    return { sent: true, skipped: false };
}

module.exports = { sendEmail, emailConfigured };
