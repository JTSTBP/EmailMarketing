import "dotenv/config";
export const config = {
  mode: process.env.APP_MODE || "mock",
  localMicrosoftTest: process.env.LOCAL_MICROSOFT_TEST === "true",
  port: Number(process.env.PORT || 4100),
  origin: process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  mongo:
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/jt_outreach?replicaSet=rs0",
  liveSending: process.env.ENABLE_LIVE_SENDING === "true",
  threadingVerified: process.env.GRAPH_THREADING_VERIFIED === "true",
  aiProvider: process.env.AI_PROVIDER || "mock",
  aiModel: process.env.GEMINI_MODEL || "",
  aiKey: process.env.GEMINI_API_KEY || "",
  inputPrice: process.env.AI_INPUT_USD_PER_MILLION,
  outputPrice: process.env.AI_OUTPUT_USD_PER_MILLION,
  crmUrl: process.env.CRM_BASE_URL || "",
  crmSecret: process.env.CRM_INTEGRATION_SECRET || "",
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  tenant: process.env.MS_TENANT_ID || "",
  clientId: process.env.MS_CLIENT_ID || "",
  clientSecret: process.env.MS_CLIENT_SECRET || "",
  redirectUri:
    process.env.MS_REDIRECT_URI || "http://localhost:4100/api/oauth/callback",
  webhookUrl: process.env.MS_WEBHOOK_URL || "",
};
export function validateConfig() {
  if (config.localMicrosoftTest && (config.mode !== "mock" || config.liveSending || !["http://localhost:5173", "http://127.0.0.1:5173"].includes(config.origin) || config.redirectUri !== "http://localhost:4100/api/oauth/callback" || Buffer.from(config.encryptionKey, "base64").length !== 32))
    throw new Error("Local Microsoft test requires local mock mode, disabled sending and a token encryption key");
  if (!["mock", "live"].includes(config.mode))
    throw new Error("APP_MODE must be mock or live");
  if (
    config.mode === "live" &&
    (!config.crmUrl.startsWith("https://") ||
      config.crmSecret.length < 32 ||
      Buffer.from(config.encryptionKey, "base64").length !== 32 ||
      !config.origin.startsWith("https://"))
  )
    throw new Error(
      "Live mode requires HTTPS origins, CRM integration secret and a 32-byte encryption key",
    );
  if (config.mode === "mock" && config.liveSending)
    throw new Error("Mock mode cannot enable live sending");
}
