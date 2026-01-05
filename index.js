import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";

const app = express();

/* =====================================================
   MIDDLEWARE & SECURITY FIXES
===================================================== */

// 1. Permissive CORS to fix "Blocked by Response" and "Fill in fields" errors
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x402-resource", "Authorization", "x-payment", "x-payment-signature"],
  exposedHeaders: ["x402-resource"]
}));

// 2. Security Header Bypass for ERR_BLOCKED_BY_RESPONSE.NotSameOrigin
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});

app.use(express.json());

// 3. DEBUG LOGGER: Check your Render "Logs" tab to see these!
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === "POST" || req.method === "PATCH") {
    console.log("Body:", JSON.stringify(req.body));
  }
  next();
});

const PORT = process.env.PORT || 3000;

/* =====================================================
   CONFIG
===================================================== */
const BASE_URL = "https://schedoputer.onrender.com";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7Es (REPLACE WITH YOUR FULL KEY)"; 
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* =====================================================
   STATE
===================================================== */
const jobs = new Map();

/* =====================================================
   x402 HANDSHAKE (STEP 1 & 2)
===================================================== */

// DISCOVERY ROUTE
app.get("/x402/solana/schedoputer", (req, res) => {
  const resourceUrl = `${BASE_URL}/x402/solana/schedoputer`;
  res.set("x402-resource", resourceUrl);

  const discovery = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        asset: USDC_MINT,
        maxAmountRequired: "10000", // $0.01 USDC
        payTo: "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U",
        resource: resourceUrl,
        mimeType: "application/json",
        description: "Schedoputer – AI + human workflows",
        extra: {
          pricing: { amount: 0.01, currency: "USDC", network: "Solana" },
          serviceName: "Schedoputer"
        }
      }
    ]
  };

  console.log("➡️ Sending Discovery (402)");
  res.status(402).json(discovery);
});

// PAYMENT GATEWAY MIDDLEWARE
function requirePayment(req, res, next) {
  const payment = req.headers["authorization"] || req.headers["x-payment"] || req.headers["x-payment-signature"];
  
  if (!payment) {
    console.log("❌ No payment header. Re-triggering Discovery.");
    res.set("x402-resource", `${BASE_URL}/x402/solana/schedoputer`);
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required",
      accepts: [{
          scheme: "exact",
          network: "solana",
          asset: USDC_MINT,
          maxAmountRequired: "10000",
          payTo: "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U",
          resource: `${BASE_URL}/x402/solana/schedoputer`
      }]
    });
  }
  console.log("✅ Payment header received!");
  next();
}

/* =====================================================
   PAID INVOCATION (CREATE JOB)
===================================================== */
app.post("/x402/solana/schedoputer", requirePayment, (req, res) => {
  const { prompt, schedule_hhmm } = req.body;

  if (!prompt || !schedule_hhmm) {
    return res.status(400).json({ error: "prompt and schedule_hhmm required" });
  }

  const [hh, mm] = schedule_hhmm.split(":").map(Number);
  const scheduledFor = new Date(Date.now() + (hh * 60 + mm) * 60 * 1000);
  const jobId = uuidv4();

  jobs.set(jobId, {
    jobId,
    prompt,
    scheduledFor,
    state: "scheduled",
    tasks: [
      { id: "T1", name: "research", status: "pending" },
      { id: "T2", name: "tweet", status: "blocked", dependsOn: "T1" },
      { id: "T3", name: "post", status: "blocked", dependsOn: "T2" },
      { id: "T4", name: "likes", status: "blocked", undoable: true, dependsOn: "T3" },
      { id: "T5", name: "reposts", status: "blocked", undoable: true, dependsOn: "T3" },
      { id: "T6", name: "comments", status: "blocked", undoable: true, dependsOn: "T3" }
    ]
  });

  res.json({
    success: true,
    jobId,
    scheduledFor: scheduledFor.toISOString(),
    statusUrl: `${BASE_URL}/x402/solana/schedoputer/status/${jobId}`
  });
});

/* =====================================================
   STATUS, MODIFY & UNDO
===================================================== */

app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ state: "failed", error: "Job not found" });
  res.json({ state: job.state, tasks: job.tasks });
});

app.patch("/x402/solana/schedoputer/:jobId/task/:taskId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);
  if (!task || task.status !== "pending") return res.status(400).json({ error: "Cannot modify" });
  
  task.params = { ...task.params, ...req.body };
  res.json({ success: true });
});

app.post("/x402/solana/schedoputer/:jobId/task/:taskId/undo", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);
  if (!task || !task.undoable || task.status !== "pending") return res.status(400).json({ error: "Cannot undo" });
  
  task.status = "cancelled";
  res.json({ success: true });
});

/* =====================================================
   SCHEDULER LOOP
===================================================== */
setInterval(() => {
  const now = new Date();
  for (const job of jobs.values()) {
    if (job.state === "scheduled" && now >= job.scheduledFor) job.state = "running";
    if (job.state !== "running") continue;

    for (const task of job.tasks) {
      if (task.status === "blocked") {
        const dep = job.tasks.find(t => t.id === task.dependsOn);
        if (dep && dep.status === "completed") task.status = "pending";
      }
    }
    if (job.tasks.every(t => ["completed", "cancelled"].includes(t.status))) job.state = "completed";
  }
}, 30000);

/* =====================================================
   START
===================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Schedoputer live at ${BASE_URL}`);
});
