const axios = require("axios");

// Brevo (formerly Sendinblue) HTTP API — port 443, so it works on hosts that
// block outbound SMTP (e.g. Render's free tier).
//
// Setup: verify a sender email under "Senders & IPs" in Brevo, create an API
// key, then set BREVO_API_KEY. That is the only variable required.
// BREVO_FROM is optional and defaults to the verified sender below.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_FROM = "EU Hardwarestore <datasub09@gmail.com>";

class EmailDeliveryError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "EmailDeliveryError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseSender(raw) {
  const value = (raw || "").trim();
  const match = value.match(/^(.*)<([^>]+)>$/);
  const email = (match ? match[2] : value).trim();
  const name = (match ? match[1] : "").trim().replace(/^["']|["']$/g, "");

  return {
    name: name || "EU Hardwarestore",
    email: email || parseSender(DEFAULT_FROM).email,
  };
}

function getSender() {
  return parseSender(process.env.BREVO_FROM || DEFAULT_FROM);
}

function isBrevoConfigured() {
  return Boolean((process.env.BREVO_API_KEY || "").trim());
}

async function sendBrevo({ to, subject, html, text, tags }) {
  const apiKey = (process.env.BREVO_API_KEY || "").trim();

  if (!apiKey) {
    throw new EmailDeliveryError("Email service is not configured", {
      code: "not_configured",
    });
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
      },
      {
        headers: {
          "api-key": apiKey,
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

    throw new EmailDeliveryError("Email delivery failed", { status, code, details });
  }
}

module.exports = {
  sendBrevo,
  isBrevoConfigured,
  getSender,
  EmailDeliveryError,
  DEFAULT_FROM,
};
