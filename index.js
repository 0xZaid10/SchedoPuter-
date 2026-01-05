import express from "express";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const BASE_URL = "https://schedoputer.onrender.com";

const jobs = new Map();

/* =====================================================
   x402 DOMAIN VERIFICATION
===================================================== */
app.get("/.well-known/x402-verification.json", (req, res) => {
  res.json({ x402: "b470847b6c14" });
});


/* ===================== x402 DISCOVERY ===================== */
app.get("/x402/solana/schedoputer", (req, res) => {
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
          "Schedoputer orchestrates scheduled AI + human workflows with per-task control (modify/undo).",

        /* 🔑 THIS IS WHAT YOU WERE MISSING */
        outputSchema: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            bodyFields: {
              prompt: {
                type: "string",
                required: true,
                description:
                  "User instruction"
              },
              schedule_hhmm: {
                type: "string",
                required: true,
                description:
                  "Delay before execution in hh:mm (hours:minutes)"
              }
            }
          },
          output: {
            success: { type: "boolean" },
            jobId: { type: "string" },
            scheduledFor: {
              type: "string",
              description: "ISO timestamp when job will start"
            },
            statusUrl: {
              type: "string",
              description: "Polling endpoint for job status"
            }
          }
        }
      }
    ]
  });
});

/* ===================== CREATE JOB ===================== */
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
    context: {},
    tasks: [
      { id: "T1", name: "research", url: "https://api.syraa.fun/x-search", status: "pending" },
      { id: "T2", name: "tweet", url: "https://x402factory.ai/solana/llm/gpt/AW5793DBAYAHSEHJTU", status: "pending", dependsOn: "T1" },
      { id: "T3", name: "post", url: "https://wurkapi.fun/solana/agenthelp/10", status: "pending", dependsOn: "T2" },
      { id: "T4", name: "likes", url: "https://wurkapi.fun/api/x402/quick/solana/xlikes-20", status: "pending", undoable: true, dependsOn: "T3" },
      { id: "T5", name: "reposts", url: "https://wurkapi.fun/solana/reposts/9", status: "pending", undoable: true, dependsOn: "T3" },
      { id: "T6", name: "comments", url: "https://wurkapi.fun/solana/comments/7", status: "pending", undoable: true, dependsOn: "T3" }
    ]
  });

  res.json({
    success: true,
    jobId,
    statusUrl: `${BASE_URL}/x402/solana/schedoputer/status/${jobId}`
  });
});

/* ===================== STATUS ===================== */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.json({ state: "failed" });
  res.json({ state: job.state, context: job.context, tasks: job.tasks });
});

/* ===================== MODIFY TASK ===================== */
app.patch("/x402/solana/schedoputer/:jobId/task/:taskId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be modified" });
  }

  task.params = { ...task.params, ...req.body };
  res.json({ success: true });
});

/* ===================== UNDO TASK ===================== */
app.post("/x402/solana/schedoputer/:jobId/task/:taskId/undo", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const task = job?.tasks.find(t => t.id === req.params.taskId);

  if (!task || !task.undoable || task.status !== "pending") {
    return res.status(400).json({ error: "Task cannot be undone" });
  }

  task.status = "cancelled";
  res.json({ success: true });
});

/* ===================== EXECUTOR ===================== */
setInterval(async () => {
  for (const job of jobs.values()) {
    if (job.state === "scheduled" && new Date() >= job.scheduledFor) {
      job.state = "running";
    }

    if (job.state !== "running") continue;

    for (const task of job.tasks) {
      if (task.status !== "pending") continue;
      if (task.dependsOn) {
        const dep = job.tasks.find(t => t.id === task.dependsOn);
        if (!dep || dep.status !== "completed") continue;
      }

      const r = await fetch(task.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: job.prompt })
      });

      if (r.status === 402) return; // x402.jobs will retry

      const data = await r.json();
      job.context[task.name] = data;
      task.status = "completed";
    }

    job.state = "completed";
  }
}, 30000);

app.listen(PORT, () => {
  console.log("🚀 Schedoputer fully live");
});
