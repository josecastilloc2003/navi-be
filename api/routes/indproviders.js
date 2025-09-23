const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Provider = require("../models/indprovider");
const checkAuth = require("../middleware/check-auth");
const mongoose = require("mongoose");

//GET Routes

//Gets all providers (omit password)
router.get("/", async (_req, res) => {
  try {
    const providers = await Provider.find().lean().select("-password -__v");
    return res.status(200).json({ count: providers.length, providers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * List online drivers available for a scheduled ride
 * GET /api/indproviders/available?start=<ISO>&duration=<minutes>
 * Placed before '/:providerId' so it isn't captured by that param route.
 */
router.get("/available", async (req, res) => {
  try {
    const { start, duration } = req.query;

    if (!start || !duration) {
      return res
        .status(400)
        .json({ message: "start and duration query params are required" });
    }

    const startDate = new Date(start);
    const rideMinutes = Number.parseInt(duration, 10);

    if (Number.isNaN(rideMinutes) || rideMinutes <= 0) {
      return res
        .status(400)
        .json({ message: "duration must be a positive integer (minutes)" });
    }

    // Convert to weekday index and minutes‑since‑midnight UTC
    const dayIndex = startDate.getUTCDay();
    const startMin = startDate.getUTCHours() * 60 + startDate.getUTCMinutes();
    const endMin = startMin + rideMinutes;

    // availability stores "HH:MM" strings
    const toHHMM = (m) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(
        2,
        "0"
      )}`;

    const startStr = toHHMM(startMin);
    const endStr = toHHMM(endMin);

    const drivers = await Provider.find({
      isOnline: true,
      availability: {
        $elemMatch: {
          day: dayIndex,
          start: { $lte: startStr },
          end: { $gte: endStr },
        },
      },
    })
      .sort({ rating: -1 })
      .select("-password -socketId -__v")
      .lean();

    return res.status(200).json({ count: drivers.length, drivers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

//Returns provider whose ID matches the one in the request
router.get("/:providerId", async (req, res) => {
  try {
    const { providerId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({ message: "Invalid provider ID" });
    }

    const provider = await Provider.findById(providerId)
      .lean()
      .select("-password -__v");

    if (!provider) {
      return res.status(404).json({ message: "Provider not found" });
    }

    return res.status(200).json(provider);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

//Creates a new independent provider
router.post("/signup", async (req, res, next) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const exists = await Provider.exists({ email });

    if (exists) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hash = await bcrypt.hash(req.body.password, 10);

    const provider = new Provider({
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      password: hash,
      phone: req.body.phone,
      birthdate: req.body.birthdate,
      address: req.body.address,
      serviceType: req.body.serviceType,
      verified: false,
      bio: req.body.bio,
      availability: req.body.availability,
      currentLoc: req.body.currentLoc || { type: "Point", coordinates: [0, 0] },
    });

    //Save to db and wait for result
    const result = await provider.save();

    //Strip password before sending back
    const { password: _, __v: __, ...sanitized } = result.toObject();
    res.status(201).json({
      message: "Provider created",
      createdProvider: sanitized,
    });
  } catch (err) {
    console.error(err);
    // duplicate email → 409 Conflict
    if (err.code === 11000) {
      return res.status(409).json({ message: "Email already exists" });
    }
    res.status(500).json({ error: err });
  }
});

//Logs in an independent provider
router.post("/login", async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const password = req.body.password || "";

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const provider = await Provider.findOne({ email })
      .select("+password") // pull the hash only for comparison
      .lean(); // plain JS object, not a Mongoose doc

    if (!provider) {
      return res.status(401).json({ message: "Auth failed" });
    }

    // Verify password
    const match = await bcrypt.compare(password, provider.password);
    if (!match) {
      return res.status(401).json({ message: "Auth failed" });
    }
    // Require account verification before allowing login
    if (!provider.verified) {
      return res.status(403).json({ message: "Account not verified" });
    }

    const token = jwt.sign(
      {
        providerId: provider._id,
        email: provider.email,
        role: "provider", // you can use this in checkAuth
        firstName: provider.firstName,
        lastName: provider.lastName,
        verified: provider.verified,
      },
      process.env.JWT_KEY,
      { expiresIn: "14h" }
    );

    const { password: _, ...safeProvider } = provider; // discard hash

    res.status(200).json({
      message: "Auth successful",
      token: token,
      provider: safeProvider,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

//Deletes indp provider with that specific ID
router.delete("/:providerId", checkAuth, (req, res, next) => {
  Provider.deleteOne({ _id: req.params.providerId })
    .exec()
    .then((result) => {
      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.status(200).json({
        message: "Provider deleted",
        result,
      });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: err });
    });
});

// Verify a driver account (e.g., after document review)
router.patch("/verify/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;

    const updated = await Provider.findByIdAndUpdate(
      driverId,
      { verified: true, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json({ message: "Driver verified", driver: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Driver goes online (called right after Socket.io connects)
router.patch("/online", async (req, res) => {
  try {
    await Provider.updateOne(
      { _id: req.body.driverId },
      { isOnline: true, socketId: req.body.socketId, updatedAt: Date.now() }
    );
    res.json({ message: "Driver is now online" });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// Driver goes offline (manual toggle or on logout)
router.patch("/offline", async (req, res) => {
  try {
    await Provider.updateOne(
      { _id: req.body.driverId },
      { isOnline: false, socketId: null }
    );
    res.json({ message: "Driver is now offline" });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

module.exports = router;
