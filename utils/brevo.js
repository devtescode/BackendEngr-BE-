const axios = require("axios");
const { EmailDeliveryError } = require("./sendbyte");

// Brevo (formerly Sendinblue) HTTP API — port 443, so it works on hosts that
// block outbound SMTP (e.g. Render's free tier).
//
// Setup: create a Brevo account, verify a sender email under
// "Senders & IPs", create an API key, then set BREVO_API_KEY (and optionally
// BREVO_FROM). A verified single sender email is enough; no domain purchase is
// required.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

class BrevoError extends EmailDeliveryError {
  constructor(message, { status, code, details } = {}) {
    super(message, { status, code, details });
    this.name = "BrevoError";
  }
}

function getSender() {
  // BREVO_FROM may be "Name <email@example.com>" or a bare address.
  const raw = (process.env.BREVO_FROM || process.env.GMAIL_USER || "").trim();
  const match = raw.match(/^(.*)<([^>]+)>$/);
  const email = (match ? match[2] : raw).trim();
  const name = (match ? match[1] : "").trim().replace(/^["']|["']$/g, "");

  return {
    name: name || "EU Hardwarestore",
    email,
  };
}

function isBrevoConfigured() {
  return Boolean(process.env.BREVO_API_KEY && getSender().email);
}

async function sendBrevo({ to, subject, html, text, tags, idempotencyKey }) {
  if (!isBrevoConfigured()) {
    throw new BrevoError("Email service is not configured", { code: "not_configured" });
  }

  try {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: getSender(),
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        tags,
        headers: idempotencyKey ? { "X-Mailin-custom": idempotencyKey } : undefined,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 10000,
      }
    );

    return response.data?.messageId;
  } catch (error) {
    const status = error.response?.status;
    const code = error.response?.data?.code || error.code || "unknown";
    const details = error.response?.data?.message || error.message;

    throw new BrevoError("Email delivery failed", { status, code, details });
  }
}

module.exports = { sendBrevo, isBrevoConfigured, BrevoError };
