const sendbyte = require("./sendbyte");
const { sendGmail, isGmailConfigured } = require("./gmail");

// EMAIL_PROVIDER picks who delivers email: "sendbyte" (default) or "gmail".
const useGmail = () =>
  (process.env.EMAIL_PROVIDER || "sendbyte").trim().toLowerCase() === "gmail";

function isEmailConfigured() {
  return useGmail() ? isGmailConfigured() : sendbyte.isEmailConfigured();
}

function sendEmail(message) {
  return useGmail() ? sendGmail(message) : sendbyte.sendEmail(message);
}

module.exports = { sendEmail, isEmailConfigured };
