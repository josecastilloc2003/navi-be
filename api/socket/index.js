/**
 * Socket gateway – handles all real‑time messaging for rides
 *
 * High‑level flow
 * 1. On connection we authenticate the JWT (sent from the client in handshake.auth.token)
 * 2. If the client is a driver we mark them online and await location pings
 * 3. Riders and drivers can “joinTrip” rooms so location / status events stay private
 * 4. When a driver accepts / declines a booking the server updates Mongo
 * 5. All other REST routes (matchDriver etc.) import io to emit events
 */

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Drivers = require("../models/indprovider");
const Bookings = require("../models/booking");
const { subtractSlot } = require("../services/scheduledMatcher");

// io is created in server.js and passed here
module.exports = function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" }, // TODO tighten in production
  });

  // make io globally available (e.g., in matchDriver service)
  global.io = io;

  io.on("connection", async (socket) => {
    /* ── 1. AUTHENTICATION ───────────────────────────────────── */
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.emit("error", "AUTH_REQUIRED");
      return socket.disconnect();
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      socket.emit("error", "INVALID_TOKEN");
      return socket.disconnect();
    }

    const { id: userId, role } = payload; // role = 'driver' | 'user'
    socket.data.userId = userId;
    socket.data.role = role;

    /* ── 2. DRIVER PRESENCE ──────────────────────────────────── */
    if (role === "driver") {
      await Drivers.updateOne(
        { _id: userId },
        { isOnline: true, socketId: socket.id, updatedAt: Date.now() }
      );
    }

    /* ───────────────── SOCKET EVENTS ───────────────────────── */

    // Driver / rider joins a private trip room
    socket.on("joinTrip", (tripId) => {
      socket.join(`trip:${tripId}`);
    });

    // Driver streams live GPS – every ~3 seconds
    socket.on("location", async ({ tripId, lat, lng, heading }) => {
      if (role !== "driver") return;
      // save latest coords in driver doc
      await Drivers.updateOne(
        { _id: userId },
        {
          currentLoc: { type: "Point", coordinates: [lng, lat] },
          updatedAt: Date.now(),
        }
      );
      // relay to rider
      io.to(`trip:${tripId}`).emit("driverLocation", { lat, lng, heading });
    });

    // Driver accepts booking
    socket.on("bookingAccept", async ({ bookingId }) => {
      if (role !== "driver") return;

      const booking = await Bookings.findById(bookingId);
      if (!booking || booking.status !== "pending") return;

      // Build update object
      const update = { status: "accepted", driver: userId };
      const driverDoc = await Drivers.findById(userId);
      if (booking.carPreference === "driver") {
        update.car = driverDoc.mainCar;
      }

      await Bookings.updateOne({ _id: bookingId }, update);

      // Trim the driver's availability for that slot
      const start = new Date(booking.scheduledStart);
      const dayIndex = start.getUTCDay();
      const startMin = start.getUTCHours() * 60 + start.getUTCMinutes();
      const endMin = startMin + booking.bookingDuration;
      await subtractSlot(driverDoc, startMin, endMin, dayIndex);

      io.to(`trip:${bookingId}`).emit("driverAssigned", { driverId: userId });
    });

    // Driver declines booking
    socket.on("bookingDecline", ({ bookingId }) => {
      if (role !== "driver") return;
      // Inform matcher to proceed with next candidate
      global.io.emit("driverDeclined", { bookingId, driverId: userId });
    });

    // Driver marks trip started / ended
    socket.on("tripStart", async (bookingId) => {
      if (role !== "driver") return;
      await Bookings.updateOne({ _id: bookingId }, { status: "in_progress" });
      io.to(`trip:${bookingId}`).emit("tripStarted");
    });

    socket.on("tripEnd", async ({ bookingId, driverEarnings, userPrice }) => {
      if (role !== "driver") return;
      await Bookings.updateOne(
        { _id: bookingId },
        { status: "completed", driverEarnings, userPrice }
      );
      io.to(`trip:${bookingId}`).emit("tripCompleted");
    });

    /* ── 3. DISCONNECT CLEANUP ───────────────────────────────── */
    socket.on("disconnect", async () => {
      if (role === "driver") {
        await Drivers.updateOne(
          { _id: userId },
          { isOnline: false, socketId: null }
        );
      }
    });
  });
};
