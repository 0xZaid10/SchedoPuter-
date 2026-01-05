import express from "express";
import { v4 as uuidv4 } from "uuid";

const app = express();

/* ================= SAFE RAW BODY CAPTURE ================= */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf?.toString() || "";
    }
  })
);

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://schedoputer.onrender.com";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const FEE_PAYER = PAY_TO;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* ================= STATE ================= */
const jobs = new Map();
let LAST_DEBUG = null;

function debug(label, data) {
  const payload = {
    time: new Date().toISOString(),
    label,
    data
  };
  console.log("🪵 DEBUG:", JSON.stringify(payload, null, 2));
  LAST_DEBUG = payload;
}

/* ================= DEBUG INSPECT ================= */
app.get("/debug/last", (_req, res) => {
  res.json(LAST_DEBUG || { message: "No debug data yet" });
});

/* ================= DOMAIN VERIFICATION ================= */
app.get("/.well-known/x402-verification.json", (_req, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* ================= 402 RESPONSE ================= */
function send402(req, res) {
  debug("SEND_402", {
    headers: req.headers,
    rawBody: req.rawBody
  });

  return res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        maxAmountRequired: "10000",
        asset: USDC_MINT,
        payTo: PAY_TO,
        resource: `${BASE_URL}/x402/solana/schedoputer`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        description:
          "Schedoputer orchestrates scheduled AI + human workflows with per-task modify/undo control.",
        outputSchema: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            bodyFields: {
              prompt: { type: "string", required: true },
              schedule_hhmm: { type: "string", required: true }
            }
          },
          output: {
            success: { type: "boolean" },
            jobId: { type: "string" },
            scheduledFor: { type: "string" },
            statusUrl: { type: "string" }
          }
        },
        extra: {
          feePayer: FEE_PAYER
        }
      }
    ]
  });
}

/* ================= DISCOVERY ================= */
app.get("/x402/solana/schedoputer", (req, res) => {
  debug("DISCOVERY", req.headers);
  return send402(req, res);
});

/* ================= PAID INVOCATION ================= */
app.post("/x402/solana/schedoputer", (req, res) => {
  debug("POST_INVOKE", {
    headers: req.headers,
    body: req.body,
    rawBody: req.rawBody
  });

  // REQUIRED: x402 payment header
  if (!req.headers["x-payment"]) {
    debug("NO_PAYMENT_HEADER", req.headers);
    return send402(req, res);
  }

  const { prompt, schedule_hhmm } = req.body || {};

  if (!prompt || !schedule_hhmm) {
    debug("MISSING_FIELDS", req.body);
    return res.status(400).json({
      error: "prompt and schedule_hhmm required"
    });
  }

  const [hh, mm] = schedule_hhmm.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) {
    return res.status(400).json({ error: "Invalid schedule_hhmm" });
  }

  const scheduledFor = new Date(
    Date.now() + (hh * 60 + mm) * 60 * 1000
  );

  const jobId = uuidv4();

  jobs.set(jobId, {
    jobId,
    prompt,
    scheduledFor,
    state: "scheduled"
  });

  const response = {
    success: true,
    jobId,
    scheduledFor: scheduledFor.toISOString(),
    statusUrl: `${BASE_URL}/x402/solana/schedoputer/status/${jobId}`
  };

  debug("SUCCESS_RESPONSE", response);
  res.json(response);
});

/* ================= STATUS ================= */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  debug("STATUS_CHECK", job);

  if (!job) {
    return res.json({ state: "failed", error: "Job not found" });
  }

  res.json({
    state: job.state,
    jobId: job.jobId,
    scheduledFor: job.scheduledFor
  });
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("🚀 Schedoputer backend LIVE & STREAM-SAFE");
});
