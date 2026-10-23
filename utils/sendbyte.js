const axios = require("axios");

// SendByte REST API — POST /v1/emails, Bearer auth, 202 => { id }.
// Errors come back as { error: { code, message, docs_url } }.
const SENDBYTE_BASE_URL = "https://api.sendbyte.africa";

class EmailDeliveryError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "EmailDeliveryError";
    this.status = status;
    this.code = code;
  }
}

function isEmailConfigured() {
  return Boolean(process.env.SENDBYTE_API_KEY && process.env.SENDBYTE_FROM);
}

/**
 * Sends one email through SendByte. Resolves with the SendByte email id.
 * Throws EmailDeliveryError carrying only safe diagnostics (status + code);
 * the API key and message content are never attached to the error.
 */
async function sendEmail({ to, subject, html, text, tags, idempotencyKey }) {
  if (!isEmailConfigured()) {
    throw new EmailDeliveryError("Email service is not configured", {
      code: "not_configured",
    });
  }

  try {
    const response = await axios.post(
      `${SENDBYTE_BASE_URL}/v1/emails`,
      {
        from: process.env.SENDBYTE_FROM,
        to,
        subject,
        html,
        text,
        tags,
        idempotency_key: idempotencyKey,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.SENDBYTE_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    return response.data?.id;
  } catch (error) {
    const status = error.response?.status;
    const code = error.response?.data?.error?.code || error.code || "unknown";

    throw new EmailDeliveryError("Email delivery failed", { status, code });
  }
}

module.exports = { sendEmail, isEmailConfigured, EmailDeliveryError };
