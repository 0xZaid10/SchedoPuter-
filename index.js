import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";

const app = express();

/* =====================================================
   1. MIDDLEWARE & SECURITY
===================================================== */

// Explicitly allow x402 headers so the runner doesn't get blocked by CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x402-resource", "Authorization", "x-payment", "x-payment-signature"],
  exposedHeaders: ["x402-resource"]
}));

app.use(express.json());

// Request Logger to help you see Step 2 incoming data in Render Logs
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* =====================================================
   2. CONFIGURATION & STATE
===================================================== */
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://schedoputer.onrender.com";
const WALLET = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Global job store
const jobs = new Map();

/* =====================================================
   3. x402 HANDSHAKE LOGIC
===================================================== */

/**
 * Discovery Route: Tells the runner what to pay.
 */
app.get("/x402/solana/schedoputer", (req, res) => {
  const resourceUrl = `${BASE_URL}/x402/solana/schedoputer`;
  res.set("x402-resource", resourceUrl);

  return res.status(402).json({
    x402Version: 1,
    accepts: [{
      scheme: "exact",
      network: "solana",
      asset: USDC_MINT,
      maxAmountRequired: "10000", // $0.01 USDC
      payTo: WALLET,
      resource: resourceUrl,
      mimeType: "application/json",
      description: "Schedoputer – AI + Human Workflows",
      extra: {
        pricing: { amount: 0.01, currency: "USDC", network: "Solana" },
        feePayer: WALLET,     // Fixes Step 1 "missing feePayer"
        facilitator: WALLET
      }
    }]
  });
});

/**
 * Payment Middleware: Validates that Step 2 actually contains a payment.
 */
function requirePayment(req, res, next) {
  const payment = req.headers["authorization"] || req.headers["x-payment"] || req.headers["x-payment-signature"];
  
  if (!payment) {
    console.log("❌ Payment header missing. Re-sending 402.");
    res.set("x402-resource", `${BASE_URL}/x402/solana/schedoputer`);
    return res.status(402).json({
      error: "Payment required",
      x402Version: 1,
      accepts: [{
          scheme: "exact",
          network: "solana",
          asset: USDC_MINT,
          maxAmountRequired: "10000",
          payTo: WALLET,
          resource: `${BASE_URL}/x402/solana/schedoputer`,
          extra: { feePayer: WALLET }
      }]
    });
  }
  next();
}

/* =====================================================
   4. JOB EXECUTION ROUTES
===================================================== */

app.post("/x402/solana/schedoputer", requirePayment, (req, res) => {
  try {
    const { prompt, schedule_hhmm } = req.body;

    if (!prompt || !schedule_hhmm) {
      return res.status(400).json({ error: "prompt and schedule_hhmm are required" });
    }

    // Parse the time delay (e.g., "00:05" means in 5 minutes)
    const [hh, mm] = schedule_hhmm.split(":").map(Number);
    const scheduledFor = new Date(Date.now() + (hh * 60 + mm) * 60 * 1000);
    const jobId = uuidv4();

    const newJob = {
      jobId,
      prompt,
      scheduledFor,
      state: "scheduled",
      tasks: [
        { id: "T1", name: "research", status: "pending" },
        { id: "T2", name: "tweet", status: "blocked", dependsOn: "T1" },
        { id: "T3", name: "post", status: "blocked", dependsOn: "T2" },
        { id: "T4", name: "likes", status: "blocked", undoable: true, dependsOn: "T3" }
      ]
    };

    jobs.set(jobId, newJob);

    return res.json({
      success: true,
      jobId,
      scheduledFor: scheduledFor.toISOString(),
      statusUrl: `${BASE_URL}/x402/solana/schedoputer/status/${jobId}`
    });

  } catch (err) {
    console.error("CRITICAL ERROR IN POST:", err);
    // Returning JSON instead of letting Express send a text error
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json({ state: job.state, tasks: job.tasks });
});

/* =====================================================
   5. BACKGROUND SCHEDULER
===================================================== */
setInterval(() => {
  const now = new Date();
  for (const job of jobs.values()) {
    if (job.state === "scheduled" && now >= job.scheduledFor) {
      job.state = "running";
      console.log(`🚀 Job ${job.jobId} is now RUNNING`);
    }
  }
}, 10000);

/* =====================================================
   6. GLOBAL ERROR HANDLER (Prevents "Token M" Errors)
===================================================== */
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({
    error: "Server Crash",
    message: err.message
  });
});

app.listen(PORT, () => console.log(`🚀 Schedoputer fully loaded`));
