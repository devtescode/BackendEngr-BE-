const sendbyte = require("./sendbyte");
const { sendGmail, isGmailConfigured } = require("./gmail");

// EMAIL_PROVIDER picks who delivers email: "gmail" or "sendbyte". The default
// used to be sendbyte, which meant a deployment that only had Gmail
// credentials (or vice versa) reported "email is not configured" and every
// verification/reset email failed. We now honour the requested provider when
// it is actually configured and otherwise fall back to the provider that is.
const VALID_PROVIDERS = ["gmail", "sendbyte"];

function requestedProvider() {
  const value = (process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  return VALID_PROVIDERS.includes(value) ? value : "";
}

function providerReady(provider) {
  return provider === "gmail" ? isGmailConfigured() : sendbyte.isEmailConfigured();
}

function getEmailProvider() {
  const requested = requestedProvider();

  // Prefer the explicitly requested provider, but never fail just because the
  // other one is the one with working credentials.
  if (requested && providerReady(requested)) return requested;
  if (isGmailConfigured()) return "gmail";
  if (sendbyte.isEmailConfigured()) return "sendbyte";

  // Nothing is configured; return the requested provider so the error carries
  // a useful name (callers check isEmailConfigured() first anyway).
  return requested || "sendbyte";
}

function isEmailConfigured() {
  return isGmailConfigured() || sendbyte.isEmailConfigured();
}

function sendEmail(message) {
  return getEmailProvider() === "gmail"
    ? sendGmail(message)
    : sendbyte.sendEmail(message);
}

// Safe, secret-free view of the current email setup for diagnostics.
function getEmailStatus() {
  return {
    provider: getEmailProvider(),
    configured: isEmailConfigured(),
    requestedProvider: requestedProvider() || "auto",
    gmailConfigured: isGmailConfigured(),
    sendbyteConfigured: sendbyte.isEmailConfigured(),
  };
}

module.exports = { sendEmail, isEmailConfigured, getEmailProvider, getEmailStatus };
