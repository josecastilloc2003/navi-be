const express = require("express");
const router = express.Router();
const Bookings = require("../models/booking");
const Provider = require("../models/indprovider");
const checkAuth = require("../middleware/check-auth"); // ⬅️ not used yet

// ───────────────── GET ROUTES ─────────────────────────────────────────

// Get every booking
router.get("/", async (req, res) => {
  try {
    const bookings = await Bookings.find().lean();
    return res.status(200).json({ count: bookings.length, bookings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
});

// Get one booking
router.get("/:bookingID", async (req, res) => {
  try {
    const booking = await Bookings.findById(req.params.bookingID).lean();
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    return res.status(200).json({ message: "Booking Found", booking });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
});

// Get bookings by user
router.get("/users/:userID", async (req, res) => {
  try {
    const bookings = await Bookings.find({ client: req.params.userID }).lean();
    if (!bookings.length) {
      return res.status(404).json({ message: "No bookings under this User" });
    }
    return res.status(200).json({ count: bookings.length, bookings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
});

// Get bookings by driver
router.get("/drivers/:driverID", async (req, res) => {
  try {
    const bookings = await Bookings.find({
      provider: req.params.driverID,
    }).lean();
    if (!bookings.length) {
      return res
        .status(404)
        .json({ message: "No bookings found under this Driver" });
    }
    return res.status(200).json({ count: bookings.length, bookings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
});

// Available bookings (pending and unassigned)
router.get("/available", async (req, res) => {
  try {
    const bookings = await Bookings.find({ status: 'pending', provider: null }).lean();
    if (!bookings.length) {
      return res.status(200).json({ count: 0, bookings: [] });
    }
    return res.status(200).json({ count: bookings.length, bookings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
});

// ───────────────── POST ROUTES ───────────────────────────────────────

// Create a new booking
router.post("/newBooking", async (req, res) => {
  try {
    const {
      userID,
      pickup,
      dropoff,
      bookingDuration,
      userPrice,
      carPreference, // 'user' | 'driver'
      carId, // rider-owned car if carPreference === 'user'
      scheduledStart,
      pickupAddress,
      dropoffAddress,
    } = req.body;

    // ── validation ─────────────────────────────────────────────
    if (!userID || !pickup || !dropoff || !carPreference || !scheduledStart) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    if (!["user", "driver"].includes(carPreference)) {
      return res
        .status(400)
        .json({ message: "carPreference must be 'user' or 'driver'" });
    }
    if (carPreference === "user" && !carId) {
      return res
        .status(400)
        .json({ message: "carId required when carPreference is 'user'" });
    }

    // ── create booking doc ─────────────────────────────────────
    const start = new Date(scheduledStart);
    const durMin = Number(bookingDuration) || 60; // default 60 if not provided
    const end = new Date(start.getTime() + durMin * 60 * 1000);

    const booking = new Bookings({
      provider: null, // assigned when a driver accepts
      client: userID,
      pickup: { lat: pickup.lat, lng: pickup.lng },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng },
      // Optional display helpers (if schema supports)
      pickupAddress: pickupAddress ?? undefined,
      dropoffAddress: dropoffAddress ?? undefined,
      bookingDuration: durMin,
      status: "pending",
      userPrice,
      driverEarnings: 0,
      carPreference,
      car: carId ?? null,
      scheduled: true,
      scheduledStartTime: start,
      scheduledEndTime: end,
    });

    const saved = await booking.save();
    return res.status(201).json({ message: "Booking Created", booking: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ───────────────── DELETE ROUTES ────────────────────────────────────

router.delete("/removeBooking/:bookingID", async (req, res) => {
  try {
    const result = await Bookings.deleteOne({ _id: req.params.bookingID });
    if (!result.deletedCount) {
      return res.status(404).json({ message: "Booking not found" });
    }
    return res.status(200).json({ message: "Booking deleted", result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
});

// ───────────────── PATCH ROUTES (STATUS) ────────────────────────────

const setStatus = (status) => async (req, res) => {
  try {
    const update = { status };
    const now = new Date();
    if (status === 'in_progress') update.actualStartTime = now;
    if (status === 'completed') update.actualEndTime = now;

    const result = await Bookings.updateOne(
      { _id: req.params.bookingID },
      update
    );
    if (!result.matchedCount) {
      return res.status(404).json({ message: "Can't find Booking" });
    }
    if (!result.modifiedCount) {
      return res.status(500).json({ message: "Can't update Booking" });
    }
    // Emit socket events so rider/driver pages update live
    try {
      const io = global.io;
      const roomTrip = `trip:${req.params.bookingID}`;
      const roomBooking = `booking:${req.params.bookingID}`;
      if (io) {
        if (status === 'in_progress') {
          io.to(roomTrip).emit('tripStarted', { bookingId: req.params.bookingID, ts: now });
          io.to(roomBooking).emit('rideStarted', { bookingId: req.params.bookingID, ts: now });
        } else if (status === 'completed') {
          io.to(roomTrip).emit('tripCompleted', { bookingId: req.params.bookingID, ts: now });
          io.to(roomBooking).emit('rideCompleted', { bookingId: req.params.bookingID, ts: now });
        } else if (status === 'cancelled') {
          io.to(roomBooking).emit('rideCancelled', { bookingId: req.params.bookingID, ts: now });
        }
      }
    } catch (e) { /* best effort */ }

    return res.status(200).json({ message: `Booking ${status}`, result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err });
  }
};

router.patch("/accept/:bookingID", setStatus("accepted"));
router.patch("/inProgress/:bookingID", setStatus("in_progress"));
router.patch("/completed/:bookingID", setStatus("completed"));
router.patch("/cancelled/:bookingID", setStatus("cancelled"));
router.patch("/noShow/:bookingID", setStatus("no_show"));

// Driver signals arrival at pickup; keep status as accepted, just notify room
router.patch('/arrived/:bookingID', async (req, res) => {
  try {
    const booking = await Bookings.findById(req.params.bookingID).lean();
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    // Ensure accepted
    if (booking.status === 'pending') {
      await Bookings.updateOne({ _id: booking._id }, { status: 'accepted' });
    }
    const io = global.io;
    if (io) {
      const roomTrip = `trip:${req.params.bookingID}`;
      const roomBooking = `booking:${req.params.bookingID}`;
      io.to(roomTrip).emit('driverArrived', { bookingId: req.params.bookingID, ts: Date.now() });
      io.to(roomBooking).emit('driverArrived', { bookingId: req.params.bookingID, ts: Date.now() });
    }
    return res.json({ message: 'Driver arrival noted' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// Atomic accept + assign provider if still pending and unassigned
router.patch("/assignAccept/:bookingID", async (req, res) => {
  try {
    const { providerId } = req.body || {};
    if (!providerId) return res.status(400).json({ message: 'providerId is required' });

    const updated = await Bookings.findOneAndUpdate(
      { _id: req.params.bookingID, status: 'pending', provider: null },
      { $set: { provider: providerId, status: 'accepted' } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({ message: 'Booking already accepted or no longer available' });
    }
    // Emit assignment so rider page updates immediately
    try {
      const io = global.io;
      if (io) {
        const prov = await Provider.findById(providerId).lean();
        const driverSnapshot = prov ? {
          id: prov._id?.toString(),
          name: `${prov.firstName ?? ''} ${prov.lastName ?? ''}`.trim(),
          phone: prov.phone,
          rating: prov.rating,
        } : null;
        const payload = { bookingId: req.params.bookingID, driverSnapshot };
        io.to(`trip:${req.params.bookingID}`).emit('driverAssigned', { driverId: providerId, bookingId: req.params.bookingID });
        io.to(`booking:${req.params.bookingID}`).emit('rideMatched', payload);
      }
    } catch {}

    return res.status(200).json({ message: 'Booking accepted', booking: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
