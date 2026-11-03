const { sendBrevo, isBrevoConfigured, getSender } = require("./brevo");

// Brevo is the only email provider. It sends over HTTPS, so it works on hosts
// that block outbound SMTP (Render's free tier) and needs no domain purchase —
// only a verified sender email and BREVO_API_KEY.
function isEmailConfigured() {
  return isBrevoConfigured();
}

function sendEmail(message) {
  return sendBrevo(message);
}

function getEmailProvider() {
  return "brevo";
}

// Safe, secret-free view of the email setup for diagnostics.
function getEmailStatus() {
  const configured = isEmailConfigured();

  return {
    provider: "brevo",
    configured,
    requestedProvider: "brevo",
    providers: configured ? ["brevo"] : [],
    brevoConfigured: configured,
    sender: getSender().email,
  };
}

module.exports = { sendEmail, isEmailConfigured, getEmailProvider, getEmailStatus };
