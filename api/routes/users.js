// Routes
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/user");
const checkAuth = require("../middleware/check-auth"); //Add in later

//GET Routes

//Get all users (omit password)
router.get("/", async (_req, res) => {
  try {
    const users = await User.find().lean().select("-password -__v");

    res.status(200).json({ count: users.length, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

//Get a specific user (omit password)
router.get("/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .lean()
      .select("-password -__v");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

//POST Routes

//Create a new user
router.post("/signup", async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();

    if (
      !email ||
      !req.body.password ||
      !req.body.firstName ||
      !req.body.lastName ||
      !req.body.password
    ) {
      return res.status(400).json({ message: "All information is required" });
    }

    if (await User.exists({ email })) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hash = await bcrypt.hash(req.body.password, 10);

    const user = await User.create({
      email: email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      phone: req.body.phone,
      password: hash,
    });

    const { password: _, __v: __, ...safeUser } = user.toObject();
    res.status(201).json({ message: "User created", createdUser: safeUser });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      // race-condition fallback
      return res.status(409).json({ message: "Email already exists" });
    }
    res.status(500).json({ error: err });
  }
});

//Logs in an existing User
router.post("/login", async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const password = req.body.password || "";

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email })
      .select("+password") // schema has select:false
      .lean();

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Auth failed" });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: "user",
        firstName: user.firstName,
        lastName: user.lastName,
      },
      process.env.JWT_KEY,
      { expiresIn: "14h" }
    );

    const { password: _, __v: __, ...safeUser } = user; // drop hash
    res.status(200).json({ message: "Auth successful", token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

//DELETE Routes

//Delete a user with a specific ID from the database
router.delete("/:userId", async (req, res) => {
  try {
    const result = await User.deleteOne({ _id: req.params.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "User deleted", result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err });
  }
});

module.exports = router;
