import express from "express";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const BASE_URL = "https://schedoputer.onrender.com";

/* ================= IN-MEMORY STATE ================= */
const jobs = new Map();

/* ================= DOMAIN VERIFICATION ================= */
app.get("/.well-known/x402-verification.json", (req, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* ================= x402 DISCOVERY ================= */
app.get("/x402/solana/schedoputer", (req, res) => {
  res.status(402).json({
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
          "Schedoputer orchestrates scheduled AI + human workflows with per-task control (modify / undo).",
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
        }
      }
    ]
  });
});

/* ================= CREATE JOB ================= */
app.post("/x402/solana/schedoputer", (req, res) => {
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
    currentTaskIndex: 0,
    tasks: [
      { id: "T1", name: "research", status: "pending" },
      { id: "T2", name: "tweet", status: "pending", dependsOn: "T1" },
      { id: "T3", name: "post", status: "pending", dependsOn: "T2" },
      { id: "T4", name: "likes", status: "pending", undoable: true, dependsOn: "T3" },
      { id: "T5", name: "reposts", status: "pending", undoable: true, dependsOn: "T3" },
      { id: "T6", name: "comments", status: "pending", undoable: true, dependsOn: "T3" }
    ]
  });

  res.json({
    success: true,
    jobId,
    scheduledFor: scheduledFor.toISOString(),
    statusUrl: `${BASE_URL}/x402/solana/schedoputer/status/${jobId}`
  });
});

/* ================= STATUS ================= */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.json({ state: "failed" });

  res.json({
    state: job.state,
    tasks: job.tasks
  });
});

/* ================= MODIFY ================= */
app.patch("/x402/solana/schedoputer/:jobId/task/:taskId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be modified" });
  }

  task.params = { ...task.params, ...req.body };
  res.json({ success: true });
});

/* ================= UNDO ================= */
app.post("/x402/solana/schedoputer/:jobId/task/:taskId/undo", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || !task.undoable || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be undone" });
  }

  task.status = "cancelled";
  res.json({ success: true });
});

/* ================= SCHEDULER ================= */
setInterval(() => {
  const now = new Date();

  for (const job of jobs.values()) {
    if (job.state === "scheduled" && now >= job.scheduledFor) {
      job.state = "running";
    }

    if (job.state !== "running") continue;

    const next = job.tasks.find(t => t.status === "pending");
    if (!next) {
      job.state = "completed";
      continue;
    }

    if (next.dependsOn) {
      const dep = job.tasks.find(t => t.id === next.dependsOn);
      if (!dep || dep.status !== "completed") continue;
    }

    // Mark ready — x402.jobs executes actual resource
    next.status = "ready";
  }
}, 30_000);

app.listen(PORT, () => {
  console.log("🚀 Schedoputer backend live & x402-correct");
});
