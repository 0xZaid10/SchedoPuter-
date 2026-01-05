import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";

const app = express();

// Enable CORS and expose the required protocol header
app.use(cors({
  origin: "*",
  exposedHeaders: ["x402-resource"]
}));

app.use(express.json());

// --- DEBUG MIDDLEWARE ---
// This will print every request to your Render "Logs" tab
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  next();
});

const PORT = process.env.PORT || 3000;
const BASE_URL = "https://schedoputer.onrender.com";
const PAY_TO = "4n9vJHPezhghfF6NCTSPgTbkGoV7EsQYtC2hfaKfrM8U";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const jobs = new Map();

/* ================= DISCOVERY ================= */
app.get("/x402/solana/schedoputer", (req, res) => {
  const resourceUrl = `${BASE_URL}/x402/solana/schedoputer`;

  // Protocol requirement: Header must match the resource URL
  res.set("x402-resource", resourceUrl);

  const discoveryResponse = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "solana",
        asset: USDC_MINT,
        maxAmountRequired: "10000", // 0.01 USDC
        payTo: PAY_TO,
        resource: resourceUrl,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        description: "Schedoputer – AI + human workflows",
        // Some runners expect pricing details here to validate Step 1
        pricing: {
          amount: "0.01",
          currency: "USDC",
          network: "solana"
        }
      }
    ]
  };

  console.log("Sending Discovery JSON:", JSON.stringify(discoveryResponse, null, 2));
  res.status(402).json(discoveryResponse);
});

/* ================= PAYMENT GATE ================= */
function requirePayment(req, res, next) {
  const payment = req.headers["authorization"] || req.headers["x-payment"];
  
  if (!payment) {
    console.log("❌ No payment header found. Re-triggering 402.");
    res.set("x402-resource", `${BASE_URL}/x402/solana/schedoputer`);
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required"
    });
  }
  
  console.log("✅ Payment header detected:", payment);
  next();
}

/* ================= POST JOB ================= */
app.post("/x402/solana/schedoputer", requirePayment, (req, res) => {
  console.log("Processing Job Request Body:", req.body);
  const { prompt, schedule_hhmm } = req.body;

  if (!prompt || !schedule_hhmm) {
    return res.status(400).json({ error: "Missing prompt or schedule_hhmm" });
  }

  const jobId = uuidv4();
  jobs.set(jobId, { jobId, prompt, state: "scheduled", tasks: [] });

  res.json({
    success: true,
    jobId,
    statusUrl: `${BASE_URL}/x402/solana/schedoputer/status/${jobId}`
  });
});

// ... (Rest of your status/modify/undo routes)

app.listen(PORT, () => {
  console.log(`🚀 Schedoputer live at ${BASE_URL}`);
  console.log(`Monitor your Render logs to see Step 1 activity.`);
});
