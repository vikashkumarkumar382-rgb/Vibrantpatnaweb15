
const crypto = require("crypto");
const Razorpay = require("razorpay");

const TOKEN_TTL_SECONDS = 15 * 60;

function createAccessToken() {
  const payload = {
    path: "Instaaamastry.pdf",
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload)
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body || {};

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing payment details"
      });
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (
      generatedSignature.length !== razorpay_signature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(generatedSignature),
        Buffer.from(razorpay_signature)
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Payment verification failed"
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    if (
      !order ||
      order.amount !== 49900 ||
      order.currency !== "INR" ||
      payment.order_id !== razorpay_order_id ||
      payment.amount !== 49900 ||
      payment.currency !== "INR" ||
      !["captured", "authorized"].includes(payment.status)
    ) {
      return res.status(400).json({
        success: false,
        error: "Payment could not be confirmed"
      });
    }

    const accessToken = createAccessToken();

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      downloadUrl:
        `/api/download?token=${encodeURIComponent(accessToken)}`,
      expiresInSeconds: TOKEN_TTL_SECONDS
    });
  } catch (error) {
    console.error("Payment verification error:", error);

    return res.status(500).json({
      success: false,
      error: "Verification error"
    });
  }
};
