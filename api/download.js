const crypto = require("crypto");
const { get, put } = require("@vercel/blob");
const { Readable } = require("stream");

const FILE_PATH = "Instaaamastry.pdf";
const MAX_DOWNLOADS = 20;

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
  await put(
    recordPath,
    JSON.stringify(record),
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    }
  );
}

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
      .createHmac(
        "sha256",
        process.env.RAZORPAY_KEY_SECRET
      )
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

    let payload;

    try {
      payload = JSON.parse(
        Buffer.from(
          encodedPayload,
          "base64url"
        ).toString("utf8")
      );
    } catch {
      return res.status(401).send("Invalid access link");
    }

    if (
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return res.status(410).send(
        "This access link has expired"
      );
    }

    if (
      !payload.record ||
      typeof payload.record !== "string" ||
      payload.path !== FILE_PATH ||
      !/^ebook-access\/[^/]+\.json$/.test(
        payload.record
      )
    ) {
      return res.status(401).send(
        "Invalid access link"
      );
    }

    const record = await loadAccessRecord(
      payload.record
    );

    if (!record) {
      return res.status(404).send(
        "Access record not found"
      );
    }

    if (
      record.path !== FILE_PATH ||
      record.exp !== payload.exp ||
      record.exp < Math.floor(Date.now() / 1000)
    ) {
      return res.status(410).send(
        "This access link has expired"
      );
    }

    const maxDownloads =
      Number(record.maxDownloads) || MAX_DOWNLOADS;

    const downloads =
      Number(record.downloads) || 0;

    if (downloads >= maxDownloads) {
      return res.status(429).send(
        "Download limit reached"
      );
    }

    const result = await get(FILE_PATH, {
      access: "private"
    });

    if (!result || result.statusCode !== 200) {
      return res.status(404).send(
        "Ebook not found"
      );
    }

    record.downloads = downloads + 1;

    await saveAccessRecord(
      payload.record,
      record
    );

    res.setHeader(
      "Content-Type",
      result.blob.contentType ||
        "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Instaaamastry.pdf"'
    );

    res.setHeader(
      "Cache-Control",
      "private, no-store"
    );

    res.setHeader(
      "X-Content-Type-Options",
      "nosniff"
    );

    Readable.fromWeb(result.stream).pipe(res);

  } catch (error) {
    console.error(
      "Download error:",
      error
    );

    return res.status(500).send(
      "Unable to deliver ebook"
    );
  }
};
