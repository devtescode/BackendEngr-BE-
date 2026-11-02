const sendbyte = require("./sendbyte");
const { sendGmail, isGmailConfigured } = require("./gmail");
const { sendBrevo, isBrevoConfigured } = require("./brevo");
const { isProduction } = require("./frontendUrl");

// EMAIL_PROVIDER picks the preferred provider: "gmail", "sendbyte" or "brevo".
// Missing/mismatched configuration no longer disables email: we use whichever
// provider actually has credentials, and fall back to another configured
// provider if the first attempt fails.
const VALID_PROVIDERS = ["gmail", "sendbyte", "brevo"];

const providers = {
  gmail: { ready: isGmailConfigured, send: sendGmail },
  sendbyte: { ready: sendbyte.isEmailConfigured, send: sendbyte.sendEmail },
  brevo: { ready: isBrevoConfigured, send: sendBrevo },
};

function requestedProvider() {
  const value = (process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  return VALID_PROVIDERS.includes(value) ? value : "";
}

function readyProviders() {
  return VALID_PROVIDERS.filter((provider) => providers[provider].ready());
}

// Order in which providers are attempted. On production hosts (Render) free
// instances cannot reach SMTP ports, so HTTP providers are tried before Gmail.
function providerOrder() {
  const requested = requestedProvider();
  const ready = readyProviders();

  if (ready.length === 0) return requested ? [requested] : ["sendbyte"];

  const http = ready.filter((provider) => provider !== "gmail");
  const smtp = ready.filter((provider) => provider === "gmail");

  if (isProduction() && http.length) {
    const orderedHttp =
      requested && http.includes(requested)
        ? [requested, ...http.filter((provider) => provider !== requested)]
        : http;

    return [...orderedHttp, ...smtp];
  }

  if (requested && ready.includes(requested)) {
    return [requested, ...ready.filter((provider) => provider !== requested)];
  }

  return ready;
}

function getEmailProvider() {
  return providerOrder()[0];
}

function isEmailConfigured() {
  return readyProviders().length > 0;
}

async function sendEmail(message) {
  const order = providerOrder();
  let lastError;

  for (const provider of order) {
    try {
      return await providers[provider].send(message);
    } catch (error) {
      lastError = error;

      // Keep diagnostics secret-free: provider errors only carry status/code
      // and a sanitized message. Never log the token or the email body.
      console.error("Email provider failed:", {
        provider,
        status: error?.status,
        code: error?.code,
        details: error?.details,
      });

      if (order.length > 1) {
        console.error(`Trying next configured email provider after ${provider}`);
      }
    }
  }

  throw lastError || new Error("No email provider is configured");
}

// Safe, secret-free view of the current email setup for diagnostics.
function getEmailStatus() {
  return {
    provider: getEmailProvider(),
    configured: isEmailConfigured(),
    requestedProvider: requestedProvider() || "auto",
    providers: readyProviders(),
    gmailConfigured: isGmailConfigured(),
    sendbyteConfigured: sendbyte.isEmailConfigured(),
    brevoConfigured: isBrevoConfigured(),
  };
}

module.exports = {
  sendEmail,
  isEmailConfigured,
  getEmailProvider,
  getEmailStatus,
};
