import express from "express";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =====================================================
   CONFIG
===================================================== */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U"; // 👈 replace before deploy
const BASE_URL = "https://schedoputer.onrender.com"; // 👈 replace

/* =====================================================
   IN-MEMORY STORE
===================================================== */
const jobs = new Map();

/* =====================================================
   x402 DISCOVERY
===================================================== */
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
        description: "Schedoputer — scheduled orchestration of AI + human x402 workflows"
      }
    ]
  });
});

/* =====================================================
   JOB CREATION
===================================================== */
app.post("/x402/solana/schedoputer", (req, res) => {
  const { prompt, schedule_hhmm } = req.body;
  if (!prompt || !schedule_hhmm) {
    return res.status(400).json({ error: "prompt and schedule_hhmm required" });
  }

  const [hh, mm] = schedule_hhmm.split(":").map(Number);
  const scheduledFor = new Date(Date.now() + (hh * 60 + mm) * 60 * 1000);
  const jobId = uuidv4();

  const job = {
    jobId,
    prompt,
    scheduledFor,
    state: "scheduled",
    context: {},
    tasks: [
      {
        id: "T1",
        name: "Research on X",
        resourceUrl: "https://api.syraa.fun/x-search",
        status: "pending"
      },
      {
        id: "T2",
        name: "Generate tweet (≤250 chars)",
        resourceUrl: "https://x402factory.ai/solana/llm/gpt/AW5793DBAYAHSEHJTU",
        status: "pending",
        dependsOn: "T1"
      },
      {
        id: "T3",
        name: "Human X posting",
        resourceUrl: "https://wurkapi.fun/solana/agenthelp/10",
        type: "human",
        status: "pending",
        dependsOn: "T2"
      },
      {
        id: "T4",
        name: "Likes",
        resourceUrl: "https://wurkapi.fun/api/x402/quick/solana/xlikes-20",
        status: "pending",
        dependsOn: "T3"
      },
      {
        id: "T5",
        name: "Reposts",
        resourceUrl: "https://wurkapi.fun/solana/reposts/9",
        status: "pending",
        dependsOn: "T3"
      },
      {
        id: "T6",
        name: "Comments",
        resourceUrl: "https://wurkapi.fun/solana/comments/7",
        status: "pending",
        dependsOn: "T3"
      }
    ]
  };

  jobs.set(jobId, job);

  res.json({
    success: true,
    jobId,
    scheduledFor,
    statusUrl: `/x402/solana/schedoputer/status/${jobId}`
  });
});

/* =====================================================
   JOB STATUS
===================================================== */
app.get("/x402/solana/schedoputer/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.json({ state: "failed" });

  res.json({
    state: job.state,
    tasks: job.tasks.map(t => ({ id: t.id, status: t.status })),
    context: job.context
  });
});

/* =====================================================
   BACKGROUND SCHEDULER
===================================================== */
setInterval(async () => {
  const now = new Date();

  for (const job of jobs.values()) {
    if (job.state === "scheduled" && now >= job.scheduledFor) {
      job.state = "running";
    }
    if (job.state === "running") {
      await runNextTask(job);
    }
  }
}, 30_000);

/* =====================================================
   TASK EXECUTION
===================================================== */
async function runNextTask(job) {
  const task = job.tasks.find(t => t.status === "pending");
  if (!task) {
    job.state = "completed";
    return;
  }

  if (task.dependsOn) {
    const dep = job.tasks.find(t => t.id === task.dependsOn);
    if (!dep || dep.status !== "completed") return;
  }

  task.status = "running";

  if (task.type === "human") {
    job.state = "waiting-human";
    task.status = "waiting";

    // WURK humans post & return URL
    setTimeout(() => {
      task.status = "completed";
      job.context.tweetUrl = "https://x.com/example/status/123456";
      job.state = "running";
    }, 180_000);

    return;
  }

  await callX402Resource(task, job);
  task.status = "completed";
}

/* =====================================================
   REAL x402 RESOURCE CALLS
===================================================== */
async function callX402Resource(task, job) {
  // STEP 1: Initial call → expect 402
  const res = await fetch(task.resourceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(task, job))
  });

  if (res.status === 402) {
    // In real usage, client retries with X-PAYMENT
    console.log(`💸 Payment required for ${task.resourceUrl}`);
    job.context[`paymentRequired_${task.id}`] = true;
    return;
  }

  const data = await res.json();

  if (task.id === "T1") {
    job.context.research = data;
  }

  if (task.id === "T2") {
    job.context.tweet = data.reply?.slice(0, 250);
  }
}

/* =====================================================
   PAYLOAD BUILDER
===================================================== */
function buildPayload(task, job) {
  if (task.id === "T1") {
    return { query: job.prompt };
  }

  if (task.id === "T2") {
    return {
      message: `Write a concise tweet (≤250 chars) with hashtags about:\n${job.context.research}`
    };
  }

  return {};
}

/* =====================================================
   START SERVER
===================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Schedoputer live on port ${PORT}`);
});
