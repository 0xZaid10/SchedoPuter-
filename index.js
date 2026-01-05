import express from "express";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */
const BASE_URL = "https://schedoputer.onrender.com";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";      // your wallet
const FEE_PAYER = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U"; // can be same wallet
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* ================= STATE ================= */
const jobs = new Map();

/* ================= DOMAIN VERIFICATION ================= */
app.get("/.well-known/x402-verification.json", (_, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* ================= 402 HELPER ================= */
function send402(res) {
  return res.status(402).json({
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
        /* ✅ REQUIRED BY x402.jobs */
        extra: {
          feePayer: FEE_PAYER
        }
      }
    ]
  });
}

/* ================= DISCOVERY ================= */
app.get("/x402/solana/schedoputer", (_, res) => {
  return send402(res);
});

/* ================= PAID INVOCATION ================= */
app.post("/x402/solana/schedoputer", (req, res) => {
  // 🔑 If payment missing → return 402 again
  if (!req.headers["x-payment"]) {
    return send402(res);
  }

  const { prompt, schedule_hhmm } = req.body;

  if (!prompt || !schedule_hhmm) {
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

/* ================= STATUS ================= */
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

/* ================= START ================= */
app.listen(PORT, () => {
  console.log("🚀 Schedoputer backend live — feePayer fixed");
});
