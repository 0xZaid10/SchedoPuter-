/* ================= x402 DISCOVERY (Step 1) ================= */
app.get("/x402/solana/schedoputer", (req, res) => {
  const resourceUrl = `${BASE_URL}/x402/solana/schedoputer`;

  // Protocol requirement: Header MUST be present
  res.set("x402-resource", resourceUrl);

  const discoveryResponse = {
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
        description: "Schedoputer AI Workflow",
        // Platform-specific rendering fields
        extra: {
          pricing: {
            amount: 0.01,
            currency: "USDC",
            network: "Solana"
          },
          serviceName: "Schedoputer"
        }
      }
    ]
  };

  console.log("OUTGOING 402 JSON:", JSON.stringify(discoveryResponse));
  res.status(402).json(discoveryResponse);
});

/* ================= PAYMENT GATE (Step 2) ================= */
function requirePayment(req, res, next) {
  const payment = req.headers["authorization"] || req.headers["x-payment"] || req.headers["x-payment-signature"];
  
  if (!payment) {
    console.log("❌ No payment header. Sending 402 details to runner.");
    
    // We MUST re-send the header and the same JSON here
    res.set("x402-resource", `${BASE_URL}/x402/solana/schedoputer`);
    return res.status(402).json({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "solana",
          asset: USDC_MINT,
          maxAmountRequired: "10000",
          payTo: PAY_TO,
          resource: `${BASE_URL}/x402/solana/schedoputer`
        }
      ]
    });
  }
  
  console.log("✅ Payment header received! Proceeding to job creation.");
  next();
}
