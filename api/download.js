
const crypto = require("crypto");
const { get } = require("@vercel/blob");
const { Readable } = require("stream");

const TOKEN_TTL_SECONDS = 15 * 60;
const FILE_PATH = "Instaaamastry.pdf";

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(401).send("Access denied");
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
      return res.status(401).send("Invalid access link");
    }

    const [encodedPayload, receivedSignature] = parts;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(encodedPayload)
      .digest("base64url");

    if (
      receivedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(receivedSignature),
        Buffer.from(expectedSignature)
      )
    ) {
      return res.status(401).send("Invalid access link");
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return res.status(410).send("This access link has expired");
    }

    const result = await get(FILE_PATH, {
      access: "private"
    });

    if (!result || result.statusCode !== 200) {
      return res.status(404).send("Ebook not found");
    }

    res.setHeader(
      "Content-Type",
      result.blob.contentType || "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Instaaamastry.pdf"'
    );

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    Readable.fromWeb(result.stream).pipe(res);

  } catch (error) {
    console.error("Download error:", error);

    return res.status(500).send("Unable to deliver ebook");
  }
};
