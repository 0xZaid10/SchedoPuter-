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
   IN-MEMORY STATE (hackathon-safe)
===================================================== */
const jobs = new Map();

/* =====================================================
   DOMAIN VERIFICATION (x402scan / x402.jobs)
===================================================== */
app.get("/.well-known/x402-verification.json", (_req, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* =====================================================
   x402 DISCOVERY (PAYMENT HAPPENS HERE)
===================================================== */
app.get("/x402/solana/schedoputer", (_req, res) => {
  res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        maxAmountRequired: "10000", // 0.01 USDC
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
              prompt: {
                type: "string",
                required: true,
                description: "User instruction"
              },
              schedule_hhmm: {
                type: "string",
                required: true,
                description: "Delay before execution (hh:mm)"
              }
            }
          },
          output: {
            success: { type: "boolean" },
            jobId: { type: "string" },
            scheduledFor: { type: "string" },
            statusUrl: { type: "string" }
          }
        }
      }
    ]
  });
});

/* =====================================================
   PAID INVOCATION (CALLED AFTER PAYMENT)
===================================================== */
app.post("/x402/solana/schedoputer", (req, res) => {
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

  const scheduledFor = new Date(
    Date.now() + (hh * 60 + mm) * 60 * 1000
  );

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
   JOB STATUS (LRO)
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
   MODIFY TASK (pre-execution only)
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
   UNDO TASK (supported tasks only)
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
   SCHEDULER (NO RESOURCE EXECUTION)
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
   START SERVER
===================================================== */
app.listen(PORT, () => {
  console.log("🚀 Schedoputer backend live (x402-correct)");
});
