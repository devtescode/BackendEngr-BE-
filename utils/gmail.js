const nodemailer = require("nodemailer");
const { EmailDeliveryError } = require("./sendbyte");

// Gmail SMTP — needs a Google App Password, not the account password.
// Gmail always sends from the signed-in account, so GMAIL_USER is the sender.
let transporter;

function isGmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        // Google shows App Passwords with spaces; SMTP expects them without.
        pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ""),
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  return transporter;
}

/**
 * Sends one email through Gmail. Resolves with the SMTP message id.
 * Throws EmailDeliveryError carrying only safe diagnostics (status + code).
 */
async function sendGmail({ to, subject, html, text }) {
  if (!isGmailConfigured()) {
    throw new EmailDeliveryError("Email service is not configured", {
      code: "not_configured",
    });
  }

  try {
    const info = await getTransporter().sendMail({
      from: `"EU Hardwarestore" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
      text,
    });

    return info.messageId;
  } catch (error) {
    throw new EmailDeliveryError("Email delivery failed", {
      status: error.responseCode,
      code: error.code || "unknown",
    });
  }
}

module.exports = { sendGmail, isGmailConfigured };
