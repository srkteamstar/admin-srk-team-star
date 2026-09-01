/*
 * core/notifications/whatsapp-client.js — the one HTTP call that sends a WhatsApp message
 * ============================================================================
 *
 * TRANSPORT ONLY. This file knows an access token and a phone number id; it
 * does not know an order exists. What to say and to whom is assembled by
 * modules/orders/services/order-notifications.service.js and handed in —
 * that split is what lets a future notification (a quote, a project update)
 * reuse this file without it learning a second domain.
 *
 * Talks to Meta's WhatsApp Cloud API directly — one long-lived access token,
 * one phone number id, no BSP in between. Swapping to a BSP (Gupshup, Twilio,
 * AiSensy) later means rewriting only this file.
 *
 * THE ONE THING THIS FILE CANNOT DO FOR YOU: business-INITIATED messages
 * (every notification here — the customer did not just message the store)
 * are only deliverable through a message template Meta has approved in
 * advance. A freeform string in `bodyParams` does not make this a freeform
 * message; it fills the numbered placeholders ({{1}}, {{2}}, ...) of whatever
 * template `templateName` names, in order, and the template itself — its
 * wording, its placeholder count — must already exist and be APPROVED in
 * Meta Business Manager (WhatsApp Manager -> Message Templates) before a call
 * here can succeed. Get the parameter count wrong against what was approved
 * and Meta answers 400, not silence.
 *
 * Unconfigured (no access token yet) is not an error — it is the state of
 * every environment before somebody finishes WhatsApp Business verification —
 * so callers get back a `skipped` result rather than a thrown exception.
 */
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

function whatsappConfigured() {
    return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * @param {{ to: string, templateName: string, languageCode?: string, bodyParams?: (string|number)[] }} message
 */
async function sendWhatsAppTemplate({ to, templateName, languageCode = 'en', bodyParams = [] }) {
    if (!whatsappConfigured()) {
        return { sent: false, skipped: true, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID is not set.' };
    }
    if (!to) {
        return { sent: false, skipped: true, reason: 'No phone number on this order.' };
    }

    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: templateName,
                language: { code: languageCode },
                components: bodyParams.length
                    ? [{ type: 'body', parameters: bodyParams.map(text => ({ type: 'text', text: String(text) })) }]
                    : []
            }
        })
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`WhatsApp API responded ${response.status}: ${body.slice(0, 300)}`);
    }

    return { sent: true, skipped: false };
}

module.exports = { sendWhatsAppTemplate, whatsappConfigured };
