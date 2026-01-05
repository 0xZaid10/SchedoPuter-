import express from "express";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =====================================================
   CONFIG
===================================================== */
const BASE_URL = "https://schedoputer.onrender.com";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* =====================================================
   STATE (hackathon-safe)
===================================================== */
const jobs = new Map();

/* =====================================================
   DOMAIN VERIFICATION
===================================================== */
app.get("/.well-known/x402-verification.json", (_req, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* =====================================================
   x402 DISCOVERY (ALWAYS 402)
===================================================== */
app.get("/x402/solana/schedoputer", (_req, res) => {
  res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        maxAmountRequired: "10000",
        payTo: "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U",
        resource: "https://schedoputer.onrender.com/x402/solana/schedoputer",
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        description: "Schedoputer – scheduled AI + human workflows"
      }
    ]
  });
});


/* =====================================================
   🔑 PAYMENT GATE (CRITICAL)
===================================================== */
function requirePayment(req, res, next) {
  const payment =
    req.headers["authorization"] ||
    req.headers["x-payment"];

  if (!payment) {
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required"
    });
  }

  // x402.jobs already validated payment
  next();
}

/* =====================================================
   PAID INVOCATION (AFTER PAYMENT)
===================================================== */
app.post(
  "/x402/solana/schedoputer",
  requirePayment,
  (req, res) => {
    const { prompt, schedule_hhmm } = req.body;

    if (!prompt || !schedule_hhmm) {
      return res.status(400).json({
        error: "prompt and schedule_hhmm required"
      });
    }

    const [hh, mm] = schedule_hhmm.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) {
      return res.status(400).json({ error: "Invalid schedule_hhmm format" });
    }

    const scheduledFor =
      new Date(Date.now() + (hh * 60 + mm) * 60 * 1000);

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
  }
);

/* =====================================================
   STATUS
===================================================== */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.json({ state: "failed", error: "Job not found" });
  }

  res.json({
    state: job.state,
    tasks: job.tasks
  });
});

/* =====================================================
   MODIFY TASK
===================================================== */
app.patch("/x402/solana/schedoputer/:jobId/task/:taskId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be modified" });
  }

  task.params = { ...task.params, ...req.body };
  res.json({ success: true });
});

/* =====================================================
   UNDO TASK
===================================================== */
app.post("/x402/solana/schedoputer/:jobId/task/:taskId/undo", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || !task.undoable || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be undone" });
  }

  task.status = "cancelled";
  res.json({ success: true });
});

/* =====================================================
   SCHEDULER
===================================================== */
setInterval(() => {
  const now = new Date();

  for (const job of jobs.values()) {
    if (job.state === "scheduled" && now >= job.scheduledFor) {
      job.state = "running";
    }

    if (job.state !== "running") continue;

    for (const task of job.tasks) {
      if (task.status === "blocked") {
        const dep = job.tasks.find(t => t.id === task.dependsOn);
        if (dep && dep.status === "completed") {
          task.status = "pending";
        }
      }
    }

    if (job.tasks.every(t =>
      ["completed", "cancelled"].includes(t.status)
    )) {
      job.state = "completed";
    }
  }
}, 30_000);

/* =====================================================
   START
===================================================== */
app.listen(PORT, () => {
  console.log("🚀 Schedoputer backend live (PAYMENT FIXED)");
});
