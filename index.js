import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors"; // Essential for browser-based runners

const app = express();

// 1. FIXED: Enable CORS so x402.jobs can read your discovery JSON
app.use(cors({
  origin: "*",
  exposedHeaders: ["x402-resource"]
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */
const BASE_URL = "https://schedoputer.onrender.com";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const jobs = new Map();

/* ================= DOMAIN VERIFICATION ================= */
app.get("/.well-known/x402-verification.json", (_req, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* ================= x402 DISCOVERY ================= */
app.get("/x402/solana/schedoputer", (_req, res) => {
  const resourceUrl = `${BASE_URL}/x402/solana/schedoputer`;

  // 2. FIXED: Step 1 requires this header to be present
  res.set("x402-resource", resourceUrl);

  res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        asset: USDC_MINT,
        maxAmountRequired: "10000", // $0.01 USDC
        payTo: PAY_TO,
        resource: resourceUrl,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        description: "Schedoputer – scheduled AI + human workflows",
        extra: {
          pricing: {
            amount: 0.01,
            currency: "USDC",
            network: "Solana",
            unit: "per-run"
          },
          serviceName: "Schedoputer",
          category: "Workflow",
          version: "1.0"
        }
      }
    ]
  });
});

/* ================= PAYMENT GATE ================= */
function requirePayment(req, res, next) {
  const payment = req.headers["authorization"] || req.headers["x-payment"];
  // If no payment is found in the headers, trigger the 402 flow
  if (!payment) {
    res.set("x402-resource", `${BASE_URL}/x402/solana/schedoputer`);
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required"
    });
  }
  next();
}

/* ================= PAID INVOCATION ================= */
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

/* ================= STATUS / MODIFY / UNDO ================= */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.json({ state: "failed", error: "Job not found" });
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

/* ================= SCHEDULER ================= */
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

app.listen(PORT, () => {
  console.log("🚀 Schedoputer backend live (HEADER FIXED)");
});
