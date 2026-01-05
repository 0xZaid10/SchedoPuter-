import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";

const app = express();

// 1. Permissive CORS to fix the "Fill in all required fields" error
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x402-resource", "Authorization"],
  exposedHeaders: ["x402-resource", "x-payment-response"]
}));

// 2. Security Bypass for ERR_BLOCKED_BY_RESPONSE
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});

app.use(express.json());

// 3. Handle trailing slashes
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    res.redirect(301, req.path.slice(0, -1));
  } else {
    next();
  }
});

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const BASE_URL = "https://schedoputer.onrender.com";

/* ================= STATE ================= */
const jobs = new Map();

/* ================= DOMAIN VERIFICATION ================= */
app.get("/.well-known/x402-verification.json", (_, res) => {
  res.json({ x402: "b470847b6c14" });
});

/* ================= x402 DISCOVERY ================= */
app.get("/x402/solana/schedoputer", (req, res) => {
  const resourceUrl = `${BASE_URL}/x402/solana/schedoputer`;
  res.set("x402-resource", resourceUrl);
  
  res.status(402).json({
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        maxAmountRequired: "10000", // $0.01 USDC
        asset: USDC_MINT,
        payTo: PAY_TO,
        resource: resourceUrl,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        description: "Schedoputer: AI + Human workflow orchestration.",
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
  if (!prompt || !schedule_hhmm) return res.status(400).json({ error: "Missing fields" });

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

/* ================= STATUS ================= */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.json({ state: "failed" });
  res.json({ state: job.state, tasks: job.tasks });
});

/* ================= MODIFY LOGIC ================= */
app.patch("/x402/solana/schedoputer/:jobId/task/:taskId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be modified" });
  }

  task.params = { ...task.params, ...req.body };
  res.json({ success: true });
});

/* ================= UNDO LOGIC ================= */
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
        if (dep && dep.status === "completed") task.status = "pending";
      }
    }
    if (job.tasks.every(t => ["completed", "cancelled"].includes(t.status))) {
      job.state = "completed";
    }
  }
}, 30000);

app.listen(PORT, () => console.log("🚀 Schedoputer live with full logic ($0.01)"));
