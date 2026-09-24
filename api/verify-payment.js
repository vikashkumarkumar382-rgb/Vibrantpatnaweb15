const crypto = require("crypto");
const Razorpay = require("razorpay");
const { get, put } = require("@vercel/blob");

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_DOWNLOADS = 20;
const FILE_PATH = "Instaaamastry.pdf";
const SITE_URL = "https://vibrantpatnaweb15.vercel.app";

const RESEND_FROM =
  process.env.RESEND_FROM_EMAIL || "VibrantPatna <onboarding@resend.dev>";

async function readPrivateText(result) {
  const reader = result.stream.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function loadAccessRecord(recordPath) {
  try {
    const result = await get(recordPath, {
      access: "private",
      useCache: false
    });

    if (!result || !result.blob) {
      return null;
    }

    return JSON.parse(await readPrivateText(result));
  } catch (error) {
    return null;
  }
}

async function saveAccessRecord(recordPath, record) {
  await put(recordPath, JSON.stringify(record), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

function createAccessToken(recordPath, exp) {
  const payload = {
    record: recordPath,
    path: FILE_PATH,
    exp
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

async function sendDownloadEmail({ email, downloadUrl, paymentId }) {
  if (!process.env.RESEND_API_KEY || !email) {
    return { sent: false };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Idempotency-Key": `ebook-delivery/${paymentId}`
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [email],
      subject: "Your VibrantPatna Instagram Mastery eBook",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:600px;margin:auto">
          <h2 style="color:#B5121B">Your Instagram Mastery eBook is ready 🎉</h2>
          <p>Thank you for your purchase from VibrantPatna.</p>

          <p>
            Your secure download link is valid for
            <strong>7 days</strong> and allows up to
            <strong>20 downloads</strong>.
          </p>

          <p style="margin:28px 0">
            <a href="${downloadUrl}"
               style="background:#B5121B;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;display:inline-block;font-weight:700">
              Download Your eBook
            </a>
          </p>

          <p>If the button does not work, copy and open this link:</p>

          <p style="word-break:break-all;font-size:13px">
            ${downloadUrl}
          </p>

          <p style="font-size:13px;color:#666">
            This download link expires after 7 days.
          </p>

          <p>— VibrantPatna</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data?.message || data?.name || "Resend email failed"
    );
  }

  return { sent: true };
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

    const recordPath =
      `ebook-access/${razorpay_payment_id}.json`;

    let record = await loadAccessRecord(recordPath);

    if (!record) {
      const now = Math.floor(Date.now() / 1000);

      record = {
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        path: FILE_PATH,
        createdAt: now,
        exp: now + TOKEN_TTL_SECONDS,
        downloads: 0,
        maxDownloads: MAX_DOWNLOADS
      };

      await saveAccessRecord(recordPath, record);
    }

    const accessToken = createAccessToken(
      recordPath,
      record.exp
    );

    const downloadUrl =
      `${SITE_URL}/api/download?token=${encodeURIComponent(accessToken)}`;

    let emailSent = false;

    try {
      const emailResult = await sendDownloadEmail({
        email: payment.email,
        downloadUrl,
        paymentId: razorpay_payment_id
      });

      emailSent = emailResult.sent;
    } catch (emailError) {
      console.error("Resend error:", emailError);
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      downloadUrl,
      expiresInSeconds: Math.max(
        0,
        record.exp - Math.floor(Date.now() / 1000)
      ),
      maxDownloads: record.maxDownloads,
      emailSent
    });

  } catch (error) {
    console.error("Payment verification error:", error);

    return res.status(500).json({
      success: false,
      error: "Verification error"
    });
  }
};
