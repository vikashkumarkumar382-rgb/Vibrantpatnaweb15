
const Razorpay = require("razorpay");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.create({
      amount: 49900,
      currency: "INR",
      receipt: `ebook_${Date.now()}`
    });

    return res.status(200).json(order);
  } catch (error) {
    return res.status(500).json({
      error: "Unable to create order"
    });
  }
};
